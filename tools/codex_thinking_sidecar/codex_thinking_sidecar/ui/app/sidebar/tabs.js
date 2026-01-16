import { colorForKey, keyOf, rolloutStampFromFile, shortId } from "../utils.js";
import { getCustomLabel, setCustomLabel } from "./labels.js";
import { loadHiddenThreads } from "./hidden.js";
import { getUnreadCount, getUnreadTotal } from "../unread.js";

function threadLabel(t) {
  const stamp = rolloutStampFromFile(t.file || "");
  const idPart = t.thread_id ? shortId(t.thread_id) : shortId(((t.file || "").split("/").slice(-1)[0]) || (t.key || ""));
  if (stamp && idPart) return `${stamp} · ${idPart}`;
  return idPart || stamp || "unknown";
}

export function clearTabs(dom) {
  const host = dom.bookmarks;
  if (!host) return;
  while (host.firstChild) host.removeChild(host.firstChild);
}

function _getOrCreateBookmark(host, existing, key, create) {
  const k = String(key || "");
  const prev = existing && typeof existing.get === "function" ? existing.get(k) : null;
  if (prev) return prev;
  const el = create();
  try { el.dataset.key = k; } catch (_) {}
  return el;
}

function _ensureBookmarkStructure(btn) {
  if (!btn) return null;
  const labelSpan = btn.querySelector ? btn.querySelector(".bm-label") : null;
  const input = btn.querySelector ? btn.querySelector(".bm-edit") : null;
  if (labelSpan && input) return { labelSpan, input };
  // (Re)build inner structure once; updates reuse these nodes.
  while (btn.firstChild) btn.removeChild(btn.firstChild);
  const l = document.createElement("span");
  l.className = "bm-label";
  const i = document.createElement("input");
  i.className = "bm-edit";
  i.type = "text";
  i.autocomplete = "off";
  i.spellcheck = false;
  i.placeholder = "重命名…";
  btn.appendChild(l);
  btn.appendChild(i);
  return { labelSpan: l, input: i };
}

function _wireBookmarkInteractions(btn) {
  if (!btn || btn.__bmWired) return;
  btn.__bmWired = true;

  let startX = 0;
  let startY = 0;
  let startAt = 0;
  let moved = false;
  let longFired = false;
  let pressT = 0;

  const clearPress = () => {
    if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
    pressT = 0;
    startAt = 0;
    moved = false;
  };

  const enterEdit = () => {
    longFired = true;
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    if (!k || k === "all") return;
    try { btn.classList.add("editing", "active"); } catch (_) {}
    const parts = _ensureBookmarkStructure(btn);
    if (!parts) return;
    const input = parts.input;
    const label = String((btn.dataset && btn.dataset.label) ? btn.dataset.label : "");
    const custom = getCustomLabel(k);
    const v = String(custom || label || "");
    try { input.value = v; } catch (_) {}
    try {
      setTimeout(() => {
        try { input.focus(); } catch (_) {}
        try { input.select(); } catch (_) {}
      }, 0);
    } catch (_) {}
  };

  const commitEdit = (keepFocus = false) => {
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    if (!k || k === "all") return;
    const parts = _ensureBookmarkStructure(btn);
    if (!parts) return;
    const input = parts.input;
    const raw = String(input.value || "");
    const v = raw.trim();
    const defaultLabel = String((btn.dataset && btn.dataset.defaultLabel) ? btn.dataset.defaultLabel : "");
    if (!v || (defaultLabel && v === defaultLabel)) setCustomLabel(k, "");
    else setCustomLabel(k, v);
    try { btn.classList.remove("editing"); } catch (_) {}
    if (!keepFocus) {
      try { input.blur(); } catch (_) {}
    }
    const rerender = btn.__bmRender;
    if (typeof rerender === "function") rerender();
  };

  const cancelEdit = () => {
    try { btn.classList.remove("editing"); } catch (_) {}
    const rerender = btn.__bmRender;
    if (typeof rerender === "function") rerender();
  };

  btn.addEventListener("pointerdown", (e) => {
    try {
      if (e && typeof e.button === "number" && e.button !== 0) return;
    } catch (_) {}
    clearPress();
    moved = false;
    longFired = false;
    startX = Number(e && e.clientX) || 0;
    startY = Number(e && e.clientY) || 0;
    startAt = Date.now();
    pressT = setTimeout(() => {
      if (!startAt) return;
      if (moved) return;
      enterEdit();
    }, 420);
  });

  btn.addEventListener("pointermove", (e) => {
    if (!startAt) return;
    const x = Number(e && e.clientX) || 0;
    const y = Number(e && e.clientY) || 0;
    const dx = x - startX;
    const dy = y - startY;
    if ((dx * dx + dy * dy) > (6 * 6)) {
      moved = true;
      if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
      pressT = 0;
    }
  });

  btn.addEventListener("pointerup", clearPress);
  btn.addEventListener("pointercancel", clearPress);
  btn.addEventListener("pointerleave", clearPress);

  btn.addEventListener("click", async (e) => {
    if (longFired) { longFired = false; try { e.preventDefault(); e.stopPropagation(); } catch (_) {} return; }
    if (btn.classList && btn.classList.contains("editing")) return;
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    const onSelect = btn.__bmOnSelect;
    if (typeof onSelect === "function" && k) await onSelect(k);
  });

  btn.addEventListener("keydown", (e) => {
    if (!btn.classList || !btn.classList.contains("editing")) return;
    const key = String(e && e.key ? e.key : "");
    if (key === "Enter") { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} commitEdit(); }
    if (key === "Escape") { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} cancelEdit(); }
  });

  btn.addEventListener("focusout", (e) => {
    try {
      if (!btn.classList || !btn.classList.contains("editing")) return;
      const rt = e && e.relatedTarget;
      if (rt && btn.contains && btn.contains(rt)) return;
      commitEdit(true);
    } catch (_) {}
  });
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
  const host = dom.bookmarks;
  if (!host) return;
  const existing = new Map();
  try {
    const btns = host.querySelectorAll ? host.querySelectorAll("button.bookmark") : [];
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
  const frag = document.createDocumentFragment();

  const totalUnread = getUnreadTotal(state);
  const allBtn = _getOrCreateBookmark(host, existing, "all", () => document.createElement("button"));
  allBtn.className = "bookmark" + (state.currentKey === "all" ? " active" : "") + (totalUnread > 0 ? " has-unread" : "");
  allBtn.style.setProperty("--bm-accent", "#111827");
  allBtn.style.setProperty("--bm-border", "rgba(148,163,184,.55)");
  const partsAll = _ensureBookmarkStructure(allBtn);
  if (partsAll) {
    try { partsAll.labelSpan.textContent = "全部"; } catch (_) {}
  }
  allBtn.__bmOnSelect = onSelectKey;
  allBtn.__bmRender = () => renderTabs(dom, state, onSelectKey);
  _wireBookmarkInteractions(allBtn);
  try {
    if (totalUnread > 0) allBtn.dataset.unread = totalUnread > 99 ? "99+" : String(totalUnread);
    else { try { delete allBtn.dataset.unread; } catch (_) { allBtn.dataset.unread = ""; } }
  } catch (_) {}
  frag.appendChild(allBtn);

  for (const t of items) {
    const isHidden = !!(hidden && typeof hidden.has === "function" && hidden.has(t.key));
    const btn = _getOrCreateBookmark(host, existing, t.key, () => document.createElement("button"));
    const u = getUnreadCount(state, t.key);
    btn.className = "bookmark" + (isHidden ? " tab-hidden" : "") + (state.currentKey === t.key ? " active" : "") + (u > 0 ? " has-unread" : "");
    const clr = colorForKey(t.key || "");
    const defaultLabel = threadLabel(t);
    const custom = getCustomLabel(t.key);
    const label = custom || defaultLabel;

    try {
      btn.style.setProperty("--bm-accent", clr.fg);
      btn.style.setProperty("--bm-border", clr.border);
    } catch (_) {}
    const parts = _ensureBookmarkStructure(btn);
    if (parts) {
      try { parts.labelSpan.textContent = label; } catch (_) {}
    }
    try {
      if (u > 0) btn.dataset.unread = u > 99 ? "99+" : String(u);
      else { try { delete btn.dataset.unread; } catch (_) { btn.dataset.unread = ""; } }
    } catch (_) {}
    try {
      btn.dataset.label = label;
      btn.dataset.defaultLabel = defaultLabel;
    } catch (_) {}
    btn.__bmOnSelect = onSelectKey;
    btn.__bmRender = () => renderTabs(dom, state, onSelectKey);
    _wireBookmarkInteractions(btn);
    frag.appendChild(btn);
  }

  // Replace children by reusing existing nodes (stable event handlers; cheap reorder).
  try { host.replaceChildren(frag); } catch (_) {
    clearTabs(dom);
    host.appendChild(frag);
  }
}
