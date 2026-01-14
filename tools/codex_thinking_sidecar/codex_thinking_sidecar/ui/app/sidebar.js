import { colorForKey, keyOf, shortId } from "./utils.js";

const _LABELS_KEY = "codex_sidecar_thread_labels_v1";
let _labelsCache = null;

function _loadLabels() {
  if (_labelsCache) return _labelsCache;
  try {
    const raw = localStorage.getItem(_LABELS_KEY) || "";
    const obj = raw ? JSON.parse(raw) : {};
    if (obj && typeof obj === "object") _labelsCache = obj;
    else _labelsCache = {};
  } catch (_) {
    _labelsCache = {};
  }
  return _labelsCache;
}

function _saveLabels(obj) {
  _labelsCache = obj || {};
  try { localStorage.setItem(_LABELS_KEY, JSON.stringify(_labelsCache)); } catch (_) {}
}

function getCustomLabel(key) {
  const k = String(key || "").trim();
  if (!k) return "";
  const obj = _loadLabels();
  const v = (obj && typeof obj === "object") ? obj[k] : "";
  return String(v || "").trim();
}

function setCustomLabel(key, label) {
  const k = String(key || "").trim();
  if (!k) return;
  const v = String(label || "").trim();
  const obj = { ..._loadLabels() };
  if (!v) delete obj[k];
  else obj[k] = v;
  _saveLabels(obj);
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
  const items = Array.from(state.threadIndex.values()).sort((a, b) => (b.last_ts || "").localeCompare(a.last_ts || ""));
  clearTabs(dom);

  const allBtn = document.createElement("button");
  allBtn.className = "tab" + (state.currentKey === "all" ? " active" : "");
  allBtn.textContent = "全部";
  allBtn.title = "全部";
  allBtn.onclick = () => onSelectKey("all");
  tabs.appendChild(allBtn);

  for (const t of items) {
    const btn = document.createElement("button");
    btn.className = "tab" + (state.currentKey === t.key ? " active" : "");
    const clr = colorForKey(t.key || "");
    const defaultLabel = threadLabel(t);
    const custom = getCustomLabel(t.key);
    const label = custom || defaultLabel;

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

    const rename = () => {
      const cur = getCustomLabel(t.key);
      const next = prompt("设置会话标签（留空清除）：", cur || label) ;
      if (next === null) return;
      const v = String(next || "").trim();
      // If user sets it equal to the default label, treat as "no custom label".
      if (!v || v === defaultLabel) setCustomLabel(t.key, "");
      else setCustomLabel(t.key, v);
      renderTabs(dom, state, onSelectKey);
    };
    btn.addEventListener("contextmenu", (e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} rename(); });
    btn.addEventListener("dblclick", (e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} rename(); });
    btn.title = t.thread_id || t.file || t.key;
    btn.onclick = () => onSelectKey(t.key);
    tabs.appendChild(btn);
  }
}
