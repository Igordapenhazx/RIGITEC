// ============================================================================
// CONFIGURAÇÃO REAL DO SUPABASE
// ============================================================================
const SUPABASE_URL = "https://sudzumnwkxfghhjudkye.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN1ZHp1bW53a3hmZ2hoanVka3llIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2NjkwNTIsImV4cCI6MjEwMjI0NTA1Mn0.k_pqjz11Ey7kll90jhRUuC14Cu-B424YUISpx_5rp7M";

if (!window.supabase?.createClient) {
  throw new Error("O script do Supabase não foi carregado corretamente no HTML.");
}

// A biblioteca usa `window.supabase`; mantenha o cliente do sistema com outro nome.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================================
// ESTADO GLOBAL
// ============================================================================
const STREETS = ["A", "B1", "C", "RE"];

const state = {
  currentUser: null,
  users: [],
  history: [],
  stock: []
};

const viewTitles = {
  painel: "Painel executivo",
  operacao: "Operações",
  estoque: "Mapa de estoque",
  auditoria: "Auditoria",
  administracao: "Administração"
};

let pendingOperation = null;
let alertTimer = null;
let realtimeChannel = null;

// ============================================================================
// ELEMENTOS DO DOM
// ============================================================================
const loginScreen = document.getElementById("loginScreen");
const dashboardScreen = document.getElementById("dashboardScreen");
const loginForm = document.getElementById("loginForm");
const operationForm = document.getElementById("operationForm");
const userForm = document.getElementById("userForm");
const confirmForm = document.getElementById("confirmForm");

const userBadge = document.getElementById("userBadge");
const viewTitle = document.getElementById("viewTitle");
const movementType = document.getElementById("movementType");
const stockSearch = document.getElementById("stockSearch");
const streetFilter = document.getElementById("streetFilter");
const auditPeriod = document.getElementById("auditPeriod");
const codeHint = document.getElementById("codeHint");
const pieceCodeInput = document.getElementById("pieceCode");
const pieceDescriptionInput = document.getElementById("pieceDescription");

const confirmModal = document.getElementById("confirmModal");
const operationPreview = document.getElementById("operationPreview");
const globalAlert = document.getElementById("globalAlert");

const welcomeGreeting = document.getElementById("welcomeGreeting");
const welcomeUserName = document.getElementById("welcomeUserName");
const welcomeTime = document.getElementById("welcomeTime");
const welcomeFullDate = document.getElementById("welcomeFullDate");

// ============================================================================
// FORMATADORES
// ============================================================================
const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short"
});
const longDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric"
});
const clockFormatter = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit"
});
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

// ============================================================================
// UTILITÁRIOS
// ============================================================================
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function capitalize(text) {
  const value = normalizeText(text);
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getDayKey(dateValue) {
  return dayKeyFormatter.format(new Date(dateValue));
}

function getBrasiliaHour() {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false
  }).format(new Date()));
}

function getGreetingByHour(hour) {
  if (hour < 12) return "BOM DIA";
  if (hour < 18) return "BOA TARDE";
  return "BOA NOITE";
}

function showAlert(message, type = "success") {
  if (!globalAlert) return;

  const loginVisible = !loginScreen.classList.contains("hidden");
  const dashboardHidden = dashboardScreen.classList.contains("hidden");

  if (loginVisible && dashboardHidden) {
    window.alert(message);
    return;
  }

  globalAlert.textContent = message;
  globalAlert.className = `global-alert ${type}`;
  clearTimeout(alertTimer);
  alertTimer = setTimeout(() => {
    globalAlert.className = "global-alert hidden";
  }, 4000);
}

function updateWelcomeClock() {
  const now = new Date();
  welcomeGreeting.textContent = getGreetingByHour(getBrasiliaHour());
  welcomeTime.textContent = clockFormatter.format(now);
  welcomeFullDate.textContent = `${capitalize(longDateFormatter.format(now))} • Horário de Brasília`;
}

function normalizeType(value) {
  const type = normalizeText(value).toLowerCase();
  if (type === "lancamento") return "entrada";
  return type;
}

function parseProduct(rawProduct = "", fallbackCode = "", fallbackDescription = "") {
  const directCode = normalizeText(fallbackCode).toUpperCase();
  const directDescription = normalizeText(fallbackDescription);

  if (directCode || directDescription) {
    return {
      code: directCode,
      description: directDescription
    };
  }

  const value = normalizeText(rawProduct);
  if (!value) {
    return { code: "", description: "" };
  }

  const separator = " - ";
  if (value.includes(separator)) {
    const [code, ...descriptionParts] = value.split(separator);
    return {
      code: normalizeText(code).toUpperCase(),
      description: normalizeText(descriptionParts.join(separator))
    };
  }

  return {
    code: value.toUpperCase(),
    description: ""
  };
}

function parseLocation(rawLocation = "") {
  const value = normalizeText(rawLocation);
  if (!value || /^n\/?a$/i.test(value)) {
    return { raw: value, street: "", address: "", level: "" };
  }

  if (value.includes("/")) {
    const [street = "", address = "", level = ""] = value.split("/").map((part) => normalizeText(part));
    return {
      raw: value,
      street,
      address,
      level: level.replace(/nível|nivel/gi, "").trim()
    };
  }

  const match = value.match(/^([A-Za-z0-9]+)\s+([A-Za-z0-9-]+)(?:\s+(?:N[ií]vel|Nivel)\s+([A-Za-z0-9]+))?$/i);
  if (match) {
    return {
      raw: value,
      street: normalizeText(match[1]),
      address: normalizeText(match[2]).toUpperCase(),
      level: normalizeText(match[3] || "")
    };
  }

  return {
    raw: value,
    street: "",
    address: value.toUpperCase(),
    level: ""
  };
}

function formatLocation(street, address, level) {
  const normalizedStreet = normalizeText(street);
  const normalizedAddress = normalizeText(address).toUpperCase();
  const normalizedLevel = normalizeText(level);

  if (!normalizedStreet || !normalizedAddress) {
    return "N/A";
  }

  return `${normalizedStreet} ${normalizedAddress} Nível ${normalizedLevel || "-"}`;
}

function buildProductLabel(code, description) {
  const normalizedCode = normalizeText(code).toUpperCase();
  const normalizedDescription = normalizeText(description);
  return normalizedDescription ? `${normalizedCode} - ${normalizedDescription}` : normalizedCode;
}

function getUserAccess(user) {
  return normalizeText(user?.access).toLowerCase() === "admin" ? "admin" : "usuario";
}

function isUserActive(user) {
  if (!user || !Object.prototype.hasOwnProperty.call(user, "active")) {
    return true;
  }
  return Boolean(user.active);
}

function normalizeHistoryRecord(row) {
  const product = parseProduct(
    row.produto ?? row.product ?? "",
    row.codigo ?? row.code ?? "",
    row.descricao ?? row.description ?? ""
  );
  const origin = parseLocation(row.origem ?? row.origin ?? "");
  const destination = parseLocation(row.destino ?? row.destination ?? "");
  const type = normalizeType(row.movimentacao_ ?? row.type ?? "");
  const quantity = Number(row.quantidade ?? row.quantity ?? 0);

  return {
    id: row.id ?? `${type}-${product.code}-${row.created_at ?? Date.now()}`,
    type,
    code: product.code,
    description: product.description,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    street: origin.street,
    address: origin.address,
    level: origin.level,
    destinationStreet: destination.street,
    destinationAddress: destination.address,
    destinationLevel: destination.level,
    observation: normalizeText(row.observacao ?? row.observation ?? ""),
    user: normalizeText(row.usuario_responsavel ?? row.user ?? row.username ?? "Não informado"),
    timestamp: row.created_at ?? row.timestamp ?? new Date().toISOString()
  };
}

function createStockKey(code, street, address, level) {
  return [
    normalizeText(code).toUpperCase(),
    normalizeText(street),
    normalizeText(address).toUpperCase(),
    normalizeText(level)
  ].join("||");
}

function applyStockDelta(stockMap, item, delta, location) {
  if (!location.street || !location.address) {
    return;
  }

  const key = createStockKey(item.code, location.street, location.address, location.level);
  const current = stockMap.get(key) || {
    code: item.code,
    description: item.description,
    quantity: 0,
    street: location.street,
    address: location.address.toUpperCase(),
    level: location.level || ""
  };

  current.quantity += delta;

  if (!current.description && item.description) {
    current.description = item.description;
  }

  stockMap.set(key, current);
}

function buildStockFromHistory(history) {
  const stockMap = new Map();
  const orderedHistory = [...history].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  orderedHistory.forEach((item) => {
    const origin = {
      street: item.street,
      address: item.address,
      level: item.level
    };
    const destination = {
      street: item.destinationStreet,
      address: item.destinationAddress,
      level: item.destinationLevel
    };

    if (item.type === "entrada") {
      applyStockDelta(stockMap, item, item.quantity, origin.street ? origin : destination);
      return;
    }

    if (item.type === "saida") {
      applyStockDelta(stockMap, item, -item.quantity, origin);
      return;
    }

    if (item.type === "transferencia") {
      applyStockDelta(stockMap, item, -item.quantity, origin);
      applyStockDelta(stockMap, item, item.quantity, destination);
    }
  });

  return [...stockMap.values()]
    .filter((item) => item.quantity > 0)
    .sort((a, b) => {
      if (a.street !== b.street) return a.street.localeCompare(b.street);
      if (a.address !== b.address) return a.address.localeCompare(b.address);
      return a.code.localeCompare(b.code);
    });
}

function getAllKnownStreets() {
  const dynamicStreets = new Set(STREETS);
  state.stock.forEach((item) => {
    if (item.street) dynamicStreets.add(item.street);
  });
  return [...dynamicStreets];
}

function getKnownProductByCode(code) {
  const normalizedCode = normalizeText(code).toUpperCase();
  if (!normalizedCode) return null;

  const fromStock = state.stock.find((item) => item.code === normalizedCode);
  if (fromStock) return fromStock;

  const fromHistory = [...state.history]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .find((item) => item.code === normalizedCode);

  return fromHistory || null;
}

function getStockItem(code, street, address, level) {
  const key = createStockKey(code, street, address, level);
  return state.stock.find((item) => createStockKey(item.code, item.street, item.address, item.level) === key) || null;
}

function countDistinctCodesInLocation(street, address, level) {
  const codes = new Set(
    state.stock
      .filter((item) => item.street === street && item.address === address && item.level === level)
      .map((item) => item.code)
  );
  return codes;
}

function getFilteredHistory() {
  const period = auditPeriod?.value || "all";
  const now = new Date();
  const todayKey = getDayKey(now);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  return state.history.filter((item) => {
    if (period === "daily") {
      return getDayKey(item.timestamp) === todayKey;
    }
    if (period === "weekly") {
      return new Date(item.timestamp) >= weekAgo;
    }
    return true;
  });
}

function updateCodeHint() {
  const code = normalizeText(pieceCodeInput?.value).toUpperCase();
  if (!codeHint) return;

  if (!code) {
    codeHint.textContent = "";
    return;
  }

  const knownProduct = getKnownProductByCode(code);
  if (knownProduct) {
    codeHint.textContent = "Código já existe na nuvem. A descrição será reaproveitada automaticamente.";
    if (pieceDescriptionInput && !normalizeText(pieceDescriptionInput.value) && knownProduct.description) {
      pieceDescriptionInput.value = knownProduct.description;
    }
    return;
  }

  codeHint.textContent = "Código novo. Informe a descrição e faça uma entrada para cadastrar o produto.";
}

// ============================================================================
// RENDERIZAÇÃO
// ============================================================================
function renderUserBadge() {
  if (!state.currentUser) {
    userBadge.innerHTML = `
      <strong>Visitante</strong>
      <small>Faça login para acessar o painel.</small>
    `;
    welcomeUserName.textContent = "RIGITEC";
    return;
  }

  userBadge.innerHTML = `
    <strong>${escapeHtml(state.currentUser.username)}</strong>
    <small>${escapeHtml(state.currentUser.role || "Sem função")}</small>
    <small>${getUserAccess(state.currentUser) === "admin" ? "Perfil administrador" : "Perfil operacional"}</small>
  `;
  welcomeUserName.textContent = state.currentUser.username.toUpperCase();
}

function renderDashboard() {
  const totalItems = state.stock.length;
  const totalVolume = state.stock.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const todayKey = getDayKey(new Date());
  const todayMoves = state.history.filter((item) => getDayKey(item.timestamp) === todayKey).length;
  const activeUsers = state.users.filter(isUserActive).length;

  document.getElementById("totalItemsStat").textContent = numberFormatter.format(totalItems);
  document.getElementById("totalVolumeStat").textContent = numberFormatter.format(totalVolume);
  document.getElementById("dailyMovesStat").textContent = numberFormatter.format(todayMoves);
  document.getElementById("activeUsersStat").textContent = numberFormatter.format(activeUsers);

  const inventorySummary = document.getElementById("inventorySummary");
  const streets = getAllKnownStreets();

  inventorySummary.innerHTML = streets.map((street) => {
    const items = state.stock.filter((item) => item.street === street);
    const positions = new Set(items.map((item) => `${item.address}||${item.level}`));
    const quantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

    return `
      <div class="summary-item">
        <strong>Rua ${escapeHtml(street)}</strong>
        <small>${numberFormatter.format(items.length)} códigos com saldo</small>
        <small>${numberFormatter.format(positions.size)} posições ocupadas</small>
        <small>${numberFormatter.format(quantity)} peças disponíveis</small>
      </div>
    `;
  }).join("") || '<div class="empty-state">Nenhum saldo encontrado na nuvem.</div>';

  const auditPreview = document.getElementById("auditPreview");
  const latest = [...state.history]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 5);

  auditPreview.innerHTML = latest.length
    ? latest.map((item) => `
        <div class="timeline-item">
          <strong>${escapeHtml(item.type.toUpperCase())} • ${escapeHtml(item.code || "SEM CÓDIGO")}</strong>
          <small>${escapeHtml(item.user)} • ${dateTimeFormatter.format(new Date(item.timestamp))}</small>
          <small>
            ${numberFormatter.format(item.quantity)} un. em ${escapeHtml(item.street || "-")} / ${escapeHtml(item.address || "-")} / nível ${escapeHtml(item.level || "-")}
            ${item.type === "transferencia"
              ? ` → ${escapeHtml(item.destinationStreet || "-")} / ${escapeHtml(item.destinationAddress || "-")} / nível ${escapeHtml(item.destinationLevel || "-")}`
              : ""}
          </small>
        </div>
      `).join("")
    : '<div class="empty-state">Ainda não existem movimentações gravadas no Supabase.</div>';

  renderUserBadge();
  updateWelcomeClock();
}

function renderAuditSummary() {
  const target = document.getElementById("auditSummary");
  const filtered = getFilteredHistory();

  const entries = filtered.filter((item) => item.type === "entrada").length;
  const exits = filtered.filter((item) => item.type === "saida").length;
  const transfers = filtered.filter((item) => item.type === "transferencia").length;

  target.innerHTML = `
    <div class="summary-strip">
      <strong>${numberFormatter.format(filtered.length)} registros</strong>
      <small>Período filtrado diretamente sobre o histórico real</small>
    </div>
    <div class="summary-strip">
      <strong>${numberFormatter.format(entries)} entradas</strong>
      <small>${numberFormatter.format(exits)} saídas e ${numberFormatter.format(transfers)} transferências</small>
    </div>
  `;
}

function renderHistoryTable() {
  const target = document.getElementById("historyTable");
  const filtered = [...getFilteredHistory()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (!filtered.length) {
    target.innerHTML = '<div class="empty-state">Nenhuma movimentação encontrada para o período selecionado.</div>';
    return;
  }

  const rows = filtered.map((item) => `
    <tr>
      <td><span class="badge badge-${escapeHtml(item.type)}">${escapeHtml(item.type)}</span></td>
      <td>
        <strong>${escapeHtml(item.code || "SEM CÓDIGO")}</strong><br>
        <small>${escapeHtml(item.description || "Sem descrição")}</small>
      </td>
      <td>${numberFormatter.format(item.quantity)}</td>
      <td>
        ${escapeHtml(item.street || "-")} / ${escapeHtml(item.address || "-")} / ${escapeHtml(item.level || "-")}
        ${item.type === "transferencia"
          ? `<br><small>Destino: ${escapeHtml(item.destinationStreet || "-")} / ${escapeHtml(item.destinationAddress || "-")} / ${escapeHtml(item.destinationLevel || "-")}</small>`
          : ""}
      </td>
      <td>${escapeHtml(item.user)}</td>
      <td>${dateTimeFormatter.format(new Date(item.timestamp))}</td>
    </tr>
  `).join("");

  target.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Tipo</th>
          <th>Item</th>
          <th>Qtd.</th>
          <th>Posição</th>
          <th>Responsável</th>
          <th>Data</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderUsersTable() {
  const target = document.getElementById("usersTable");
  if (!target) return;

  if (!state.users.length) {
    target.innerHTML = '<div class="empty-state">Nenhum usuário encontrado na tabela `usuarios`.</div>';
    return;
  }

  const rows = state.users.map((user) => `
    <tr>
      <td>${escapeHtml(user.username || "")}</td>
      <td>${escapeHtml(user.role || "Sem função")}</td>
      <td><span class="badge badge-${getUserAccess(user) === "admin" ? "admin" : "usuario"}">${escapeHtml(getUserAccess(user))}</span></td>
      <td>${isUserActive(user) ? "Ativo" : "Inativo"}</td>
    </tr>
  `).join("");

  target.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Usuário</th>
          <th>Função</th>
          <th>Acesso</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderStockMap() {
  const target = document.getElementById("stockMap");
  const term = normalizeText(stockSearch?.value).toLowerCase();
  const selectedStreet = streetFilter?.value || "todos";
  const streets = getAllKnownStreets().filter((street) => selectedStreet === "todos" || street === selectedStreet);

  const blocks = streets.map((street) => {
    const items = state.stock.filter((item) => {
      const matchesStreet = item.street === street;
      const matchesSearch = !term
        || item.code.toLowerCase().includes(term)
        || (item.description || "").toLowerCase().includes(term);

      return matchesStreet && matchesSearch;
    });

    const cards = items.length
      ? items.map((item) => `
          <div class="address-card">
            <strong>${escapeHtml(item.code)}</strong>
            <small>${escapeHtml(item.description || "Sem descrição")}</small>
            <span class="slot-usage">${escapeHtml(item.address)} • nível ${escapeHtml(item.level || "-")}</span>
            <small>${numberFormatter.format(item.quantity)} peças</small>
          </div>
        `).join("")
      : '<div class="empty-state">Nenhum item encontrado nesta rua com o filtro atual.</div>';

    return `
      <article class="street-column">
        <div class="street-header">
          <div>
            <strong>Rua ${escapeHtml(street)}</strong>
            <p class="street-meta">${numberFormatter.format(items.length)} códigos localizados</p>
          </div>
          <span class="tag">Mapa ativo</span>
        </div>
        <div class="address-grid">${cards}</div>
      </article>
    `;
  });

  target.innerHTML = blocks.join("") || '<div class="empty-state">Nenhuma rua encontrada para o filtro atual.</div>';
}

function renderAll() {
  renderDashboard();
  renderAuditSummary();
  renderHistoryTable();
  renderUsersTable();
  renderStockMap();
  updateCodeHint();
}

// ============================================================================
// CONTROLE DE TELA
// ============================================================================
function syncAdminVisibility() {
  const isAdmin = getUserAccess(state.currentUser) === "admin";
  document.querySelectorAll(".admin-only").forEach((element) => {
    element.classList.toggle("hidden", !isAdmin);
  });
}

function switchView(viewId) {
  const isAdmin = getUserAccess(state.currentUser) === "admin";
  const safeView = viewId === "administracao" && !isAdmin ? "painel" : viewId;

  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === safeView);
  });

  document.querySelectorAll(".menu-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === safeView);
  });

  viewTitle.textContent = viewTitles[safeView] || "Painel executivo";
}

function toggleTransferFields() {
  const isTransfer = movementType.value === "transferencia";
  document.querySelectorAll(".transfer-only").forEach((element) => {
    element.classList.toggle("hidden", !isTransfer);
  });
}

function openConfirmationModal(payload) {
  const originLabel = `${payload.street} / ${payload.address} / nível ${payload.level}`;
  const destinationLabel = payload.type === "transferencia"
    ? `${payload.destinationStreet} / ${payload.destinationAddress} / nível ${payload.destinationLevel}`
    : "Não se aplica";

  operationPreview.innerHTML = `
    <strong>${escapeHtml(payload.type.toUpperCase())} • ${escapeHtml(payload.code)}</strong>
    <small>${escapeHtml(payload.description || "Sem descrição")}</small>
    <small>Quantidade: ${numberFormatter.format(payload.quantity)}</small>
    <small>Origem: ${escapeHtml(originLabel)}</small>
    <small>Destino: ${escapeHtml(destinationLabel)}</small>
  `;
  confirmModal.classList.remove("hidden");
}

function closeConfirmationModal() {
  confirmModal.classList.add("hidden");
  pendingOperation = null;
  confirmForm.reset();
}

function clearOperationForm() {
  operationForm.reset();
  movementType.value = "entrada";
  toggleTransferFields();
  updateCodeHint();
}

// ============================================================================
// VALIDAÇÃO DE OPERAÇÕES
// ============================================================================
function collectOperationPayload() {
  return {
    type: normalizeType(movementType.value),
    code: normalizeText(document.getElementById("pieceCode").value).toUpperCase(),
    description: normalizeText(document.getElementById("pieceDescription").value),
    quantity: Number(document.getElementById("quantity").value || 0),
    street: normalizeText(document.getElementById("street").value),
    address: normalizeText(document.getElementById("address").value).toUpperCase(),
    level: normalizeText(document.getElementById("level").value),
    destinationStreet: normalizeText(document.getElementById("destinationStreet").value),
    destinationAddress: normalizeText(document.getElementById("destinationAddress").value).toUpperCase(),
    destinationLevel: normalizeText(document.getElementById("destinationLevel").value),
    observation: normalizeText(document.getElementById("observation").value)
  };
}

function getHydratedPayload(payload) {
  const knownProduct = getKnownProductByCode(payload.code);
  return {
    ...payload,
    description: payload.description || knownProduct?.description || ""
  };
}

function validateOperationPayload(payload) {
  if (!payload.code) {
    return "Informe o código da peça.";
  }

  if (!payload.street || !payload.address || !payload.level) {
    return "Preencha rua, endereço e nível de origem.";
  }

  if (!Number.isFinite(payload.quantity) || payload.quantity <= 0) {
    return "A quantidade precisa ser maior que zero.";
  }

  const hydratedPayload = getHydratedPayload(payload);
  const knownProduct = getKnownProductByCode(payload.code);

  if (!hydratedPayload.description) {
    return "Para código novo, informe a descrição do produto antes de salvar.";
  }

  if (payload.type === "saida" || payload.type === "transferencia") {
    const stockItem = getStockItem(payload.code, payload.street, payload.address, payload.level);

    if (!stockItem) {
      return "Não existe saldo desse código na posição de origem informada.";
    }

    if (payload.quantity > stockItem.quantity) {
      return "A quantidade informada é maior que o saldo disponível nessa posição.";
    }
  }

  if (payload.type === "transferencia") {
    if (!payload.destinationStreet || !payload.destinationAddress || !payload.destinationLevel) {
      return "Preencha rua, endereço e nível de destino.";
    }

    const sameLocation =
      payload.street === payload.destinationStreet &&
      payload.address === payload.destinationAddress &&
      payload.level === payload.destinationLevel;

    if (sameLocation) {
      return "A origem e o destino não podem ser a mesma posição.";
    }

    const destinationCodes = countDistinctCodesInLocation(
      payload.destinationStreet,
      payload.destinationAddress,
      payload.destinationLevel
    );

    if (!destinationCodes.has(payload.code) && destinationCodes.size >= 3) {
      return "A posição de destino já atingiu o limite de 3 códigos diferentes.";
    }
  }

  if (payload.type === "entrada") {
    const destinationCodes = countDistinctCodesInLocation(payload.street, payload.address, payload.level);
    if (!destinationCodes.has(payload.code) && destinationCodes.size >= 3) {
      return "A posição informada já atingiu o limite de 3 códigos diferentes.";
    }
  }

  if ((payload.type === "saida" || payload.type === "transferencia") && !knownProduct) {
    return "Esse código ainda não existe no estoque real. Cadastre-o primeiro com uma entrada.";
  }

  return "";
}

// ============================================================================
// SUPABASE
// ============================================================================
async function refreshState(showErrorAlert = false) {
  try {
    const [historyResponse, usersResponse] = await Promise.all([
      supabaseClient
        .from("movimentacoes")
        .select("*"),
   
      supabaseClient
        .from("usuarios")
        .select("*")
    ]);

    if (historyResponse.error) throw historyResponse.error;
    if (usersResponse.error) throw usersResponse.error;

    state.history = (historyResponse.data || []).map(normalizeHistoryRecord);
    state.users = usersResponse.data || [];
    state.stock = buildStockFromHistory(state.history);

    renderAll();
  } catch (error) {
    console.error("Erro ao sincronizar com o Supabase:", error);
    if (showErrorAlert) {
      showAlert(`Erro ao sincronizar com o Supabase: ${error.message}`, "error");
    }
  }
}

function setupRealtime() {
  if (realtimeChannel || !supabaseClient.channel) return;

  realtimeChannel = supabaseClient
    .channel("estoque-online")
    .on("postgres_changes", { event: "*", schema: "public", table: "movimentacoes" }, () => refreshState())
    .on("postgres_changes", { event: "*", schema: "public", table: "usuarios" }, () => refreshState())
    .subscribe();
}

async function authenticateUser(username, password) {
  const { data, error } = await supabaseClient
    .from("usuarios")
    .select("*")
    .eq("username", username)
    .eq("password", password)
    .limit(1);

  if (error) throw error;
  const user = data?.[0] || null;

  if (!user) {
    throw new Error("Usuário ou senha incorretos.");
  }

  if (!isUserActive(user)) {
    throw new Error("Esse usuário está inativo no banco de dados.");
  }

  return user;
}

// ============================================================================
// EXPORTAÇÃO
// ============================================================================
function downloadTextFile(content, filename, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const value = String(cell ?? "");
    if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
      return `"${value.replace(/"/g, "\"\"")}"`;
    }
    return value;
  }).join(",")).join("\n");
}

function exportStockCsv() {
  const rows = [
    ["codigo", "descricao", "quantidade", "rua", "endereco", "nivel"]
  ];

  state.stock.forEach((item) => {
    rows.push([
      item.code,
      item.description,
      item.quantity,
      item.street,
      item.address,
      item.level
    ]);
  });

  downloadTextFile(toCsv(rows), "estoque_real.csv", "text/csv;charset=utf-8");
}

function exportHistoryCsv() {
  const rows = [
    ["tipo", "codigo", "descricao", "quantidade", "origem_rua", "origem_endereco", "origem_nivel", "destino_rua", "destino_endereco", "destino_nivel", "responsavel", "data", "observacao"]
  ];

  state.history.forEach((item) => {
    rows.push([
      item.type,
      item.code,
      item.description,
      item.quantity,
      item.street,
      item.address,
      item.level,
      item.destinationStreet,
      item.destinationAddress,
      item.destinationLevel,
      item.user,
      item.timestamp,
      item.observation
    ]);
  });

  downloadTextFile(toCsv(rows), "auditoria_real.csv", "text/csv;charset=utf-8");
}

// ============================================================================
// EVENTOS
// ============================================================================
loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const username = normalizeText(document.getElementById("username").value);
  const password = normalizeText(document.getElementById("password").value);

  try {
    const user = await authenticateUser(username, password);
    state.currentUser = user;

    await refreshState(true);
    syncAdminVisibility();

    loginScreen.classList.add("hidden");
    dashboardScreen.classList.remove("hidden");
    switchView("painel");

    showAlert(`Bem-vindo, ${user.username}. O painel agora mostra apenas dados reais da nuvem.`, "success");
  } catch (error) {
    showAlert(error.message || "Falha ao validar login no Supabase.", "error");
  }
});

operationForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const payload = collectOperationPayload();
  const validationMessage = validateOperationPayload(payload);

  if (validationMessage) {
    showAlert(validationMessage, "error");
    return;
  }

  pendingOperation = getHydratedPayload(payload);
  openConfirmationModal(pendingOperation);
});

confirmForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!pendingOperation) {
    showAlert("Nenhuma operação pendente para confirmar.", "error");
    return;
  }

  try {
    const responsibleUsername = normalizeText(document.getElementById("confirmUsername").value);
    const responsiblePassword = normalizeText(document.getElementById("confirmPassword").value);

    const responsibleUser = await authenticateUser(responsibleUsername, responsiblePassword);

    const insertPayload = {
      movimentacao: pendingOperation.type,
      produto: buildProductLabel(pendingOperation.code, pendingOperation.description),
      quantidade: pendingOperation.quantity,
      origem: formatLocation(pendingOperation.street, pendingOperation.address, pendingOperation.level),
      destino: pendingOperation.type === "transferencia"
        ? formatLocation(
            pendingOperation.destinationStreet,
            pendingOperation.destinationAddress,
            pendingOperation.destinationLevel
          )
        : "N/A",
      observacao: pendingOperation.observation,
      usuario_responsavel: responsibleUser.username
    };

    const { error } = await supabaseClient
      .from("movimentacoes")
      .insert([insertPayload]);

    if (error) throw error;

    await refreshState(true);
    closeConfirmationModal();
    clearOperationForm();
    switchView("auditoria");
    showAlert("Movimentação registrada com sucesso no Supabase.", "success");
  } catch (error) {
    showAlert(error.message || "Falha ao gravar movimentação no Supabase.", "error");
  }
});

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (getUserAccess(state.currentUser) !== "admin") {
    showAlert("Somente administradores podem cadastrar novos usuários.", "error");
    return;
  }

  const username = normalizeText(document.getElementById("newUserName").value);
  const password = normalizeText(document.getElementById("newUserPassword").value);
  const role = normalizeText(document.getElementById("newUserRole").value);
  const access = normalizeText(document.getElementById("newUserAccess").value) || "usuario";

  try {
    const { error } = await supabaseClient
      .from("usuarios")
      .insert([{ username, password, role, access }]);

    if (error) throw error;

    await refreshState(true);
    userForm.reset();
    showAlert("Usuário cadastrado com sucesso no Supabase.", "success");
  } catch (error) {
    showAlert(error.message || "Falha ao cadastrar usuário.", "error");
  }
});

document.querySelectorAll(".menu-btn").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

movementType.addEventListener("change", toggleTransferFields);
stockSearch.addEventListener("input", renderStockMap);
streetFilter.addEventListener("change", renderStockMap);
auditPeriod.addEventListener("change", () => {
  renderAuditSummary();
  renderHistoryTable();
});

pieceCodeInput.addEventListener("input", () => {
  pieceCodeInput.value = normalizeText(pieceCodeInput.value).toUpperCase();
  updateCodeHint();
});

pieceCodeInput.addEventListener("blur", updateCodeHint);

document.getElementById("resetDemoBtn").addEventListener("click", async () => {
  await refreshState(true);
  showAlert("Dados sincronizados com a nuvem.", "success");
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  state.currentUser = null;
  dashboardScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  syncAdminVisibility();
  loginForm.reset();
  switchView("painel");
  showAlert("Sessão encerrada.", "success");
});

document.getElementById("cancelConfirmBtn").addEventListener("click", closeConfirmationModal);
document.getElementById("exportStockBtn").addEventListener("click", exportStockCsv);
document.getElementById("exportHistoryBtn").addEventListener("click", exportHistoryCsv);

// ============================================================================
// INICIALIZAÇÃO
// ============================================================================
async function initializeApp() {
  toggleTransferFields();
  updateWelcomeClock();
  syncAdminVisibility();
  await refreshState(false);
  setupRealtime();
  setInterval(updateWelcomeClock, 1000);
}

initializeApp();
