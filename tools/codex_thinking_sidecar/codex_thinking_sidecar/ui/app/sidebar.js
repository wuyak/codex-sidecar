import { colorForKey, formatTs, keyOf, shortId } from "./utils.js";

export function isSidebarCollapsed() {
  try { return document.body.classList.contains("sidebar-collapsed"); } catch (_) { return false; }
}

export function setSidebarCollapsed(dom, v) {
  try { document.body.classList.toggle("sidebar-collapsed", !!v); } catch (_) {}
  try { if (dom.sidebarToggleBtn) dom.sidebarToggleBtn.textContent = v ? "⟫" : "⟪"; } catch (_) {}
}

let tooltipEl = null;
let tooltipRaf = 0;
let tooltipLast = { x: 0, y: 0 };

function ensureTooltip() {
  if (tooltipEl) return tooltipEl;
  const el = document.createElement("div");
  el.className = "tab-tooltip";
  el.style.display = "none";
  const title = document.createElement("div");
  title.className = "tt-title";
  const meta = document.createElement("div");
  meta.className = "tt-meta";
  const code = document.createElement("pre");
  code.className = "tt-code";
  el.appendChild(title);
  el.appendChild(meta);
  el.appendChild(code);
  el.__title = title;
  el.__meta = meta;
  el.__code = code;
  document.body.appendChild(el);
  tooltipEl = el;
  return el;
}

function hideTooltip() {
  try {
    if (tooltipRaf) cancelAnimationFrame(tooltipRaf);
    tooltipRaf = 0;
  } catch (_) {}
  try { if (tooltipEl) tooltipEl.style.display = "none"; } catch (_) {}
}

function setTooltipContent(title, meta, code) {
  const el = ensureTooltip();
  try { el.__title.textContent = String(title || ""); } catch (_) {}
  try {
    const m = String(meta || "");
    el.__meta.textContent = m;
    el.__meta.style.display = m ? "" : "none";
  } catch (_) {}
  try {
    const c = String(code || "");
    el.__code.textContent = c;
    el.__code.style.display = c ? "" : "none";
  } catch (_) {}
  return el;
}

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.min(b, Math.max(a, x));
}

function positionTooltipNow(x, y) {
  const el = tooltipEl;
  if (!el) return;
  try {
    el.style.display = "block";
    el.style.visibility = "hidden";
    el.style.left = "0px";
    el.style.top = "0px";
    const rect = el.getBoundingClientRect();
    const pad = 12;
    const dx = 14;
    const dy = 14;
    let left = x + dx;
    let top = y + dy;
    if (left + rect.width + pad > window.innerWidth) left = x - rect.width - dx;
    if (top + rect.height + pad > window.innerHeight) top = window.innerHeight - rect.height - pad;
    left = clamp(left, pad, Math.max(pad, window.innerWidth - rect.width - pad));
    top = clamp(top, pad, Math.max(pad, window.innerHeight - rect.height - pad));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = "visible";
  } catch (_) {}
}

function positionTooltip(x, y) {
  tooltipLast = { x, y };
  if (tooltipRaf) return;
  try {
    tooltipRaf = requestAnimationFrame(() => {
      tooltipRaf = 0;
      positionTooltipNow(tooltipLast.x, tooltipLast.y);
    });
  } catch (_) {
    tooltipRaf = 0;
    positionTooltipNow(x, y);
  }
}

function showTooltip(title, meta, code, x, y) {
  setTooltipContent(title, meta, code);
  positionTooltipNow(x, y);
}

function badgeText(n) {
  const x = Number(n) || 0;
  if (x <= 0) return "";
  if (x < 100) return String(x);
  if (x < 1000) return "99+";
  return "999+";
}

function bindCollapsedTooltip(btn, t, label) {
  if (!btn || btn.__ttBound) return;
  btn.__ttBound = true;
  const full = String(t.thread_id || t.file || t.key || "").trim();
  const count = Number(t.count || 0) || 0;
  const ts = formatTs(t.last_ts || "");
  const meta = [count ? `消息 ${count}` : "", ts.local ? `最后 ${ts.local}` : ""].filter(Boolean).join(" · ");

  const showAt = (x, y) => showTooltip(label, meta, full, x, y);
  const showAtRect = () => {
    try {
      const r = btn.getBoundingClientRect();
      showAt(r.right, r.top + (r.height / 2));
    } catch (_) {}
  };

  btn.addEventListener("mouseenter", (e) => {
    try {
      if (e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) showAt(e.clientX, e.clientY);
      else showAtRect();
    } catch (_) { showAtRect(); }
  });
  btn.addEventListener("mousemove", (e) => {
    try {
      if (e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) positionTooltip(e.clientX, e.clientY);
    } catch (_) {}
  });
  btn.addEventListener("mouseleave", hideTooltip);
  btn.addEventListener("focus", showAtRect);
  btn.addEventListener("blur", hideTooltip);
  btn.addEventListener("mousedown", hideTooltip);
}

function rolloutStampFromFile(filePath) {
  try {
    const base = (filePath || "").split("/").slice(-1)[0] || "";
    const m = base.match(new RegExp("^rollout-(\\d{4}-\\d{2}-\\d{2})T(\\d{2}-\\d{2}-\\d{2})-"));
    if (!m) return "";
    return `${m[1]} ${String(m[2] || "").replace(/-/g, ":")}`;
  } catch (e) {
    return "";
  }
}

function threadLabel(t) {
  const stamp = rolloutStampFromFile(t.file || "");
  const idPart = t.thread_id ? shortId(t.thread_id) : shortId(((t.file || "").split("/").slice(-1)[0]) || (t.key || ""));
  if (stamp && idPart) return `${stamp} · ${idPart}`;
  return idPart || stamp || "unknown";
}

export function clearTabs(dom) {
  const tabs = dom.tabs;
  if (!tabs) return;
  while (tabs.firstChild) tabs.removeChild(tabs.firstChild);
}

export function upsertThread(state, msg) {
  const key = keyOf(msg);
  const prev = state.threadIndex.get(key) || { key, thread_id: msg.thread_id || "", file: msg.file || "", count: 0, last_ts: "" };
  prev.count = (prev.count || 0) + 1;
  const ts = msg.ts || "";
  if (ts && (!prev.last_ts || ts > prev.last_ts)) prev.last_ts = ts;
  state.threadIndex.set(key, prev);
}

export function renderTabs(dom, state, onSelectKey) {
  const tabs = dom.tabs;
  if (!tabs) return;
  const collapsed = isSidebarCollapsed();
  const items = Array.from(state.threadIndex.values()).sort((a, b) => (b.last_ts || "").localeCompare(a.last_ts || ""));
  hideTooltip();
  clearTabs(dom);

  const allBtn = document.createElement("button");
  allBtn.className = "tab" + (state.currentKey === "all" ? " active" : "");
  allBtn.textContent = collapsed ? "≡" : "全部";
  allBtn.title = "全部";
  allBtn.onclick = () => onSelectKey("all");
  tabs.appendChild(allBtn);

  for (const t of items) {
    const btn = document.createElement("button");
    btn.className = "tab" + (state.currentKey === t.key ? " active" : "");
    const clr = colorForKey(t.key || "");
    const label = threadLabel(t);
    if (collapsed) {
      btn.textContent = "";
      try {
        btn.style.color = clr.fg;
        btn.style.borderColor = clr.border;
        if (state.currentKey === t.key) {
          btn.style.background = clr.bgActive;
          btn.style.color = "#fff";
          btn.style.borderColor = clr.bgActive;
        } else {
          btn.style.background = "#fff";
        }
      } catch (_) {}
      const dot = document.createElement("span");
      dot.className = "tab-dot";
      try { dot.style.background = (state.currentKey === t.key) ? "#fff" : clr.fg; } catch (_) {}
      btn.appendChild(dot);
      const btxt = badgeText(t.count || 0);
      if (btxt) {
        const badge = document.createElement("span");
        badge.className = "tab-badge";
        badge.textContent = btxt;
        btn.appendChild(badge);
      }
      try { btn.setAttribute("aria-label", label); } catch (_) {}
      bindCollapsedTooltip(btn, t, label);
    } else {
      try { btn.style.borderColor = clr.border; } catch (_) {}
      const dot = document.createElement("span");
      dot.className = "tab-dot";
      try { dot.style.background = clr.fg; } catch (_) {}
      const labelSpan = document.createElement("span");
      labelSpan.className = "tab-label";
      labelSpan.textContent = label;
      const small = document.createElement("small");
      small.textContent = `(${t.count || 0})`;
      btn.appendChild(dot);
      btn.appendChild(labelSpan);
      btn.appendChild(small);
      btn.title = t.thread_id || t.file || t.key;
    }
    btn.onclick = () => onSelectKey(t.key);
    tabs.appendChild(btn);
  }
}
