const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { areas, stores, drinkPrices } = require("./seed-data");

const rootDir = path.resolve(__dirname, "../..");
const defaultDatabasePath = path.join(rootDir, ".local", "izakaya-map.sqlite");

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
    tags: JSON.parse(row.tags_json || "[]"),
    description: row.description,
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
  };
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
      description TEXT NOT NULL DEFAULT ''
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
      tags_json TEXT NOT NULL DEFAULT '[]',
      description TEXT NOT NULL DEFAULT ''
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
      verification_status TEXT NOT NULL DEFAULT 'verified'
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
      created_at TEXT NOT NULL
    );
  `);

  const areaColumns = db.prepare("PRAGMA table_info(areas)").all().map((column) => column.name);
  if (!areaColumns.includes("sort_order")) {
    db.exec("ALTER TABLE areas ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }
}

function seedInitialData(db) {
  const areaCount = db.prepare("SELECT COUNT(*) AS count FROM areas").get().count;
  const storeCount = db.prepare("SELECT COUNT(*) AS count FROM stores").get().count;
  const priceCount = db.prepare("SELECT COUNT(*) AS count FROM drink_prices").get().count;

  if (areaCount === 0) {
    const insertArea = db.prepare(`
      INSERT INTO areas (id, name, station, center_latitude, center_longitude, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const area of areas) {
      insertArea.run(
        area.id,
        area.name,
        area.station,
        area.center.latitude,
        area.center.longitude,
        area.description,
      );
    }
  }

  const updateAreaOrder = db.prepare("UPDATE areas SET sort_order = ? WHERE id = ?");
  areas.forEach((area, index) => updateAreaOrder.run(index + 1, area.id));

  if (storeCount === 0) {
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
        tags_json,
        description
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const store of stores) {
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
        JSON.stringify(store.tags),
        store.description,
      );
    }
  }

  if (priceCount === 0) {
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
        verification_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          SELECT id, name, station, center_latitude, center_longitude, description
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

    insertStore(store) {
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
          tags_json,
          description
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        JSON.stringify(store.tags),
        store.description,
      );

      return this.getStoreById(store.id);
    },

    insertDrinkPrice(price) {
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
          verification_status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      );

      return price;
    },

    insertEvent(event) {
      db.prepare(
        `
        INSERT INTO event_logs (
          id,
          type,
          store_id,
          area_id,
          drink_category,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        event.id,
        event.type,
        event.storeId,
        event.areaId,
        event.drinkCategory,
        JSON.stringify(event.metadata),
        event.createdAt,
      );

      return event;
    },

    countEvents() {
      return db.prepare("SELECT COUNT(*) AS count FROM event_logs").get().count;
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
  createDatabase,
  defaultDatabasePath,
};
