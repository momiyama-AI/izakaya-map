const drinkLabels = {
  highball: "ハイボール",
  beer: "生ビール",
  lemon_sour: "レモンサワー",
};

const drinkMarkerStyles = {
  highball: {
    key: "highball",
    shortLabel: "HB",
    color: "#b85f17",
    accent: "#ffd38c",
    activeColor: "#8c3f10",
    icon: "glass",
  },
  beer: {
    key: "beer",
    shortLabel: "BEER",
    color: "#d69212",
    accent: "#fff0a8",
    activeColor: "#a46708",
    icon: "mug",
  },
  lemon_sour: {
    key: "lemon-sour",
    shortLabel: "LEMON",
    color: "#c3a412",
    accent: "#f6ff9b",
    activeColor: "#7d8f13",
    icon: "lemon",
  },
};

const unknownPriceLabel = "\u4fa1\u683c\u672a\u78ba\u8a8d";
const unknownFreshnessLabel = "\u672a\u78ba\u8a8d";
const resultFocusZoomLevel = 16;
const mapPinFocusZoomLevel = 17;
const expandedMarkerZoomLevel = 17;
const compactMarkerStoreThreshold = 30;
const compactMarkerVisibleLimit = 32;

const state = {
  areas: [],
  config: { maps: { provider: "fallback" } },
  googleMap: null,
  googleMarkers: new Map(),
  googleUserMarker: null,
  googleZoomListener: null,
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
  listStatus: document.querySelector("#listStatus"),
  summaryArea: document.querySelector("#summaryArea"),
  summaryDrink: document.querySelector("#summaryDrink"),
  summaryPrice: document.querySelector("#summaryPrice"),
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
  elements.serviceStatus.classList.toggle("error", !ok);
}

function showListStatus(kind, message, { onRetry } = {}) {
  elements.listStatus.hidden = false;
  elements.listStatus.classList.toggle("is-error", kind === "error");
  elements.listStatus.innerHTML = `
    ${kind === "loading" ? '<span class="spinner" aria-hidden="true"></span>' : ""}
    <p>${message}</p>
    ${onRetry ? '<button type="button" class="retry-button">再試行</button>' : ""}
  `;
  if (onRetry) {
    elements.listStatus.querySelector(".retry-button").addEventListener("click", onRetry);
  }
}

function hideListStatus() {
  elements.listStatus.hidden = true;
  elements.listStatus.classList.remove("is-error");
  elements.listStatus.innerHTML = "";
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

function getDrinkMarkerStyle(category = state.selectedDrink) {
  return drinkMarkerStyles[category] || drinkMarkerStyles.highball;
}

function storePriceLabel(store) {
  return store.selectedPrice?.formattedPrice || unknownPriceLabel;
}

function cheapestStore() {
  return state.stores
    .filter((store) => Number.isFinite(store.selectedPrice?.priceYen))
    .reduce((cheapest, store) => {
      if (!cheapest || store.selectedPrice.priceYen < cheapest.selectedPrice.priceYen) {
        return store;
      }

      return cheapest;
    }, null);
}

function summaryAreaLabel() {
  if (isLocationMode()) {
    return "現在地周辺";
  }

  const area = selectedArea();
  return area ? area.name : "エリア未選択";
}

function updateSummary() {
  const cheapest = cheapestStore();
  elements.summaryArea.textContent = summaryAreaLabel();
  elements.summaryDrink.textContent = drinkLabels[state.selectedDrink];
  elements.summaryPrice.textContent = cheapest?.selectedPrice?.formattedPrice || "--";
}

function storeDrinkNameLabel(store) {
  return (
    store.selectedPrice?.drinkName ||
    `${drinkLabels[state.selectedDrink]}\u306e\u4fa1\u683c\u3092\u8abf\u67fb\u4e2d`
  );
}

function freshnessBadge(store) {
  if (!store.selectedPrice) {
    return `<span class="freshness unknown">${unknownFreshnessLabel}</span>`;
  }

  return `
    <span class="freshness ${store.selectedPrice.freshnessStatus}">
      ${formatFreshnessLabel(store.selectedPrice.freshnessStatus)}
    </span>
  `;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function tabelogLinkHtml(store) {
  const url = safeExternalUrl(store.tabelogUrl);
  if (!url) {
    return "";
  }

  return `<a class="secondary-link" href="${escapeSvgText(url)}" target="_blank" rel="noreferrer">\u98df\u3079\u30ed\u30b0</a>`;
}

function escapeSvgText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function drinkIconPath(style) {
  if (style.icon === "mug") {
    return `
      <path d="M36 23h20v20a7 7 0 0 1-7 7h-6a7 7 0 0 1-7-7V23z" fill="none" stroke="white" stroke-width="3"/>
      <path d="M56 29h6a6 6 0 0 1 0 12h-6" fill="none" stroke="white" stroke-width="3"/>
      <path d="M38 19h16" stroke="white" stroke-width="3" stroke-linecap="round"/>
    `;
  }

  if (style.icon === "lemon") {
    return `
      <circle cx="46" cy="35" r="12" fill="none" stroke="white" stroke-width="3"/>
      <path d="M46 23v24M34 35h24M38 27l16 16M54 27 38 43" stroke="white" stroke-width="2" stroke-linecap="round"/>
    `;
  }

  return `
    <path d="M37 23h19l-4 26H41L37 23z" fill="none" stroke="white" stroke-width="3" stroke-linejoin="round"/>
    <path d="M40 31h14" stroke="white" stroke-width="3" stroke-linecap="round"/>
    <circle cx="43" cy="39" r="2" fill="white"/>
    <circle cx="50" cy="36" r="2" fill="white"/>
  `;
}

function createPriceMarkerSvg(store, active = false) {
  const style = getDrinkMarkerStyle(store.selectedPrice?.category);
  const fill = active ? style.activeColor : style.color;
  const stroke = active ? "#1f1b17" : "#ffffff";
  const price = escapeSvgText(storePriceLabel(store));
  const label = escapeSvgText(style.shortLabel);
  const icon = drinkIconPath(style);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="78" viewBox="0 0 128 78">
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#2d241d" flood-opacity="0.28"/>
      </filter>
      <path d="M13 7h102a9 9 0 0 1 9 9v38a9 9 0 0 1-9 9H72l-8 11-8-11H13a9 9 0 0 1-9-9V16a9 9 0 0 1 9-9z"
        fill="${fill}" stroke="${stroke}" stroke-width="${active ? 4 : 3}" filter="url(#shadow)"/>
      <rect x="8" y="11" width="112" height="16" rx="7" fill="${style.accent}" opacity="0.92"/>
      <text x="64" y="23" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" font-weight="800" fill="#2b2119">${label}</text>
      <g transform="translate(-20 0) scale(0.74)">
        ${icon}
      </g>
      <text x="77" y="50" text-anchor="middle" font-family="Arial, sans-serif" font-size="20" font-weight="900" fill="#ffffff">${price}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function compactMarkerPriceLabel(store) {
  return store.selectedPrice?.formattedPrice || "\u672a";
}

function createCompactPriceMarkerSvg(store) {
  const style = getDrinkMarkerStyle(store.selectedPrice?.category);
  const price = escapeSvgText(compactMarkerPriceLabel(store));
  const label = escapeSvgText(style.shortLabel);
  const icon = drinkIconPath(style);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="58" height="66" viewBox="0 0 58 66">
      <filter id="shadow" x="-25%" y="-25%" width="150%" height="160%">
        <feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#20262e" flood-opacity="0.24"/>
      </filter>
      <path d="M29 3c13.8 0 25 10.7 25 24 0 18.2-25 36-25 36S4 45.2 4 27C4 13.7 15.2 3 29 3z"
        fill="${style.color}" stroke="#ffffff" stroke-width="3" filter="url(#shadow)"/>
      <circle cx="29" cy="27" r="17" fill="${style.activeColor}" opacity="0.96"/>
      <g transform="translate(-13 -3) scale(0.66)" opacity="0.9">
        ${icon}
      </g>
      <text x="29" y="21" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" font-weight="900" fill="${style.accent}">${label}</text>
      <text x="29" y="38" text-anchor="middle" font-family="Arial, sans-serif" font-size="${price.length > 4 ? 12 : 14}" font-weight="900" fill="#ffffff">${price}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function shouldUseCompactGoogleMarker(active = false) {
  if (active || !state.googleMap || state.stores.length < compactMarkerStoreThreshold) {
    return false;
  }

  const zoom = state.googleMap.getZoom?.() || 15;
  return zoom < expandedMarkerZoomLevel;
}

function shouldShowGoogleMarker(index, active = false) {
  if (active || !shouldUseCompactGoogleMarker(false)) {
    return true;
  }

  return index < compactMarkerVisibleLimit;
}

function createGoogleMarkerIcon(maps, store, active = false) {
  const compact = shouldUseCompactGoogleMarker(active);

  if (compact) {
    return {
      url: createCompactPriceMarkerSvg(store),
      scaledSize: new maps.Size(58, 66),
      anchor: new maps.Point(29, 63),
    };
  }

  return {
    url: createPriceMarkerSvg(store, active),
    scaledSize: new maps.Size(active ? 136 : 128, active ? 83 : 78),
    anchor: new maps.Point(active ? 68 : 64, active ? 82 : 77),
  };
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
    const style = getDrinkMarkerStyle(store.selectedPrice?.category);
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `map-pin drink-${style.key}${
      store.id === state.selectedStoreId ? " active" : ""
    }`;
    pin.style.left = `${position.x}%`;
    pin.style.top = `${position.y}%`;
    pin.style.setProperty("--pin-color", style.color);
    pin.style.setProperty("--pin-active-color", style.activeColor);
    pin.style.setProperty("--pin-accent", style.accent);
    pin.dataset.storeId = store.id;
    pin.innerHTML = `
      <span class="drink-code">${style.shortLabel}</span>
      <strong>${storePriceLabel(store)}</strong>
      <span>${store.name}</span>
    `;
    pin.addEventListener("click", () =>
      selectStore(store.id, { focusMap: true, zoomLevel: mapPinFocusZoomLevel }),
    );
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
    state.googleZoomListener = state.googleMap.addListener("zoom_changed", () => {
      refreshActiveStates();
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

  state.stores.forEach((store, index) => {
    const active = store.id === state.selectedStoreId;
    const marker = new maps.Marker({
      map: state.googleMap,
      position: { lat: store.latitude, lng: store.longitude },
      title: store.name,
      icon: createGoogleMarkerIcon(maps, store, active),
      zIndex: active ? 1000 : 100,
      visible: shouldShowGoogleMarker(index, active),
    });
    marker.addListener("click", () =>
      selectStore(store.id, { focusMap: true, zoomLevel: mapPinFocusZoomLevel }),
    );
    state.googleMarkers.set(store.id, marker);
    bounds.extend(marker.getPosition());
  });

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
  updateSummary();

  for (const [index, store] of state.stores.entries()) {
    const distanceText = formatDistance(store.distanceMeters);
    const hasPrice = Boolean(store.selectedPrice);
    const active = store.id === state.selectedStoreId;
    const card = document.createElement("button");
    card.type = "button";
    card.className = `store-card${active ? " active" : ""}${hasPrice ? "" : " no-price"}`;
    card.dataset.storeId = store.id;
    card.setAttribute("aria-pressed", String(active));
    card.innerHTML = `
      <div class="store-card-main">
        <span class="rank-badge">${index + 1}</span>
        <div class="store-card-copy">
          <div class="store-card-top">
            <h3>${store.name}</h3>
            <span class="price${hasPrice ? "" : " price-unknown"}">${storePriceLabel(store)}</span>
          </div>
          <p>${store.stationExit} / ${store.openHours}</p>
          <div class="price-line">
            <p>${storeDrinkNameLabel(store)}</p>
            ${freshnessBadge(store)}
          </div>
          ${distanceText ? `<p class="distance-text">現在地から ${distanceText}</p>` : ""}
        </div>
      </div>
    `;
    card.addEventListener("click", () => selectStore(store.id, { focusMap: true }));
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
  const priceRowsHtml =
    store.prices.length > 0
      ? store.prices
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
          .join("")
      : `
          <div class="price-row price-row-empty">
            <div>
              <strong>${unknownPriceLabel}</strong>
              <small>\u30c9\u30ea\u30f3\u30af\u4fa1\u683c\u306f\u672a\u53ce\u96c6\u3067\u3059</small>
            </div>
          </div>
        `;
  elements.storeDetail.className = "";
  elements.storeDetail.innerHTML = `
    <div class="detail-grid">
      <div class="detail-main">
        <p class="section-kicker">選択中の店舗</p>
        <div class="detail-title-row">
          <h2>${store.name}</h2>
          <span class="detail-main-price">${storePriceLabel(store)}</span>
        </div>
        <p class="meta">${store.address}</p>
        <p class="meta">${store.stationExit} / ${store.openHours}</p>
        ${distanceText ? `<p class="location-badge">現在地から ${distanceText}</p>` : ""}
        <p class="detail-description">${store.description}</p>
        <div class="tag-list">
          ${store.tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
        </div>
      </div>
      <div class="detail-side">
        <p class="section-kicker">ドリンク価格</p>
        <div class="price-stack">
          ${priceRowsHtml}
        </div>
        <div class="detail-actions">
          ${tabelogLinkHtml(store)}
          <a class="primary-link" href="${store.mapUrl}" target="_blank" rel="noreferrer">地図で開く</a>
        </div>
      </div>
    </div>
  `;
}

function refreshActiveStates() {
  for (const card of elements.storeList.querySelectorAll(".store-card")) {
    const active = card.dataset.storeId === state.selectedStoreId;
    card.classList.toggle("active", active);
    card.setAttribute("aria-pressed", String(active));
  }

  if (useGoogleMaps()) {
    const maps = window.google?.maps;
    if (maps) {
      state.stores.forEach((store, index) => {
        const marker = state.googleMarkers.get(store.id);
        if (!marker) {
          return;
        }

        const active = store.id === state.selectedStoreId;
        marker.setIcon(createGoogleMarkerIcon(maps, store, active));
        marker.setZIndex(active ? 1000 : 100);
        marker.setVisible(shouldShowGoogleMarker(index, active));
      });
    }
    return;
  }

  for (const pin of elements.mapCanvas.querySelectorAll(".map-pin")) {
    pin.classList.toggle("active", pin.dataset.storeId === state.selectedStoreId);
  }
}

function focusStoreOnMap(storeId, options = {}) {
  const store = state.stores.find((candidate) => candidate.id === storeId);
  if (!store || !state.googleMap) {
    return;
  }

  state.googleMap.panTo({ lat: store.latitude, lng: store.longitude });
  const currentZoom = state.googleMap.getZoom?.() || 15;
  const zoomLevel = options.zoomLevel || resultFocusZoomLevel;
  if (currentZoom < zoomLevel) {
    state.googleMap.setZoom(zoomLevel);
  }
}

function selectStore(storeId, options = {}) {
  state.selectedStoreId = storeId;
  refreshActiveStates();
  elements.storeList.querySelector(".store-card.active")?.scrollIntoView({ block: "nearest" });
  if (options.focusMap) {
    focusStoreOnMap(storeId, options);
  }
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
  elements.refreshButton.disabled = true;
  elements.storeList.innerHTML = "";
  showListStatus("loading", "店舗情報を読み込み中です…");

  let result;
  try {
    result = await requestJson(`/api/v1/stores?${buildStoreSearchParams().toString()}`);
  } catch (error) {
    console.warn(error);
    elements.resultCount.textContent = "0件";
    showListStatus("error", "店舗情報を取得できませんでした。通信状態を確認してください。", {
      onRetry: () => loadStores(),
    });
    return;
  } finally {
    elements.refreshButton.disabled = false;
  }

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

  if (state.stores.length === 0) {
    showListStatus("empty", "条件に合う店舗が見つかりませんでした。エリアやドリンクを変えてお試しください。");
  } else {
    hideListStatus();
  }
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
    showListStatus("loading", "サービスに接続しています…");
    await requestJson("/api/v1/health");
    setStatus(true);

    state.config = await requestJson("/api/v1/config");
    const areaResult = await requestJson("/api/v1/areas");
    state.areas = areaResult.areas;
    state.selectedAreaId = state.areas[0]?.id || null;
    await loadStores();
    track("app_loaded");
  } catch (error) {
    console.warn(error);
    setStatus(false);
    showListStatus("error", "初期データを読み込めませんでした。時間をおいて再試行してください。", {
      onRetry: () => initialize(),
    });
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
