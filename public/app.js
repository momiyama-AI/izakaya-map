const drinkLabels = {
  highball: "ハイボール",
  beer: "生ビール",
  lemon_sour: "レモンサワー",
};

const state = {
  areas: [],
  config: { maps: { provider: "fallback" } },
  googleMap: null,
  googleMarkers: new Map(),
  googleUserMarker: null,
  searchMode: "area",
  selectedAreaId: null,
  selectedDrink: "highball",
  sort: "price_asc",
  stores: [],
  selectedStoreId: null,
  userLocation: null,
};

const elements = {
  serviceStatus: document.querySelector("#serviceStatus"),
  areaTabs: document.querySelector("#areaTabs"),
  locateButton: document.querySelector("#locateButton"),
  locationHint: document.querySelector("#locationHint"),
  drinkTabs: document.querySelector("#drinkTabs"),
  sortSelect: document.querySelector("#sortSelect"),
  refreshButton: document.querySelector("#refreshButton"),
  areaTitle: document.querySelector("#areaTitle"),
  resultTitle: document.querySelector("#resultTitle"),
  resultCount: document.querySelector("#resultCount"),
  storeList: document.querySelector("#storeList"),
  mapCanvas: document.querySelector("#mapCanvas"),
  storeDetail: document.querySelector("#storeDetail"),
};

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`);
  }

  return response.json();
}

async function track(type, payload = {}) {
  try {
    await requestJson("/api/v1/events", {
      method: "POST",
      body: JSON.stringify({
        type,
        areaId: state.selectedAreaId,
        drinkCategory: state.selectedDrink,
        ...payload,
      }),
    });
  } catch {
    // Analytics must not block the core search experience.
  }
}

function setStatus(ok) {
  elements.serviceStatus.textContent = ok ? "API接続済み" : "API未接続";
  elements.serviceStatus.classList.toggle("ok", ok);
}

function isLocationMode() {
  return state.searchMode === "location" && state.userLocation;
}

function selectedArea() {
  return state.areas.find((area) => area.id === state.selectedAreaId);
}

function currentMapCenter() {
  if (isLocationMode()) {
    return {
      latitude: state.userLocation.latitude,
      longitude: state.userLocation.longitude,
      label: "現在地",
    };
  }

  const area = selectedArea();
  if (!area) {
    return null;
  }

  return {
    latitude: area.center.latitude,
    longitude: area.center.longitude,
    label: "駅",
  };
}

function formatFreshnessLabel(status) {
  if (status === "fresh") {
    return "新しい";
  }

  if (status === "warning") {
    return "要確認";
  }

  return "古い";
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return "";
  }

  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)}km`;
  }

  return `${distanceMeters}m`;
}

function renderAreaTabs() {
  elements.areaTabs.innerHTML = "";
  for (const area of state.areas) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `segment${
      state.searchMode === "area" && area.id === state.selectedAreaId ? " active" : ""
    }`;
    button.textContent = area.name;
    button.addEventListener("click", async () => {
      state.searchMode = "area";
      state.selectedAreaId = area.id;
      state.selectedStoreId = null;
      if (state.sort === "distance_asc") {
        state.sort = "price_asc";
        elements.sortSelect.value = state.sort;
      }
      elements.locationHint.textContent = state.userLocation ? "取得済み" : "未取得";
      await loadStores();
      track("area_changed");
    });
    elements.areaTabs.append(button);
  }
}

function renderDrinkTabs() {
  for (const button of elements.drinkTabs.querySelectorAll("button")) {
    button.classList.toggle("active", button.dataset.drink === state.selectedDrink);
  }
}

function useGoogleMaps() {
  return state.config.maps?.provider === "google" && state.config.maps?.googleMapsApiKey;
}

function loadGoogleMapsScript() {
  if (window.__izakayaGoogleMapsPromise) {
    return window.__izakayaGoogleMapsPromise;
  }

  if (window.google?.maps) {
    window.__izakayaGoogleMapsPromise = Promise.resolve(window.google.maps);
    return window.__izakayaGoogleMapsPromise;
  }

  window.__izakayaGoogleMapsPromise = new Promise((resolve, reject) => {
    const callbackName = "__initIzakayaGoogleMaps";
    window[callbackName] = () => resolve(window.google.maps);

    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: state.config.maps.googleMapsApiKey,
      loading: "async",
      language: "ja",
      region: "JP",
      callback: callbackName,
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Mapsを読み込めませんでした。"));
    document.head.append(script);
  });

  return window.__izakayaGoogleMapsPromise;
}

function pinPosition(store, index) {
  const center = currentMapCenter();
  if (!center) {
    return { x: 50, y: 50 };
  }

  const lngOffset = (store.longitude - center.longitude) * 4300;
  const latOffset = (center.latitude - store.latitude) * 5200;
  const spread = (index % 2 === 0 ? 1 : -1) * 3;

  return {
    x: Math.max(12, Math.min(88, 50 + lngOffset + spread)),
    y: Math.max(18, Math.min(88, 54 + latOffset - spread)),
  };
}

function ensureFallbackMap() {
  const center = currentMapCenter();
  elements.mapCanvas.classList.remove("google-map");
  elements.mapCanvas.innerHTML = `<div class="station-marker" id="stationMarker">${
    center?.label || "駅"
  }</div>`;

  if (isLocationMode()) {
    const userMarker = document.createElement("div");
    userMarker.className = "user-marker";
    userMarker.textContent = "現在地";
    elements.mapCanvas.append(userMarker);
  }
}

function renderFallbackMapPins() {
  ensureFallbackMap();

  state.stores.forEach((store, index) => {
    const position = pinPosition(store, index);
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `map-pin${store.id === state.selectedStoreId ? " active" : ""}`;
    pin.style.left = `${position.x}%`;
    pin.style.top = `${position.y}%`;
    pin.dataset.storeId = store.id;
    pin.innerHTML = `<strong>${store.selectedPrice.formattedPrice}</strong><span>${store.name}</span>`;
    pin.addEventListener("click", () => selectStore(store.id));
    elements.mapCanvas.append(pin);
  });
}

async function renderGoogleMapPins() {
  const maps = await loadGoogleMapsScript();
  const center = currentMapCenter();
  if (!center) {
    return;
  }

  elements.mapCanvas.classList.add("google-map");

  const mapCenter = { lat: center.latitude, lng: center.longitude };
  if (!state.googleMap) {
    elements.mapCanvas.innerHTML = "";
    state.googleMap = new maps.Map(elements.mapCanvas, {
      center: mapCenter,
      zoom: 15,
      clickableIcons: false,
      fullscreenControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      mapId: state.config.maps.googleMapsMapId || undefined,
    });
  } else {
    state.googleMap.setCenter(mapCenter);
    state.googleMap.setZoom(15);
  }

  for (const marker of state.googleMarkers.values()) {
    marker.setMap(null);
  }
  state.googleMarkers.clear();

  if (state.googleUserMarker) {
    state.googleUserMarker.setMap(null);
    state.googleUserMarker = null;
  }

  const bounds = new maps.LatLngBounds();
  bounds.extend(mapCenter);

  if (isLocationMode()) {
    state.googleUserMarker = new maps.Marker({
      map: state.googleMap,
      position: mapCenter,
      title: "現在地",
      icon: {
        path: maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: "#2e5eaa",
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 3,
      },
    });
  }

  for (const store of state.stores) {
    const marker = new maps.Marker({
      map: state.googleMap,
      position: { lat: store.latitude, lng: store.longitude },
      title: store.name,
      label: {
        text: store.selectedPrice.formattedPrice,
        color: "#ffffff",
        fontSize: "12px",
        fontWeight: "700",
      },
    });
    marker.addListener("click", () => selectStore(store.id));
    state.googleMarkers.set(store.id, marker);
    bounds.extend(marker.getPosition());
  }

  if (state.stores.length > 0) {
    state.googleMap.fitBounds(bounds, 64);
  }
}

async function renderMapPins() {
  if (!useGoogleMaps()) {
    renderFallbackMapPins();
    return;
  }

  try {
    await renderGoogleMapPins();
  } catch (error) {
    console.warn(error);
    state.config.maps.provider = "fallback";
    renderFallbackMapPins();
  }
}

function renderStoreList() {
  elements.storeList.innerHTML = "";
  elements.resultCount.textContent = `${state.stores.length}件`;
  elements.resultTitle.textContent = isLocationMode()
    ? `現在地に近い${drinkLabels[state.selectedDrink]}`
    : `${drinkLabels[state.selectedDrink]}が安い店`;

  for (const store of state.stores) {
    const distanceText = formatDistance(store.distanceMeters);
    const card = document.createElement("button");
    card.type = "button";
    card.className = `store-card${store.id === state.selectedStoreId ? " active" : ""}`;
    card.dataset.storeId = store.id;
    card.innerHTML = `
      <div class="store-card-top">
        <h3>${store.name}</h3>
        <span class="price">${store.selectedPrice.formattedPrice}</span>
      </div>
      <p>${store.stationExit} / ${store.openHours}</p>
      <div class="price-line">
        <p>${store.selectedPrice.drinkName}</p>
        <span class="freshness ${store.selectedPrice.freshnessStatus}">
          ${formatFreshnessLabel(store.selectedPrice.freshnessStatus)}
        </span>
      </div>
      ${distanceText ? `<p class="distance-text">現在地から ${distanceText}</p>` : ""}
    `;
    card.addEventListener("click", () => selectStore(store.id));
    elements.storeList.append(card);
  }
}

function renderDetail() {
  const store = state.stores.find((candidate) => candidate.id === state.selectedStoreId);
  if (!store) {
    elements.storeDetail.className = "detail-empty";
    elements.storeDetail.textContent = "店舗を選択してください";
    return;
  }

  const distanceText = formatDistance(store.distanceMeters);
  elements.storeDetail.className = "";
  elements.storeDetail.innerHTML = `
    <div class="detail-grid">
      <div>
        <p class="eyebrow">Store Detail</p>
        <h2>${store.name}</h2>
        <p class="meta">${store.address} / ${store.stationExit}</p>
        ${distanceText ? `<p class="location-badge">現在地から ${distanceText}</p>` : ""}
        <p class="detail-description">${store.description}</p>
        <div class="tag-list">
          ${store.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
        </div>
      </div>
      <div>
        <div class="price-stack">
          ${store.prices
            .map(
              (price) => `
              <div class="price-row">
                <div>
                  <strong>${price.drinkName}</strong>
                  <small>${price.acquiredAt} / ${price.sourceType}</small>
                </div>
                <span class="price">${price.formattedPrice}</span>
              </div>
            `,
            )
            .join("")}
        </div>
        <div class="detail-actions">
          <span class="meta">${store.openHours}</span>
          <a class="primary-link" href="${store.mapUrl}" target="_blank" rel="noreferrer">地図で開く</a>
        </div>
      </div>
    </div>
  `;
}

function refreshActiveStates() {
  for (const card of elements.storeList.querySelectorAll(".store-card")) {
    card.classList.toggle("active", card.dataset.storeId === state.selectedStoreId);
  }

  if (useGoogleMaps()) {
    return;
  }

  for (const pin of elements.mapCanvas.querySelectorAll(".map-pin")) {
    pin.classList.toggle("active", pin.dataset.storeId === state.selectedStoreId);
  }
}

function selectStore(storeId) {
  state.selectedStoreId = storeId;
  refreshActiveStates();
  renderDetail();
  track("store_selected", { storeId });
}

function buildStoreSearchParams() {
  const params = new URLSearchParams({
    drink_category: state.selectedDrink,
    sort: state.sort,
  });

  if (isLocationMode()) {
    params.set("latitude", String(state.userLocation.latitude));
    params.set("longitude", String(state.userLocation.longitude));
    params.set("sort", "distance_asc");
    return params;
  }

  if (state.selectedAreaId) {
    params.set("area_id", state.selectedAreaId);
  }

  return params;
}

async function loadStores() {
  const result = await requestJson(`/api/v1/stores?${buildStoreSearchParams().toString()}`);
  state.stores = result.stores;
  state.selectedStoreId = state.stores[0]?.id || null;

  const area = selectedArea();
  elements.areaTitle.textContent = isLocationMode()
    ? "現在地周辺"
    : area
      ? `${area.name} / ${area.station}`
      : "エリア未選択";

  renderAreaTabs();
  renderDrinkTabs();
  await renderMapPins();
  renderStoreList();
  renderDetail();
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("このブラウザでは現在地を取得できません。"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 60_000,
    });
  });
}

async function useCurrentLocation() {
  elements.locateButton.disabled = true;
  elements.locationHint.textContent = "取得中";

  try {
    const position = await getCurrentPosition();
    state.userLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    };
    state.searchMode = "location";
    state.selectedAreaId = null;
    state.sort = "distance_asc";
    elements.sortSelect.value = state.sort;
    elements.locationHint.textContent = `取得済み / 精度 約${Math.round(position.coords.accuracy)}m`;
    await loadStores();
    track("location_search_executed", {
      metadata: {
        accuracyMeters: Math.round(position.coords.accuracy),
      },
    });
  } catch (error) {
    elements.locationHint.textContent = "取得できませんでした";
    if (state.sort === "distance_asc") {
      state.sort = "price_asc";
      elements.sortSelect.value = state.sort;
    }
    console.warn(error);
  } finally {
    elements.locateButton.disabled = false;
  }
}

async function initialize() {
  try {
    await requestJson("/api/v1/health");
    setStatus(true);

    state.config = await requestJson("/api/v1/config");
    const areaResult = await requestJson("/api/v1/areas");
    state.areas = areaResult.areas;
    state.selectedAreaId = state.areas[0]?.id || null;
    await loadStores();
    track("app_loaded");
  } catch (error) {
    setStatus(false);
    elements.storeList.innerHTML = `<p class="meta">${error.message}</p>`;
  }
}

elements.locateButton.addEventListener("click", () => {
  useCurrentLocation();
});

elements.drinkTabs.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-drink]");
  if (!button) {
    return;
  }

  state.selectedDrink = button.dataset.drink;
  state.selectedStoreId = null;
  await loadStores();
  track("drink_changed");
});

elements.sortSelect.addEventListener("change", async () => {
  state.sort = elements.sortSelect.value;
  if (state.sort === "distance_asc" && !state.userLocation) {
    await useCurrentLocation();
    return;
  }

  if (state.sort === "distance_asc") {
    state.searchMode = "location";
    state.selectedAreaId = null;
  }

  await loadStores();
  track("sort_changed");
});

elements.refreshButton.addEventListener("click", async () => {
  await loadStores();
  track("manual_refresh");
});

initialize();

