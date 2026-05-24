const drinkLabels = {
  highball: "ハイボール",
  beer: "生ビール",
  lemon_sour: "レモンサワー",
};

const state = {
  areas: [],
  stores: [],
  events: [],
  token: sessionStorage.getItem("izakayaAdminToken") || "",
  user: sessionStorage.getItem("izakayaAdminUser") || "admin",
};

const elements = {
  adminToken: document.querySelector("#adminToken"),
  adminUser: document.querySelector("#adminUser"),
  saveAuthButton: document.querySelector("#saveAuthButton"),
  adminStatus: document.querySelector("#adminStatus"),
  storeMetric: document.querySelector("#storeMetric"),
  priceMetric: document.querySelector("#priceMetric"),
  pendingMetric: document.querySelector("#pendingMetric"),
  eventMetric: document.querySelector("#eventMetric"),
  storeForm: document.querySelector("#storeForm"),
  priceForm: document.querySelector("#priceForm"),
  storeArea: document.querySelector("#storeArea"),
  priceStore: document.querySelector("#priceStore"),
  acquiredAt: document.querySelector("#acquiredAt"),
  areaFilter: document.querySelector("#areaFilter"),
  storeSearch: document.querySelector("#storeSearch"),
  storeTableBody: document.querySelector("#storeTableBody"),
  refreshEventsButton: document.querySelector("#refreshEventsButton"),
  eventList: document.querySelector("#eventList"),
  notice: document.querySelector("#notice"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function showNotice(message, tone = "ok") {
  elements.notice.textContent = message;
  elements.notice.className = `notice show${tone === "error" ? " error" : ""}`;
  window.clearTimeout(showNotice.timeoutId);
  showNotice.timeoutId = window.setTimeout(() => {
    elements.notice.className = "notice";
  }, 3600);
}

function setAdminStatus(status, message) {
  elements.adminStatus.textContent = message;
  elements.adminStatus.className = `status-pill ${status}`;
}

function adminHeaders() {
  return {
    "content-type": "application/json",
    "x-admin-token": state.token,
    "x-admin-user": state.user || "admin",
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error?.message || `${path} failed with ${response.status}`);
  }

  return payload;
}

function areaName(areaId) {
  return state.areas.find((area) => area.id === areaId)?.name || areaId;
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function serializeTags(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderAreaOptions() {
  const areaOptions = state.areas
    .map((area) => `<option value="${escapeHtml(area.id)}">${escapeHtml(area.name)}</option>`)
    .join("");

  elements.storeArea.innerHTML = areaOptions;
  elements.areaFilter.innerHTML = `<option value="">全エリア</option>${areaOptions}`;
}

function renderStoreOptions() {
  elements.priceStore.innerHTML = state.stores
    .map(
      (store) =>
        `<option value="${escapeHtml(store.id)}">${escapeHtml(areaName(store.areaId))} / ${escapeHtml(
          store.name,
        )}</option>`,
    )
    .join("");
}

function renderMetrics() {
  const priceCount = state.stores.reduce((sum, store) => sum + store.prices.length, 0);
  const pendingCount = state.stores.filter((store) => store.prices.length === 0).length;
  elements.storeMetric.textContent = state.stores.length.toLocaleString("ja-JP");
  elements.priceMetric.textContent = priceCount.toLocaleString("ja-JP");
  elements.pendingMetric.textContent = pendingCount.toLocaleString("ja-JP");
  elements.eventMetric.textContent = state.events.length.toLocaleString("ja-JP");
}

function storeMatchesFilters(store) {
  const areaId = elements.areaFilter.value;
  const searchText = elements.storeSearch.value.trim().toLowerCase();
  if (areaId && store.areaId !== areaId) {
    return false;
  }

  if (!searchText) {
    return true;
  }

  return [store.name, store.address, store.stationExit]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(searchText));
}

function renderStoreTable() {
  const rows = state.stores.filter(storeMatchesFilters);
  if (rows.length === 0) {
    elements.storeTableBody.innerHTML = `<tr><td colspan="5" class="muted">該当する店舗がありません</td></tr>`;
    return;
  }

  elements.storeTableBody.innerHTML = rows
    .map((store) => {
      const priceText =
        store.prices.length > 0
          ? store.prices
              .map((price) => `${drinkLabels[price.category] || price.category} ${price.formattedPrice}`)
              .join(" / ")
          : "価格未確認";
      const tabelogUrl = safeExternalUrl(store.tabelogUrl);
      return `
        <tr>
          <td>
            <div class="store-name">
              <strong>${escapeHtml(store.name)}</strong>
              <span class="muted">${escapeHtml(store.address)}</span>
            </div>
          </td>
          <td>${escapeHtml(areaName(store.areaId))}</td>
          <td><span class="pill">${escapeHtml(priceText)}</span></td>
          <td>
            <span>${escapeHtml(store.updatedBy)}</span><br />
            <span class="muted">${escapeHtml(formatDateTime(store.updatedAt))}</span>
          </td>
          <td>
            ${tabelogUrl ? `<a class="link-button" href="${escapeHtml(tabelogUrl)}" target="_blank" rel="noreferrer">食べログ</a>` : ""}
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderEvents() {
  if (state.events.length === 0) {
    elements.eventList.innerHTML = `<p class="muted">イベントログはありません</p>`;
    return;
  }

  elements.eventList.innerHTML = state.events
    .slice(0, 40)
    .map(
      (event) => `
        <article class="event-item">
          <strong>${escapeHtml(event.type)}</strong>
          <span class="muted">${escapeHtml(formatDateTime(event.createdAt))} / ${escapeHtml(event.createdBy)}</span>
          <code>${escapeHtml(JSON.stringify(event.metadata || {}))}</code>
        </article>
      `,
    )
    .join("");
}

async function loadAreas() {
  const result = await requestJson("/api/v1/areas");
  state.areas = result.areas;
  renderAreaOptions();
}

async function loadStores() {
  const results = await Promise.all(
    state.areas.map((area) =>
      requestJson(`/api/v1/stores?area_id=${encodeURIComponent(area.id)}&drink_category=highball`),
    ),
  );
  state.stores = results
    .flatMap((result) => result.stores)
    .sort((a, b) => a.name.localeCompare(b.name, "ja-JP"));
  renderStoreOptions();
  renderStoreTable();
  renderMetrics();
}

async function loadEvents({ quiet = false } = {}) {
  if (!state.token) {
    setAdminStatus("error", "未認証");
    return;
  }

  try {
    const result = await requestJson("/api/v1/admin/events", {
      headers: adminHeaders(),
    });
    state.events = result.events;
    setAdminStatus("ok", "接続済み");
    renderEvents();
    renderMetrics();
    if (!quiet) {
      showNotice("管理APIに接続しました");
    }
  } catch (error) {
    state.events = [];
    setAdminStatus("error", "認証エラー");
    renderEvents();
    renderMetrics();
    if (!quiet) {
      showNotice(error.message, "error");
    }
  }
}

async function submitStore(event) {
  event.preventDefault();
  if (!state.token) {
    showNotice("管理トークンを入力してください", "error");
    return;
  }

  const formData = new FormData(elements.storeForm);
  const payload = {
    areaId: formData.get("areaId"),
    name: formData.get("name"),
    address: formData.get("address"),
    stationExit: formData.get("stationExit"),
    latitude: Number(formData.get("latitude")),
    longitude: Number(formData.get("longitude")),
    businessStatus: formData.get("businessStatus"),
    openHours: formData.get("openHours"),
    tabelogUrl: formData.get("tabelogUrl"),
    tags: serializeTags(formData.get("tags")),
    description: formData.get("description"),
  };

  try {
    await requestJson("/api/v1/admin/stores", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(payload),
    });
    elements.storeForm.reset();
    await loadStores();
    await loadEvents({ quiet: true });
    showNotice("店舗を登録しました");
  } catch (error) {
    showNotice(error.message, "error");
  }
}

async function submitPrice(event) {
  event.preventDefault();
  if (!state.token) {
    showNotice("管理トークンを入力してください", "error");
    return;
  }

  const formData = new FormData(elements.priceForm);
  const payload = {
    storeId: formData.get("storeId"),
    category: formData.get("category"),
    drinkName: formData.get("drinkName"),
    priceYen: Number(formData.get("priceYen")),
    taxIncluded: formData.get("taxIncluded") === "on",
    acquiredAt: formData.get("acquiredAt"),
    sourceType: formData.get("sourceType"),
    verificationStatus: formData.get("verificationStatus"),
  };

  try {
    await requestJson("/api/v1/admin/drink-prices", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify(payload),
    });
    elements.priceForm.reset();
    elements.acquiredAt.value = new Date().toISOString().slice(0, 10);
    await loadStores();
    await loadEvents({ quiet: true });
    showNotice("価格を登録しました");
  } catch (error) {
    showNotice(error.message, "error");
  }
}

function saveAuth() {
  state.token = elements.adminToken.value.trim();
  state.user = elements.adminUser.value.trim() || "admin";
  sessionStorage.setItem("izakayaAdminToken", state.token);
  sessionStorage.setItem("izakayaAdminUser", state.user);
  loadEvents();
}

async function initialize() {
  elements.adminToken.value = state.token;
  elements.adminUser.value = state.user;
  elements.acquiredAt.value = new Date().toISOString().slice(0, 10);

  await loadAreas();
  await loadStores();
  renderEvents();
  if (state.token) {
    await loadEvents({ quiet: true });
  }
}

elements.saveAuthButton.addEventListener("click", saveAuth);
elements.storeForm.addEventListener("submit", submitStore);
elements.priceForm.addEventListener("submit", submitPrice);
elements.areaFilter.addEventListener("change", renderStoreTable);
elements.storeSearch.addEventListener("input", renderStoreTable);
elements.refreshEventsButton.addEventListener("click", () => loadEvents());

initialize().catch((error) => {
  showNotice(error.message, "error");
});
