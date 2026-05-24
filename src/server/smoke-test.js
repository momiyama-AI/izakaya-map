const assert = require("node:assert/strict");

const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:8080";

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`);
  assert.equal(response.ok, true, `${path} returned ${response.status}`);
  return response.json();
}

async function run() {
  const health = await getJson("/api/v1/health");
  assert.equal(health.status, "ok");

  const areas = await getJson("/api/v1/areas");
  assert.ok(areas.areas.length >= 2, "areas should contain seed data");

  const stores = await getJson("/api/v1/stores?area_id=AREA-SHINJUKU&drink_category=highball");
  assert.ok(stores.stores.length >= 1, "stores should contain search results");
  assert.ok(stores.stores[0].selectedPrice.priceYen > 0, "stores should include selected price");

  console.log(`Smoke test passed: ${baseUrl}`);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

