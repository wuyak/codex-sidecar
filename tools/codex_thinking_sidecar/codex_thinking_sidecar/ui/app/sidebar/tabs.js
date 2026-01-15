import { colorForKey, keyOf, shortId } from "../utils.js";
import { getCustomLabel, setCustomLabel } from "./labels.js";
import { loadHiddenThreads } from "./hidden.js";

const _ROLLOUT_STAMP_RE = /^rollout-(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})-/;

function rolloutStampFromFile(filePath) {
  try {
    const base = (filePath || "").split("/").slice(-1)[0] || "";
    const m = base.match(_ROLLOUT_STAMP_RE);
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

function _getOrCreateTab(tabs, existing, key, create) {
  const k = String(key || "");
  const prev = existing && typeof existing.get === "function" ? existing.get(k) : null;
  if (prev) return prev;
  const el = create();
  try { el.dataset.key = k; } catch (_) {}
  return el;
}

function _ensureTabStructure(btn) {
  if (!btn) return null;
  const dot = btn.querySelector ? btn.querySelector(".tab-dot") : null;
  const labelSpan = btn.querySelector ? btn.querySelector(".tab-label") : null;
  const countEl = btn.querySelector ? btn.querySelector("small") : null;
  if (dot && labelSpan && countEl) return { dot, labelSpan, countEl };
  // (Re)build inner structure once; updates reuse these nodes.
  while (btn.firstChild) btn.removeChild(btn.firstChild);
  const d = document.createElement("span");
  d.className = "tab-dot";
  const l = document.createElement("span");
  l.className = "tab-label";
  const s = document.createElement("small");
  btn.appendChild(d);
  btn.appendChild(l);
  btn.appendChild(s);
  return { dot: d, labelSpan: l, countEl: s };
}

export function upsertThread(state, msg) {
  const key = keyOf(msg);
  const prev = state.threadIndex.get(key) || { key, thread_id: msg.thread_id || "", file: msg.file || "", count: 0, last_ts: "", last_seq: 0 };
  prev.count = (prev.count || 0) + 1;
  const ts = msg.ts || "";
  if (ts && (!prev.last_ts || ts > prev.last_ts)) prev.last_ts = ts;
  const seq = Number.isFinite(Number(msg && msg.seq)) ? Number(msg.seq) : 0;
  if (seq && (!prev.last_seq || seq > prev.last_seq)) prev.last_seq = seq;
  state.threadIndex.set(key, prev);
}

export function renderTabs(dom, state, onSelectKey) {
  const tabs = dom.tabs;
  if (!tabs) return;
  const existing = new Map();
  try {
    const btns = tabs.querySelectorAll ? tabs.querySelectorAll("button.tab") : [];
    for (const b of btns) {
      const k = b && b.dataset ? String(b.dataset.key || "") : "";
      if (k) existing.set(k, b);
    }
  } catch (_) {}

  const items = Array.from(state.threadIndex.values()).sort((a, b) => {
    const sa = Number(a && a.last_seq) || 0;
    const sb = Number(b && b.last_seq) || 0;
    if (sa !== sb) return sb - sa;
    return String(b.last_ts || "").localeCompare(String(a.last_ts || ""));
  });

  const hidden = (state && state.hiddenThreads && typeof state.hiddenThreads.has === "function")
    ? state.hiddenThreads
    : loadHiddenThreads();
  const showHidden = !!(state && state.showHiddenThreads);
  const frag = document.createDocumentFragment();

  const allBtn = _getOrCreateTab(tabs, existing, "all", () => document.createElement("button"));
  allBtn.className = "tab" + (state.currentKey === "all" ? " active" : "");
  allBtn.textContent = "全部";
  allBtn.title = "全部";
  allBtn.onclick = () => onSelectKey("all");
  frag.appendChild(allBtn);

  for (const t of items) {
    const isHidden = !!(hidden && typeof hidden.has === "function" && hidden.has(t.key));
    if (isHidden && !showHidden) continue;
    const btn = _getOrCreateTab(tabs, existing, t.key, () => document.createElement("button"));
    btn.className = "tab" + (isHidden ? " tab-hidden" : "") + (state.currentKey === t.key ? " active" : "");
    const clr = colorForKey(t.key || "");
    const defaultLabel = threadLabel(t);
    const custom = getCustomLabel(t.key);
    const label = custom || defaultLabel;

    try { btn.style.borderColor = clr.border; } catch (_) {}
    const parts = _ensureTabStructure(btn);
    if (parts) {
      try { parts.dot.style.background = clr.fg; } catch (_) {}
      try { parts.labelSpan.textContent = label; } catch (_) {}
      try { parts.countEl.textContent = `(${t.count || 0})`; } catch (_) {}
    }

    const rename = () => {
      const cur = getCustomLabel(t.key);
      const next = prompt("设置会话标签（留空清除）：", cur || label);
      if (next === null) return;
      const v = String(next || "").trim();
      // If user sets it equal to the default label, treat as "no custom label".
      if (!v || v === defaultLabel) setCustomLabel(t.key, "");
      else setCustomLabel(t.key, v);
      renderTabs(dom, state, onSelectKey);
    };
    btn.oncontextmenu = (e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} rename(); };
    btn.ondblclick = (e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} rename(); };
    btn.title = t.thread_id || t.file || t.key;
    btn.onclick = () => onSelectKey(t.key);
    frag.appendChild(btn);
  }

  // Replace children by reusing existing nodes (stable event handlers; cheap reorder).
  try { tabs.replaceChildren(frag); } catch (_) {
    clearTabs(dom);
    tabs.appendChild(frag);
  }
}
