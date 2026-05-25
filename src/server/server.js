const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");

const { createDatabase } = require("../data/database");
const {
  calculateFreshnessStatus,
  canPublishDrinkPrice,
  formatYen,
  getDistanceMeters,
} = require("../domain/price-policy");

const rootDir = path.resolve(__dirname, "../..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 5173);
const adminToken = process.env.ADMIN_TOKEN || "change-me-local-admin-token";
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || "";
const googleMapsMapId = process.env.GOOGLE_MAPS_MAP_ID || "";
let database;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendError(response, statusCode, message, details = undefined) {
  sendJson(response, statusCode, {
    error: {
      message,
      details,
    },
  });
}

function safeFilePath(requestPath) {
  const normalizedPath = decodeURIComponent(requestPath.split("?")[0]);
  const candidate = path.normalize(path.join(publicDir, normalizedPath));
  if (!candidate.startsWith(publicDir)) {
    return null;
  }

  return candidate;
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname =
    url.pathname === "/" ? "/index.html" : url.pathname === "/admin" ? "/admin.html" : url.pathname;
  const filePath = safeFilePath(pathname);

  if (!filePath) {
    sendError(response, 403, "Forbidden");
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "content-type": mimeTypes[extension] || "application/octet-stream",
    "cache-control": "no-cache",
  });
  fs.createReadStream(filePath).pipe(response);
  return true;
}

function parseRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function requireAdmin(request, response) {
  const token = request.headers["x-admin-token"];
  if (token !== adminToken) {
    sendError(response, 401, "Admin token is required.");
    return false;
  }

  return true;
}

function getActor(request, fallback = "app") {
  const headerValue = request.headers["x-admin-user"] || request.headers["x-user"];
  if (Array.isArray(headerValue)) {
    return headerValue[0] || fallback;
  }

  return headerValue || fallback;
}

async function enrichStore(store, options = {}) {
  const prices = (await database.listDrinkPricesByStoreId(store.id))
    .filter(canPublishDrinkPrice)
    .map((price) => ({
      ...price,
      formattedPrice: formatYen(price.priceYen),
      freshnessStatus: calculateFreshnessStatus(price.acquiredAt),
    }));

  const selectedPrice = options.category
    ? prices.find((price) => price.category === options.category)
    : prices[0];

  const distanceMeters = options.origin
    ? getDistanceMeters(options.origin, {
        latitude: store.latitude,
        longitude: store.longitude,
      })
    : null;

  return {
    ...store,
    mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${store.name} ${store.address}`,
    )}`,
    prices,
    selectedPrice,
    distanceMeters,
  };
}

async function listStores(url) {
  const areaId = url.searchParams.get("area_id");
  const category = url.searchParams.get("drink_category") || "highball";
  const sort = url.searchParams.get("sort") || "price_asc";
  const latitudeParam = url.searchParams.get("latitude");
  const longitudeParam = url.searchParams.get("longitude");
  const radiusParam = url.searchParams.get("radius_m");
  const latitude = latitudeParam === null ? Number.NaN : Number(latitudeParam);
  const longitude = longitudeParam === null ? Number.NaN : Number(longitudeParam);
  const radiusMeters = radiusParam === null ? Number.NaN : Number(radiusParam);
  const hasOrigin = Number.isFinite(latitude) && Number.isFinite(longitude);
  const origin = hasOrigin ? { latitude, longitude } : null;

  const filteredStores = (await Promise.all(
    (await database.listStores(areaId)).map((store) => enrichStore(store, { category, origin })),
  )).filter((store) => {
    if (!origin || !Number.isFinite(radiusMeters)) {
      return true;
    }

    return store.distanceMeters <= radiusMeters;
  });

  const sortedStores = [...filteredStores].sort((a, b) => {
    if (sort === "distance_asc" && origin) {
      return a.distanceMeters - b.distanceMeters;
    }

    if (!a.selectedPrice && !b.selectedPrice) {
      return a.name.localeCompare(b.name, "ja-JP");
    }

    if (!a.selectedPrice) {
      return 1;
    }

    if (!b.selectedPrice) {
      return -1;
    }

    if (sort === "freshness_desc") {
      return a.selectedPrice.acquiredAt < b.selectedPrice.acquiredAt ? 1 : -1;
    }

    return a.selectedPrice.priceYen - b.selectedPrice.priceYen;
  });

  return {
    filters: {
      areaId,
      category,
      sort,
      radiusMeters: Number.isFinite(radiusMeters) ? radiusMeters : null,
    },
    stores: sortedStores,
  };
}

async function createEvent(payload, actor = "app") {
  const event = {
    id: `EVT-${String((await database.countEvents()) + 1).padStart(5, "0")}`,
    type: payload.type || "unknown",
    storeId: payload.storeId || null,
    areaId: payload.areaId || null,
    drinkCategory: payload.drinkCategory || null,
    metadata: payload.metadata || {},
    createdAt: new Date().toISOString(),
    createdBy: payload.createdBy || actor,
    updatedBy: payload.updatedBy || payload.createdBy || actor,
  };
  return database.insertEvent(event, actor);
}

function storePayloadFromAdmin(payload, actor) {
  return {
    areaId: payload.areaId,
    name: payload.name,
    address: payload.address,
    stationExit: payload.stationExit || "",
    latitude: Number(payload.latitude),
    longitude: Number(payload.longitude),
    businessStatus: payload.businessStatus || "open",
    openHours: payload.openHours || "",
    tabelogUrl: payload.tabelogUrl || "",
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    description: payload.description || "",
    createdBy: payload.createdBy || actor,
    updatedBy: payload.updatedBy || payload.createdBy || actor,
  };
}

async function handleApi(request, response, url) {
  const pathname = url.pathname;

  if (request.method === "GET" && pathname === "/api/v1/health") {
    sendJson(response, 200, {
      status: "ok",
      service: "izakaya-price-map",
      database: {
        provider: database.provider,
        target: database.databasePath || new URL(database.databaseUrl).host,
        stores: await database.countStores(),
      },
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/v1/config") {
    sendJson(response, 200, {
      maps: {
        provider: googleMapsApiKey ? "google" : "fallback",
        googleMapsApiKey: googleMapsApiKey || null,
        googleMapsMapId: googleMapsMapId || null,
      },
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/v1/areas") {
    sendJson(response, 200, { areas: await database.listAreas() });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/v1/stores") {
    sendJson(response, 200, await listStores(url));
    return true;
  }

  const storeMatch = pathname.match(/^\/api\/v1\/stores\/([^/]+)$/);
  if (request.method === "GET" && storeMatch) {
    const store = await database.getStoreById(storeMatch[1]);
    if (!store) {
      sendError(response, 404, "Store was not found.");
      return true;
    }

    sendJson(response, 200, { store: await enrichStore(store) });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/v1/events") {
    try {
      const payload = await parseRequestBody(request);
      sendJson(response, 201, { event: await createEvent(payload, getActor(request, "app")) });
    } catch (error) {
      sendError(response, 400, "Invalid event payload.", error.message);
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/v1/admin/events") {
    if (!requireAdmin(request, response)) {
      return true;
    }

    sendJson(response, 200, { events: await database.listEvents() });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/v1/admin/stores") {
    if (!requireAdmin(request, response)) {
      return true;
    }

    try {
      const actor = getActor(request, "admin");
      const payload = await parseRequestBody(request);
      const store = {
        id: `STORE-${Date.now()}`,
        ...storePayloadFromAdmin(payload, actor),
      };
      const createdStore = await database.insertStore(store, actor);
      sendJson(response, 201, { store: await enrichStore(createdStore) });
    } catch (error) {
      sendError(response, 400, "Invalid store payload.", error.message);
    }
    return true;
  }

  const adminStoreMatch = pathname.match(/^\/api\/v1\/admin\/stores\/([^/]+)$/);
  if ((request.method === "PUT" || request.method === "PATCH") && adminStoreMatch) {
    if (!requireAdmin(request, response)) {
      return true;
    }

    try {
      const actor = getActor(request, "admin");
      const payload = await parseRequestBody(request);
      const updatedStore = await database.updateStore(
        adminStoreMatch[1],
        storePayloadFromAdmin(payload, actor),
        actor,
      );

      if (!updatedStore) {
        sendError(response, 404, "Store was not found.");
        return true;
      }

      sendJson(response, 200, { store: await enrichStore(updatedStore) });
    } catch (error) {
      sendError(response, 400, "Invalid store payload.", error.message);
    }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/v1/admin/drink-prices") {
    if (!requireAdmin(request, response)) {
      return true;
    }

    try {
      const actor = getActor(request, "admin");
      const payload = await parseRequestBody(request);
      const price = {
        id: `PRICE-${Date.now()}`,
        storeId: payload.storeId,
        category: payload.category,
        drinkName: payload.drinkName,
        priceYen: Number(payload.priceYen),
        taxIncluded: payload.taxIncluded !== false,
        acquiredAt: payload.acquiredAt,
        sourceType: payload.sourceType,
        verificationStatus: payload.verificationStatus || "verified",
        createdBy: payload.createdBy || actor,
        updatedBy: payload.updatedBy || payload.createdBy || actor,
      };

      if (!canPublishDrinkPrice(price)) {
        sendError(response, 422, "Drink price does not satisfy publishing policy.");
        return true;
      }

      sendJson(response, 201, { price: await database.insertDrinkPrice(price, actor) });
    } catch (error) {
      sendError(response, 400, "Invalid drink price payload.", error.message);
    }
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (!handled) {
        sendError(response, 404, "API endpoint was not found.");
      }
      return;
    }

    const served = serveStatic(request, response);
    if (!served) {
      response.writeHead(302, { location: "/" });
      response.end();
    }
  } catch (error) {
    sendError(response, 500, "Unexpected server error.", error.message);
  }
});

async function main() {
  database = await createDatabase();
  server.listen(port, () => {
    console.log(`Izakaya price map is running on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
