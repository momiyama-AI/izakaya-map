const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { importNakanoSourceBackedPrices } = require("./nakano-source-import");
const { areas, stores, drinkPrices } = require("./seed-data");

const rootDir = path.resolve(__dirname, "../..");
const defaultDatabasePath = path.join(rootDir, ".local", "izakaya-map.sqlite");
const systemActor = "system";

const auditColumns = [
  { name: "created_at", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "updated_at", definition: "TEXT NOT NULL DEFAULT ''" },
  { name: "created_by", definition: "TEXT NOT NULL DEFAULT 'system'" },
  { name: "updated_by", definition: "TEXT NOT NULL DEFAULT 'system'" },
];

const storeColumns = [{ name: "tabelog_url", definition: "TEXT NOT NULL DEFAULT ''" }];

function nowIso() {
  return new Date().toISOString();
}

function buildTabelogSearchUrl(store) {
  const query = [store.name, store.address].filter(Boolean).join(" ").trim();
  return query ? `https://tabelog.com/rstLst/?sw=${encodeURIComponent(query)}` : "";
}

function auditFromRow(row) {
  return {
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function auditForInsert(record = {}, actor = systemActor) {
  const timestamp = record.createdAt || record.updatedAt || nowIso();
  const createdBy = record.createdBy || record.updatedBy || actor;
  const updatedBy = record.updatedBy || createdBy;

  return {
    createdAt: timestamp,
    updatedAt: record.updatedAt || timestamp,
    createdBy,
    updatedBy,
  };
}

function toArea(row) {
  return {
    id: row.id,
    name: row.name,
    station: row.station,
    center: {
      latitude: row.center_latitude,
      longitude: row.center_longitude,
    },
    description: row.description,
    ...auditFromRow(row),
  };
}

function toStore(row) {
  return {
    id: row.id,
    areaId: row.area_id,
    name: row.name,
    address: row.address,
    stationExit: row.station_exit,
    latitude: row.latitude,
    longitude: row.longitude,
    businessStatus: row.business_status,
    openHours: row.open_hours,
    tabelogUrl: row.tabelog_url || buildTabelogSearchUrl(row),
    tags: JSON.parse(row.tags_json || "[]"),
    description: row.description,
    ...auditFromRow(row),
  };
}

function toDrinkPrice(row) {
  return {
    id: row.id,
    storeId: row.store_id,
    category: row.category,
    drinkName: row.drink_name,
    priceYen: row.price_yen,
    taxIncluded: Boolean(row.tax_included),
    acquiredAt: row.acquired_at,
    sourceType: row.source_type,
    verificationStatus: row.verification_status,
    ...auditFromRow(row),
  };
}

function toEvent(row) {
  return {
    id: row.id,
    type: row.type,
    storeId: row.store_id,
    areaId: row.area_id,
    drinkCategory: row.drink_category,
    metadata: JSON.parse(row.metadata_json || "{}"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function splitSqlStatements(sql) {
  return sql
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function toTursoArg(value) {
  if (value === null || value === undefined) {
    return { type: "null" };
  }

  if (Buffer.isBuffer(value)) {
    return { type: "blob", base64: value.toString("base64") };
  }

  if (typeof value === "boolean") {
    return { type: "integer", value: value ? "1" : "0" };
  }

  if (Number.isInteger(value)) {
    return { type: "integer", value: String(value) };
  }

  if (typeof value === "number") {
    return { type: "float", value };
  }

  return { type: "text", value: String(value) };
}

function fromTursoValue(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "object" || !("type" in value)) {
    return value;
  }

  if (value.type === "null") {
    return null;
  }

  if (value.type === "integer") {
    return Number(value.value || 0);
  }

  if (value.type === "float") {
    return Number(value.value || 0);
  }

  if (value.type === "blob") {
    return Buffer.from(value.base64 || "", "base64");
  }

  return value.value ?? "";
}

function rowsFromTursoResult(result) {
  const columns = (result.cols || []).map((column, index) => {
    if (typeof column === "string") {
      return column;
    }

    if (Array.isArray(column)) {
      return column[0] || `column_${index}`;
    }

    return column.name || column.column || `column_${index}`;
  });

  return (result.rows || []).map((row) => {
    const values = Array.isArray(row) ? row : row.values || [];
    return columns.reduce((record, column, index) => {
      record[column] = fromTursoValue(values[index]);
      return record;
    }, {});
  });
}

function normalizeTursoDatabaseUrl(databaseUrl) {
  const trimmedUrl = String(databaseUrl || "").trim();
  if (!trimmedUrl) {
    return "";
  }

  const httpsUrl = trimmedUrl.replace(/^libsql:\/\//, "https://");
  return httpsUrl.replace(/\/v2\/pipeline\/?$/, "").replace(/\/$/, "");
}

function createLocalExecutor(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA foreign_keys = ON");

  return {
    provider: "sqlite",
    databasePath,
    databaseUrl: null,

    async exec(sql) {
      db.exec(sql);
    },

    async all(sql, args = []) {
      return db.prepare(sql).all(...args);
    },

    async get(sql, args = []) {
      return db.prepare(sql).get(...args);
    },

    async run(sql, args = []) {
      return db.prepare(sql).run(...args);
    },
  };
}

function createTursoExecutor(databaseUrl, authToken) {
  const baseUrl = normalizeTursoDatabaseUrl(databaseUrl);
  if (!baseUrl || !authToken) {
    throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required for Turso.");
  }

  async function execute(sql, args = []) {
    const response = await fetch(`${baseUrl}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            type: "execute",
            stmt: {
              sql,
              ...(args.length > 0 ? { args: args.map(toTursoArg) } : {}),
            },
          },
          { type: "close" },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Turso request failed: ${response.status} ${body}`);
    }

    const payload = await response.json();
    const failedResult = (payload.results || []).find((result) => result.type !== "ok");
    if (failedResult) {
      throw new Error(`Turso SQL failed: ${JSON.stringify(failedResult)}`);
    }

    const executeResult = (payload.results || []).find(
      (result) => result.response?.type === "execute" || result.response?.result,
    );

    return executeResult?.response?.result || { cols: [], rows: [], affected_row_count: 0 };
  }

  return {
    provider: "turso",
    databasePath: null,
    databaseUrl: baseUrl,

    async exec(sql) {
      for (const statement of splitSqlStatements(sql)) {
        await execute(statement);
      }
    },

    async all(sql, args = []) {
      return rowsFromTursoResult(await execute(sql, args));
    },

    async get(sql, args = []) {
      const rows = await this.all(sql, args);
      return rows[0];
    },

    async run(sql, args = []) {
      return execute(sql, args);
    },
  };
}

async function getTableColumns(db, tableName) {
  return (await db.all(`PRAGMA table_info(${tableName})`)).map((column) => column.name);
}

async function addMissingColumns(db, tableName, columns) {
  const existingColumns = await getTableColumns(db, tableName);
  for (const column of columns) {
    if (!existingColumns.includes(column.name)) {
      await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.definition}`);
    }
  }
}

async function backfillAuditColumns(db, tableName) {
  const timestamp = nowIso();
  await db.run(
    `
    UPDATE ${tableName}
    SET
      created_at = CASE WHEN created_at = '' THEN ? ELSE created_at END,
      updated_at = CASE WHEN updated_at = '' THEN ? ELSE updated_at END,
      created_by = CASE WHEN created_by = '' THEN ? ELSE created_by END,
      updated_by = CASE WHEN updated_by = '' THEN ? ELSE updated_by END
  `,
    [timestamp, timestamp, systemActor, systemActor],
  );
}

async function backfillStoreExternalUrls(db) {
  const rows = await db.all(
    `
    SELECT id, name, address, tabelog_url
    FROM stores
    WHERE tabelog_url = ''
  `,
  );

  if (rows.length === 0) {
    return;
  }

  const timestamp = nowIso();
  for (const row of rows) {
    await db.run(
      `
      UPDATE stores
      SET
        tabelog_url = ?,
        updated_at = ?,
        updated_by = ?
      WHERE id = ?
    `,
      [buildTabelogSearchUrl(row), timestamp, systemActor, row.id],
    );
  }
}

async function ensureSchema(db) {
  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS areas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      station TEXT NOT NULL,
      center_latitude REAL NOT NULL,
      center_longitude REAL NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'system',
      updated_by TEXT NOT NULL DEFAULT 'system'
    );

    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      area_id TEXT NOT NULL REFERENCES areas(id),
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      station_exit TEXT NOT NULL DEFAULT '',
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      business_status TEXT NOT NULL DEFAULT 'open',
      open_hours TEXT NOT NULL DEFAULT '',
      tabelog_url TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'system',
      updated_by TEXT NOT NULL DEFAULT 'system'
    );

    CREATE INDEX IF NOT EXISTS idx_stores_area_id ON stores(area_id);
    CREATE INDEX IF NOT EXISTS idx_stores_location ON stores(latitude, longitude);

    CREATE TABLE IF NOT EXISTS drink_prices (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      drink_name TEXT NOT NULL,
      price_yen INTEGER NOT NULL,
      tax_included INTEGER NOT NULL DEFAULT 1,
      acquired_at TEXT NOT NULL,
      source_type TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'verified',
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'system',
      updated_by TEXT NOT NULL DEFAULT 'system'
    );

    CREATE INDEX IF NOT EXISTS idx_drink_prices_store_id ON drink_prices(store_id);
    CREATE INDEX IF NOT EXISTS idx_drink_prices_category ON drink_prices(category);

    CREATE TABLE IF NOT EXISTS event_logs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      store_id TEXT,
      area_id TEXT,
      drink_category TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'system',
      updated_by TEXT NOT NULL DEFAULT 'system'
    );
  `);

  const areaColumns = await getTableColumns(db, "areas");
  if (!areaColumns.includes("sort_order")) {
    await db.exec("ALTER TABLE areas ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }

  for (const tableName of ["areas", "stores", "drink_prices", "event_logs"]) {
    await addMissingColumns(db, tableName, auditColumns);
    await backfillAuditColumns(db, tableName);
  }

  await addMissingColumns(db, "stores", storeColumns);
  await backfillStoreExternalUrls(db);
}

async function seedInitialData(db) {
  const areaCount = (await db.get("SELECT COUNT(*) AS count FROM areas")).count;
  const storeCount = (await db.get("SELECT COUNT(*) AS count FROM stores")).count;
  const priceCount = (await db.get("SELECT COUNT(*) AS count FROM drink_prices")).count;

  if (areaCount === 0) {
    const audit = auditForInsert({}, systemActor);
    for (const area of areas) {
      await db.run(
        `
        INSERT INTO areas (
          id,
          name,
          station,
          center_latitude,
          center_longitude,
          description,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          area.id,
          area.name,
          area.station,
          area.center.latitude,
          area.center.longitude,
          area.description,
          audit.createdAt,
          audit.updatedAt,
          audit.createdBy,
          audit.updatedBy,
        ],
      );
    }
  }

  for (const [index, area] of areas.entries()) {
    await db.run("UPDATE areas SET sort_order = ? WHERE id = ?", [index + 1, area.id]);
  }

  if (storeCount === 0) {
    const audit = auditForInsert({}, systemActor);
    for (const store of stores) {
      const tabelogUrl = store.tabelogUrl || buildTabelogSearchUrl(store);
      await db.run(
        `
        INSERT INTO stores (
          id,
          area_id,
          name,
          address,
          station_exit,
          latitude,
          longitude,
          business_status,
          open_hours,
          tabelog_url,
          tags_json,
          description,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          store.id,
          store.areaId,
          store.name,
          store.address,
          store.stationExit,
          store.latitude,
          store.longitude,
          store.businessStatus,
          store.openHours,
          tabelogUrl,
          JSON.stringify(store.tags),
          store.description,
          audit.createdAt,
          audit.updatedAt,
          audit.createdBy,
          audit.updatedBy,
        ],
      );
    }
  }

  if (priceCount === 0) {
    const audit = auditForInsert({}, systemActor);
    for (const price of drinkPrices) {
      await db.run(
        `
        INSERT INTO drink_prices (
          id,
          store_id,
          category,
          drink_name,
          price_yen,
          tax_included,
          acquired_at,
          source_type,
          verification_status,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          price.id,
          price.storeId,
          price.category,
          price.drinkName,
          price.priceYen,
          price.taxIncluded ? 1 : 0,
          price.acquiredAt,
          price.sourceType,
          price.verificationStatus,
          audit.createdAt,
          audit.updatedAt,
          audit.createdBy,
          audit.updatedBy,
        ],
      );
    }
  }
}

async function createDatabase(options = {}) {
  const tursoDatabaseUrl = options.tursoDatabaseUrl || process.env.TURSO_DATABASE_URL || "";
  const tursoAuthToken = options.tursoAuthToken || process.env.TURSO_AUTH_TOKEN || "";
  const shouldUseTurso = Boolean(tursoDatabaseUrl || tursoAuthToken);
  const shouldRequireTurso =
    options.requireTurso === true || String(process.env.REQUIRE_TURSO || "").toLowerCase() === "true";
  if (shouldRequireTurso && !shouldUseTurso) {
    throw new Error("Turso is required. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN.");
  }

  const executor = shouldUseTurso
    ? createTursoExecutor(tursoDatabaseUrl, tursoAuthToken)
    : createLocalExecutor(options.databasePath || process.env.DATABASE_PATH || defaultDatabasePath);

  await ensureSchema(executor);
  await seedInitialData(executor);

  const database = {
    provider: executor.provider,
    databasePath: executor.databasePath,
    databaseUrl: executor.databaseUrl,

    async listAreas() {
      return (
        await executor.all(`
          SELECT *
          FROM areas
          ORDER BY sort_order, name
        `)
      ).map(toArea);
    },

    async listStores(areaId = null) {
      const rows = areaId
        ? await executor.all(
            `
            SELECT *
            FROM stores
            WHERE area_id = ?
            ORDER BY name
          `,
            [areaId],
          )
        : await executor.all(`
            SELECT *
            FROM stores
            ORDER BY name
          `);

      return rows.map(toStore);
    },

    async getStoreById(storeId) {
      const row = await executor.get("SELECT * FROM stores WHERE id = ?", [storeId]);
      return row ? toStore(row) : null;
    },

    async listDrinkPricesByStoreId(storeId) {
      return (
        await executor.all(
          `
          SELECT *
          FROM drink_prices
          WHERE store_id = ?
          ORDER BY category, price_yen
        `,
          [storeId],
        )
      ).map(toDrinkPrice);
    },

    async insertStore(store, actor = systemActor) {
      const audit = auditForInsert(store, actor);
      await executor.run(
        `
        INSERT INTO stores (
          id,
          area_id,
          name,
          address,
          station_exit,
          latitude,
          longitude,
          business_status,
          open_hours,
          tabelog_url,
          tags_json,
          description,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          store.id,
          store.areaId,
          store.name,
          store.address,
          store.stationExit,
          store.latitude,
          store.longitude,
          store.businessStatus,
          store.openHours,
          store.tabelogUrl || buildTabelogSearchUrl(store),
          JSON.stringify(store.tags),
          store.description,
          audit.createdAt,
          audit.updatedAt,
          audit.createdBy,
          audit.updatedBy,
        ],
      );

      return this.getStoreById(store.id);
    },

    async updateStore(storeId, store, actor = systemActor) {
      const existingStore = await this.getStoreById(storeId);
      if (!existingStore) {
        return null;
      }

      const timestamp = nowIso();
      const nextStore = {
        ...existingStore,
        ...store,
        id: storeId,
      };

      await executor.run(
        `
        UPDATE stores
        SET
          area_id = ?,
          name = ?,
          address = ?,
          station_exit = ?,
          latitude = ?,
          longitude = ?,
          business_status = ?,
          open_hours = ?,
          tabelog_url = ?,
          tags_json = ?,
          description = ?,
          updated_at = ?,
          updated_by = ?
        WHERE id = ?
      `,
        [
          nextStore.areaId,
          nextStore.name,
          nextStore.address,
          nextStore.stationExit,
          nextStore.latitude,
          nextStore.longitude,
          nextStore.businessStatus,
          nextStore.openHours,
          nextStore.tabelogUrl || buildTabelogSearchUrl(nextStore),
          JSON.stringify(nextStore.tags),
          nextStore.description,
          timestamp,
          actor,
          storeId,
        ],
      );

      return this.getStoreById(storeId);
    },

    async insertDrinkPrice(price, actor = systemActor) {
      const audit = auditForInsert(price, actor);
      await executor.run(
        `
        INSERT INTO drink_prices (
          id,
          store_id,
          category,
          drink_name,
          price_yen,
          tax_included,
          acquired_at,
          source_type,
          verification_status,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          price.id,
          price.storeId,
          price.category,
          price.drinkName,
          price.priceYen,
          price.taxIncluded ? 1 : 0,
          price.acquiredAt,
          price.sourceType,
          price.verificationStatus,
          audit.createdAt,
          audit.updatedAt,
          audit.createdBy,
          audit.updatedBy,
        ],
      );

      return {
        ...price,
        ...audit,
      };
    },

    async insertEvent(event, actor = systemActor) {
      const audit = auditForInsert(event, actor);
      await executor.run(
        `
        INSERT INTO event_logs (
          id,
          type,
          store_id,
          area_id,
          drink_category,
          metadata_json,
          created_at,
          updated_at,
          created_by,
          updated_by
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          event.id,
          event.type,
          event.storeId,
          event.areaId,
          event.drinkCategory,
          JSON.stringify(event.metadata),
          audit.createdAt,
          audit.updatedAt,
          audit.createdBy,
          audit.updatedBy,
        ],
      );

      return {
        ...event,
        ...audit,
      };
    },

    async countEvents() {
      return (await executor.get("SELECT COUNT(*) AS count FROM event_logs")).count;
    },

    async countStores() {
      return (await executor.get("SELECT COUNT(*) AS count FROM stores")).count;
    },

    async listEvents() {
      return (
        await executor.all(`
          SELECT *
          FROM event_logs
          ORDER BY created_at DESC
          LIMIT 500
        `)
      ).map(toEvent);
    },
  };

  const shouldSeedCuratedImports =
    options.seedCuratedImports !== false &&
    String(process.env.SEED_CURATED_IMPORTS || "true").toLowerCase() !== "false";

  if (shouldSeedCuratedImports) {
    await importNakanoSourceBackedPrices(database);
  }

  return database;
}

module.exports = {
  buildTabelogSearchUrl,
  createDatabase,
  defaultDatabasePath,
};
