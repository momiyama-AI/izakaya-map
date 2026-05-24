const { buildTabelogSearchUrl, createDatabase } = require("../src/data/database");

const overpassEndpoint =
  process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter";
const targetPerArea = Number(process.env.OSM_IMPORT_TARGET_PER_AREA || 100);
const actor = "osm-import";

const areaConfigs = [
  {
    areaId: "AREA-SHINJUKU",
    idPart: "SJK",
    name: "\u65b0\u5bbf",
    fallbackAddress: "\u6771\u4eac\u90fd\u65b0\u5bbf\u533a\uff08OpenStreetMap\u4f4d\u7f6e\u60c5\u5831\uff09",
    center: { latitude: 35.690921, longitude: 139.700258 },
    radiusMeters: 1600,
  },
  {
    areaId: "AREA-NAKANO",
    idPart: "NKN",
    name: "\u4e2d\u91ce",
    fallbackAddress: "\u6771\u4eac\u90fd\u4e2d\u91ce\u533a\uff08OpenStreetMap\u4f4d\u7f6e\u60c5\u5831\uff09",
    center: { latitude: 35.706032, longitude: 139.665652 },
    radiusMeters: 1500,
  },
];

const keywords = [
  "\u5c45\u9152\u5c4b",
  "\u9152",
  "\u5451",
  "\u98f2",
  "\u713c\u9ce5",
  "\u3084\u304d\u3068\u308a",
  "\u4e32",
  "\u9ce5",
  "\u9b5a",
  "\u8089",
  "\u30db\u30eb\u30e2\u30f3",
  "\u30d0\u30eb",
  "\u30d3\u30fc\u30eb",
  "\u70ad",
  "\u3082\u3064",
  "\u9903\u5b50",
  "\u713c\u8089",
  "\u7089",
  "\u6d77\u9bae",
  "\u5bff\u53f8",
  "\u9ba8",
  "\u9152\u5834",
  "\u5927\u8846",
  "\u7acb\u3061",
  "BAL",
  "BAR",
  "Bar",
  "bar",
  "PUB",
  "Pub",
  "pub",
  "Beer",
  "BEER",
];

const cuisinePriority = new Map([
  ["izakaya", 0],
  ["yakitori", 1],
  ["japanese", 2],
  ["seafood", 3],
  ["sushi", 4],
  ["yakiniku", 4],
  ["gyoza", 5],
  ["teppanyaki", 5],
  ["okonomiyaki", 5],
  ["korean", 6],
  ["chinese", 7],
  ["ramen", 8],
  ["soba", 9],
  ["udon", 9],
  ["curry", 10],
]);

function buildOverpassQuery(area) {
  const { latitude, longitude } = area.center;
  const radius = area.radiusMeters;
  return `
    [out:json][timeout:60];
    (
      node["name"]["amenity"~"^(restaurant|pub|bar|biergarten)$"](around:${radius},${latitude},${longitude});
      way["name"]["amenity"~"^(restaurant|pub|bar|biergarten)$"](around:${radius},${latitude},${longitude});
      relation["name"]["amenity"~"^(restaurant|pub|bar|biergarten)$"](around:${radius},${latitude},${longitude});
    );
    out center tags;
  `;
}

function getDistanceMeters(origin, destination) {
  const radiusMeters = 6_371_000;
  const toRad = (degree) => (degree * Math.PI) / 180;
  const dLat = toRad(destination.latitude - origin.latitude);
  const dLng = toRad(destination.longitude - origin.longitude);
  const lat1 = toRad(origin.latitude);
  const lat2 = toRad(destination.latitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(radiusMeters * c);
}

function normalizeName(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getElementPosition(element) {
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function getCuisineValues(tags) {
  return String(tags.cuisine || "")
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function matchesKeyword(tags) {
  const searchable = [
    tags.name,
    tags["name:ja"],
    tags.brand,
    tags.operator,
  ]
    .filter(Boolean)
    .join(" ");
  return keywords.some((keyword) => searchable.includes(keyword));
}

function isLikelyIzakayaCandidate(element) {
  const tags = element.tags || {};
  if (tags.amenity === "pub" || tags.amenity === "bar") {
    return true;
  }

  if (matchesKeyword(tags)) {
    return true;
  }

  return getCuisineValues(tags).some((value) => cuisinePriority.has(value));
}

function rankCandidate(area, element) {
  const tags = element.tags || {};
  const cuisines = getCuisineValues(tags);
  const bestCuisinePriority = cuisines.reduce((best, cuisine) => {
    const priority = cuisinePriority.get(cuisine);
    return priority === undefined ? best : Math.min(best, priority);
  }, 20);
  const position = getElementPosition(element);
  const distance = position ? getDistanceMeters(area.center, position) : 999_999;

  if (tags.amenity === "pub") {
    return distance;
  }

  if (tags.amenity === "bar") {
    return 1_000 + distance;
  }

  if (matchesKeyword(tags)) {
    return 2_000 + distance;
  }

  return 3_000 + bestCuisinePriority * 100 + distance;
}

function buildAddress(tags, area) {
  if (tags["addr:full"]) {
    return tags["addr:full"];
  }

  const parts = [
    tags["addr:province"],
    tags["addr:city"],
    tags["addr:ward"],
    tags["addr:suburb"],
    tags["addr:quarter"],
    tags["addr:neighbourhood"],
    tags["addr:block_number"],
    tags["addr:housenumber"],
    tags["addr:street"],
  ]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);

  return parts.length > 0 ? parts.join("") : area.fallbackAddress;
}

function buildTags(tags) {
  const result = [
    "OpenStreetMap",
    "\u4fa1\u683c\u672a\u78ba\u8a8d",
    tags.amenity ? `amenity:${tags.amenity}` : null,
  ];

  for (const cuisine of getCuisineValues(tags).slice(0, 2)) {
    result.push(`cuisine:${cuisine}`);
  }

  return result.filter(Boolean);
}

function toStore(area, element) {
  const tags = element.tags || {};
  const position = getElementPosition(element);
  const source = `${element.type}/${element.id}`;
  const store = {
    name: normalizeName(tags.name || tags["name:ja"]),
    address: buildAddress(tags, area),
  };

  return {
    id: `STORE-OSM-${area.idPart}-${element.type.toUpperCase()}-${element.id}`,
    areaId: area.areaId,
    name: store.name,
    address: store.address,
    stationExit: "OpenStreetMap",
    latitude: position.latitude,
    longitude: position.longitude,
    businessStatus: "open",
    openHours: tags.opening_hours || "\u672a\u78ba\u8a8d",
    tabelogUrl: buildTabelogSearchUrl(store),
    tags: buildTags(tags),
    description: `OpenStreetMap\u304b\u3089\u53d6\u5f97\u3057\u305f\u5e97\u8217\u4f4d\u7f6e\u60c5\u5831\u3067\u3059\u3002\u30c9\u30ea\u30f3\u30af\u4fa1\u683c\u306f\u672a\u78ba\u8a8d\u3067\u3059\u3002source=osm/${source}`,
    createdBy: actor,
    updatedBy: actor,
  };
}

function dedupeCandidates(area, elements) {
  const seen = new Set();
  return elements
    .filter((element) => element.tags?.name)
    .filter((element) => getElementPosition(element))
    .filter(isLikelyIzakayaCandidate)
    .sort((a, b) => rankCandidate(area, a) - rankCandidate(area, b))
    .filter((element) => {
      const position = getElementPosition(element);
      const key = [
        normalizeName(element.tags.name).toLowerCase(),
        position.latitude.toFixed(4),
        position.longitude.toFixed(4),
      ].join("|");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

async function fetchOsmElements(area) {
  const response = await fetch(overpassEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "user-agent": "codex-izakaya-map-import/0.1",
    },
    body: new URLSearchParams({ data: buildOverpassQuery(area) }),
  });

  if (!response.ok) {
    throw new Error(`Overpass API failed for ${area.name}: ${response.status}`);
  }

  const payload = await response.json();
  return payload.elements || [];
}

async function importArea(database, area) {
  const allStores = database.listStores(area.areaId);
  const existingIds = new Set(allStores.map((store) => store.id));
  const existingSourceRows = allStores.filter((store) =>
    store.id.startsWith(`STORE-OSM-${area.idPart}-`),
  ).length;
  const requiredCount = Math.max(0, targetPerArea - existingSourceRows);

  if (requiredCount === 0) {
    return {
      area: area.name,
      fetched: 0,
      candidates: 0,
      inserted: 0,
      skipped: 0,
      totalOsmRows: existingSourceRows,
    };
  }

  const elements = await fetchOsmElements(area);
  const candidates = dedupeCandidates(area, elements);
  const existingNames = new Set(allStores.map((store) => normalizeName(store.name)));
  let inserted = 0;
  let skipped = 0;

  for (const element of candidates) {
    if (inserted >= requiredCount) {
      break;
    }

    const store = toStore(area, element);
    if (existingIds.has(store.id) || existingNames.has(store.name)) {
      skipped += 1;
      continue;
    }

    database.insertStore(store, actor);
    existingIds.add(store.id);
    existingNames.add(store.name);
    inserted += 1;
  }

  return {
    area: area.name,
    fetched: elements.length,
    candidates: candidates.length,
    inserted,
    skipped,
    totalOsmRows: existingSourceRows + inserted,
  };
}

async function main() {
  if (!Number.isInteger(targetPerArea) || targetPerArea <= 0) {
    throw new Error("OSM_IMPORT_TARGET_PER_AREA must be a positive integer.");
  }

  const database = createDatabase();
  const results = [];
  for (const area of areaConfigs) {
    results.push(await importArea(database, area));
  }

  console.log(JSON.stringify({ targetPerArea, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
