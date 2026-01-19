const _LS_THEME = "codex_sidecar_ui_theme";

let _themeIndex = new Map(); // id -> { id, label, tokens }
let _defaultThemeId = "catppuccin-latte";

function _sanitizeId(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return "";
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(s) ? s : "";
}

function _hexToRgb(hex) {
  const s = String(hex || "").trim();
  const m = s.match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const h = m[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return null;
  return { r, g, b };
}

function _luminance(rgb) {
  const toLin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? (v / 12.92) : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = toLin(rgb.r);
  const g = toLin(rgb.g);
  const b = toLin(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function _isDarkTheme(tokens) {
  const t = (tokens && typeof tokens === "object") ? tokens : {};
  const bg = String(t["--c-bg"] || "").trim();
  const rgb = _hexToRgb(bg);
  if (!rgb) return false;
  return _luminance(rgb) < 0.38;
}

function _applyTokens(tokens) {
  if (!tokens || typeof tokens !== "object") return;
  const host = document.body || document.documentElement;
  for (const [k, v] of Object.entries(tokens)) {
    const key = String(k || "").trim();
    const val = String(v || "").trim();
    if (!key.startsWith("--") || !val) continue;
    try { host.style.setProperty(key, val); } catch (_) {}
    // Back-compat aliases (manifest uses clearer names; CSS keeps shorter ones).
    try {
      if (key === "--bg-pattern-size") host.style.setProperty("--bg-size", val);
      if (key === "--bg-pattern-pos") host.style.setProperty("--bg-pos", val);
    } catch (_) {}
  }
}

function _applyTheme(id, dom, opts) {
  const tid = _sanitizeId(id) || _defaultThemeId;
  const t = _themeIndex.get(tid) || _themeIndex.get(_defaultThemeId);
  if (!t) return;
  try { document.body.dataset.uiTheme = t.id; } catch (_) {}
  try { document.body.dataset.bmSkin = _isDarkTheme(t.tokens || {}) ? "dark" : "default"; } catch (_) {}
  try { _applyTokens(t.tokens || {}); } catch (_) {}
  try { if (dom && dom.uiTheme) dom.uiTheme.value = t.id; } catch (_) {}
  try { localStorage.setItem(_LS_THEME, t.id); } catch (_) {}
  try {
    const setStatus = opts && typeof opts.setStatus === "function" ? opts.setStatus : null;
    if (setStatus) setStatus(dom, `主题已切换：${t.label || t.id}`);
  } catch (_) {}
}

async function _loadManifest() {
  const ts = Date.now();
  const r = await fetch(`/ui/themes/manifest.json?t=${ts}`, { cache: "no-store" });
  const obj = await r.json();
  if (!obj || typeof obj !== "object") return;
  const def = _sanitizeId(obj.default) || "";
  const list = Array.isArray(obj.themes) ? obj.themes : [];
  const idx = new Map();
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const id = _sanitizeId(it.id);
    const label = String(it.label || "").trim() || id;
    const tokens = it.tokens && typeof it.tokens === "object" ? it.tokens : {};
    if (!id) continue;
    idx.set(id, { id, label, tokens });
  }
  if (idx.size <= 0) return;
  _themeIndex = idx;
  _defaultThemeId = def && idx.has(def) ? def : (idx.keys().next().value || _defaultThemeId);
}

function _renderSelect(dom) {
  const sel = dom && dom.uiTheme ? dom.uiTheme : null;
  if (!sel) return;
  try { sel.innerHTML = ""; } catch (_) {}
  for (const t of _themeIndex.values()) {
    try {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label || t.id;
      sel.appendChild(opt);
    } catch (_) {}
  }
}

export async function initTheme(dom, opts = {}) {
  try { await _loadManifest(); } catch (_) {}
  try { _renderSelect(dom); } catch (_) {}

  let want = "";
  try { want = _sanitizeId(localStorage.getItem(_LS_THEME)); } catch (_) { want = ""; }
  _applyTheme(want || _defaultThemeId, dom, opts);

  const sel = dom && dom.uiTheme ? dom.uiTheme : null;
  if (sel) {
    sel.addEventListener("change", () => {
      const next = _sanitizeId(sel.value) || _defaultThemeId;
      _applyTheme(next, dom, opts);
    });
  }
}
