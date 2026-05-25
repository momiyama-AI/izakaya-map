const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

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

function getTableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name);
}

function addMissingColumns(db, tableName, columns) {
  const existingColumns = getTableColumns(db, tableName);
  for (const column of columns) {
    if (!existingColumns.includes(column.name)) {
      db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.definition}`);
    }
  }
}

function backfillAuditColumns(db, tableName) {
  const timestamp = nowIso();
  db.prepare(
    `
    UPDATE ${tableName}
    SET
      created_at = CASE WHEN created_at = '' THEN ? ELSE created_at END,
      updated_at = CASE WHEN updated_at = '' THEN ? ELSE updated_at END,
      created_by = CASE WHEN created_by = '' THEN ? ELSE created_by END,
      updated_by = CASE WHEN updated_by = '' THEN ? ELSE updated_by END
  `,
  ).run(timestamp, timestamp, systemActor, systemActor);
}

function backfillStoreExternalUrls(db) {
  const rows = db
    .prepare(
      `
      SELECT id, name, address, tabelog_url
      FROM stores
      WHERE tabelog_url = ''
    `,
    )
    .all();

  if (rows.length === 0) {
    return;
  }

  const timestamp = nowIso();
  const updateStore = db.prepare(`
    UPDATE stores
    SET
      tabelog_url = ?,
      updated_at = ?,
      updated_by = ?
    WHERE id = ?
  `);

  for (const row of rows) {
    updateStore.run(buildTabelogSearchUrl(row), timestamp, systemActor, row.id);
  }
}

function ensureSchema(db) {
  db.exec(`
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

  const areaColumns = getTableColumns(db, "areas");
  if (!areaColumns.includes("sort_order")) {
    db.exec("ALTER TABLE areas ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }

  for (const tableName of ["areas", "stores", "drink_prices", "event_logs"]) {
    addMissingColumns(db, tableName, auditColumns);
    backfillAuditColumns(db, tableName);
  }

  addMissingColumns(db, "stores", storeColumns);
  backfillStoreExternalUrls(db);
}

function seedInitialData(db) {
  const areaCount = db.prepare("SELECT COUNT(*) AS count FROM areas").get().count;
  const storeCount = db.prepare("SELECT COUNT(*) AS count FROM stores").get().count;
  const priceCount = db.prepare("SELECT COUNT(*) AS count FROM drink_prices").get().count;

  if (areaCount === 0) {
    const audit = auditForInsert({}, systemActor);
    const insertArea = db.prepare(`
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
    `);

    for (const area of areas) {
      insertArea.run(
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
      );
    }
  }

  const updateAreaOrder = db.prepare("UPDATE areas SET sort_order = ? WHERE id = ?");
  areas.forEach((area, index) => updateAreaOrder.run(index + 1, area.id));

  if (storeCount === 0) {
    const audit = auditForInsert({}, systemActor);
    const insertStore = db.prepare(`
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
    `);

    for (const store of stores) {
      const tabelogUrl = store.tabelogUrl || buildTabelogSearchUrl(store);
      insertStore.run(
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
      );
    }
  }

  if (priceCount === 0) {
    const audit = auditForInsert({}, systemActor);
    const insertPrice = db.prepare(`
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
    `);

    for (const price of drinkPrices) {
      insertPrice.run(
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
      );
    }
  }
}

function createDatabase(options = {}) {
  const databasePath = options.databasePath || process.env.DATABASE_PATH || defaultDatabasePath;
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  ensureSchema(db);
  seedInitialData(db);

  return {
    databasePath,

    listAreas() {
      return db
        .prepare(
          `
          SELECT *
          FROM areas
          ORDER BY sort_order, name
        `,
        )
        .all()
        .map(toArea);
    },

    listStores(areaId = null) {
      const rows = areaId
        ? db
            .prepare(
              `
              SELECT *
              FROM stores
              WHERE area_id = ?
              ORDER BY name
            `,
            )
            .all(areaId)
        : db
            .prepare(
              `
              SELECT *
              FROM stores
              ORDER BY name
            `,
            )
            .all();

      return rows.map(toStore);
    },

    getStoreById(storeId) {
      const row = db.prepare("SELECT * FROM stores WHERE id = ?").get(storeId);
      return row ? toStore(row) : null;
    },

    listDrinkPricesByStoreId(storeId) {
      return db
        .prepare(
          `
          SELECT *
          FROM drink_prices
          WHERE store_id = ?
          ORDER BY category, price_yen
        `,
        )
        .all(storeId)
        .map(toDrinkPrice);
    },

    insertStore(store, actor = systemActor) {
      const audit = auditForInsert(store, actor);
      db.prepare(
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
      ).run(
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
      );

      return this.getStoreById(store.id);
    },

    updateStore(storeId, store, actor = systemActor) {
      const existingStore = this.getStoreById(storeId);
      if (!existingStore) {
        return null;
      }

      const timestamp = nowIso();
      const nextStore = {
        ...existingStore,
        ...store,
        id: storeId,
      };

      db.prepare(
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
      ).run(
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
      );

      return this.getStoreById(storeId);
    },

    insertDrinkPrice(price, actor = systemActor) {
      const audit = auditForInsert(price, actor);
      db.prepare(
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
      ).run(
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
      );

      return {
        ...price,
        ...audit,
      };
    },

    insertEvent(event, actor = systemActor) {
      const audit = auditForInsert(event, actor);
      db.prepare(
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
      ).run(
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
      );

      return {
        ...event,
        ...audit,
      };
    },

    countEvents() {
      return db.prepare("SELECT COUNT(*) AS count FROM event_logs").get().count;
    },

    countStores() {
      return db.prepare("SELECT COUNT(*) AS count FROM stores").get().count;
    },

    listEvents() {
      return db
        .prepare(
          `
          SELECT *
          FROM event_logs
          ORDER BY created_at DESC
          LIMIT 500
        `,
        )
        .all()
        .map(toEvent);
    },
  };
}

module.exports = {
  buildTabelogSearchUrl,
  createDatabase,
  defaultDatabasePath,
};
