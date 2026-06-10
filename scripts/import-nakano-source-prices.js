const fs = require("node:fs");
const path = require("node:path");

const { createDatabase } = require("../src/data/database");

const rootDir = path.resolve(__dirname, "..");
const sourceCsvPath =
  process.env.NAKANO_SOURCE_CSV ||
  path.join(rootDir, "data", "nakano-izakaya-source-backed-prices-2026-06-10.csv");
const actor = process.env.IMPORT_ACTOR || "nakano-web-import";

const geocodes = {
  "nakano-toriichizu-kitakuchi": {
    latitude: 35.7078365,
    longitude: 139.6661277,
    status: "nominatim_exact",
  },
  "nakano-wan-kitakuchi": {
    latitude: 35.706873,
    longitude: 139.665445,
    status: "nominatim_exact",
  },
  "nakano-mekiki-ginji-kitakuchi": {
    latitude: 35.7077216,
    longitude: 139.6660973,
    status: "nominatim_exact",
  },
  "nakano-oyadoriya": {
    latitude: 35.7074777,
    longitude: 139.6662988,
    status: "nominatim_exact",
  },
  "nakano-maki": {
    latitude: 35.708609,
    longitude: 139.665479,
    status: "navitime_checked",
  },
  "nakano-alekore": {
    latitude: 35.707553,
    longitude: 139.666887,
    status: "navitime_checked",
  },
  "nakano-torikizoku-kitakuchi": {
    latitude: 35.7078393,
    longitude: 139.6663097,
    status: "nominatim_exact",
  },
  "nakano-gindaco-sunmall": {
    latitude: 35.7066736,
    longitude: 139.6658313,
    status: "nominatim_exact",
  },
  "nakano-toriyasu": {
    latitude: 35.7078393,
    longitude: 139.6663097,
    status: "nominatim_exact",
  },
  "nakano-gyoza-sakaba-24h": {
    latitude: 35.7078253,
    longitude: 139.6659298,
    status: "nominatim_exact",
  },
  "nakano-enya": {
    latitude: 35.7074442,
    longitude: 139.6665105,
    status: "nominatim_exact",
  },
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [headerRow, ...dataRows] = rows;
  const headers = headerRow.map((value) => value.replace(/^\uFEFF/, ""));

  return dataRows.map((dataRow) =>
    headers.reduce((record, header, index) => {
      record[header] = dataRow[index] || "";
      return record;
    }, {}),
  );
}

function normalize(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toStoreId(storeKey) {
  return `STORE-WEB-NKN-${storeKey
    .replace(/^nakano-/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()}`;
}

function toPriceId(storeKey, category) {
  return `PRICE-WEB-NKN-${storeKey
    .replace(/^nakano-/, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toUpperCase()}-${category.toUpperCase()}`;
}

function groupByStore(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const storeKey = row.store_key;
    if (!grouped.has(storeKey)) {
      grouped.set(storeKey, []);
    }
    grouped.get(storeKey).push(row);
  }
  return grouped;
}

function buildStore(storeKey, rows) {
  const first = rows[0];
  const geocode = geocodes[storeKey];

  if (!geocode) {
    throw new Error(`Missing geocode for ${storeKey}`);
  }

  const drinkSourceUrls = Array.from(
    new Set(rows.map((row) => row.drink_source_url).filter(Boolean)),
  );
  const confidenceLabels = Array.from(new Set(rows.map((row) => row.confidence).filter(Boolean)));

  return {
    id: toStoreId(storeKey),
    areaId: first.area_id,
    name: first.store_name,
    address: first.address,
    stationExit: first.station_exit,
    latitude: geocode.latitude,
    longitude: geocode.longitude,
    businessStatus: "open",
    openHours: first.open_hours,
    tabelogUrl: first.tabelog_url,
    tags: [
      "Web調査",
      "中野",
      `geocode:${geocode.status}`,
      confidenceLabels.includes("medium") ? "一部要確認" : "出典確認済み",
    ],
    description: [
      "中野区Web調査で追加した店舗です。",
      `ドリンク価格の確認日: ${first.collected_at}`,
      `価格出典: ${drinkSourceUrls.join(" / ")}`,
      "税込明記がない行はWeb表示価格として登録し、継続確認対象にしています。",
    ].join(" "),
    createdBy: actor,
    updatedBy: actor,
  };
}

function buildDrinkPrice(storeId, storeKey, row) {
  const priceYen = Number.parseInt(row.price_yen, 10);
  if (!Number.isInteger(priceYen) || priceYen <= 0) {
    throw new Error(`Invalid price for ${storeKey}/${row.drink_category}: ${row.price_yen}`);
  }

  return {
    id: toPriceId(storeKey, row.drink_category),
    storeId,
    category: row.drink_category,
    drinkName: row.matched_item_name,
    priceYen,
    taxIncluded: true,
    acquiredAt: row.collected_at,
    sourceType: "web_menu",
    verificationStatus: "verified",
    createdBy: actor,
    updatedBy: actor,
  };
}

async function main() {
  const rows = parseCsv(fs.readFileSync(sourceCsvPath, "utf8"));
  const grouped = groupByStore(rows);
  const database = await createDatabase();
  const existingStores = await database.listStores("AREA-NAKANO");
  const existingByNameAddress = new Map(
    existingStores.map((store) => [
      `${normalize(store.name)}|${normalize(store.address)}`,
      store,
    ]),
  );

  const result = {
    provider: database.provider,
    sourceCsvPath,
    storesInserted: 0,
    storesUpdated: 0,
    pricesInserted: 0,
    pricesSkipped: 0,
    importedStores: [],
  };

  for (const [storeKey, storeRows] of grouped.entries()) {
    const nextStore = buildStore(storeKey, storeRows);
    const nameAddressKey = `${normalize(nextStore.name)}|${normalize(nextStore.address)}`;
    const existingStore =
      (await database.getStoreById(nextStore.id)) || existingByNameAddress.get(nameAddressKey);

    const store = existingStore
      ? await database.updateStore(existingStore.id, nextStore, actor)
      : await database.insertStore(nextStore, actor);

    if (existingStore) {
      result.storesUpdated += 1;
    } else {
      result.storesInserted += 1;
    }

    const existingPrices = await database.listDrinkPricesByStoreId(store.id);
    const existingPriceIds = new Set(existingPrices.map((price) => price.id));

    for (const row of storeRows) {
      const price = buildDrinkPrice(store.id, storeKey, row);
      if (existingPriceIds.has(price.id)) {
        result.pricesSkipped += 1;
        continue;
      }
      await database.insertDrinkPrice(price, actor);
      result.pricesInserted += 1;
      existingPriceIds.add(price.id);
    }

    result.importedStores.push({
      id: store.id,
      name: store.name,
      latitude: store.latitude,
      longitude: store.longitude,
      priceRows: storeRows.length,
    });
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
