import { colorForKey, keyOf, rolloutStampFromFile, shortId } from "../utils.js";
import { getCustomLabel, setCustomLabel } from "./labels.js";
import { loadHiddenThreads, saveHiddenThreads } from "./hidden.js";
import { getUnreadCount } from "../unread.js";
import { notifyCorner } from "../utils/notify.js";

function _parseStamp(stamp) {
  const s = String(stamp || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return { yyyy: m[1], mm: m[2], dd: m[3], HH: m[4], MM: m[5] };
}

function _stampShort(stamp) {
  const p = _parseStamp(stamp);
  if (p) return `${p.mm}-${p.dd} ${p.HH}:${p.MM}`;
  return String(stamp || "").trim();
}

function _baseName(p) {
  const s = String(p || "");
  if (!s) return "";
  const parts = s.split(/[\\/]/g);
  return parts[parts.length - 1] || s;
}

function threadLabels(t) {
  const stampFull = rolloutStampFromFile(t.file || "");
  const stampShort = _stampShort(stampFull);
  const idPart = t.thread_id ? shortId(t.thread_id) : shortId(((t.file || "").split("/").slice(-1)[0]) || (t.key || ""));
  const full = (stampFull && idPart) ? `${stampFull} · ${idPart}` : (stampFull || idPart || "unknown");
  const label = (stampShort && idPart) ? `${stampShort} · ${idPart}` : (idPart || stampShort || stampFull || "unknown");
  return { label, full };
}

function _pickFallbackKey(state, excludeKey = "") {
  const ex = String(excludeKey || "");
  const hidden = (state && state.hiddenThreads && typeof state.hiddenThreads.has === "function")
    ? state.hiddenThreads
    : loadHiddenThreads();
  const arr = Array.from((state && state.threadIndex && typeof state.threadIndex.values === "function") ? state.threadIndex.values() : []);
  arr.sort((a, b) => {
    const sa = Number(a && a.last_seq) || 0;
    const sb = Number(b && b.last_seq) || 0;
    if (sa !== sb) return sb - sa;
    return String(b && b.last_ts ? b.last_ts : "").localeCompare(String(a && a.last_ts ? a.last_ts : ""));
  });
  for (const t of arr) {
    const k = String((t && t.key) ? t.key : "");
    if (!k) continue;
    if (k === ex) continue;
    if (hidden && typeof hidden.has === "function" && hidden.has(k)) continue;
    return k;
  }
  return "all";
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
  const dotSpan = btn.querySelector ? btn.querySelector(".bm-dot") : null;
  const tipSpan = btn.querySelector ? btn.querySelector(".bm-tip") : null;
  const closeSpan = btn.querySelector ? btn.querySelector(".bm-close") : null;
  if (labelSpan && input && dotSpan && tipSpan && closeSpan) return { tipSpan, dotSpan, labelSpan, input, closeSpan };
  // (Re)build inner structure once; updates reuse these nodes.
  while (btn.firstChild) btn.removeChild(btn.firstChild);
  const tip = document.createElement("span");
  tip.className = "bm-tip";
  const dot = document.createElement("span");
  dot.className = "bm-dot";
  const l = document.createElement("span");
  l.className = "bm-label";
  const i = document.createElement("input");
  i.className = "bm-edit";
  i.type = "text";
  i.autocomplete = "off";
  i.spellcheck = false;
  i.placeholder = "重命名…";
  const c = document.createElement("span");
  c.className = "bm-close";
  c.textContent = "×";
  try { c.setAttribute("aria-hidden", "true"); } catch (_) {}
  btn.appendChild(tip);
  btn.appendChild(dot);
  btn.appendChild(l);
  btn.appendChild(i);
  btn.appendChild(c);
  return { tipSpan: tip, dotSpan: dot, labelSpan: l, input: i, closeSpan: c };
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
    try {
      const t = e && e.target;
      if (t && t.closest && t.closest(".bm-close")) { clearPress(); return; }
    } catch (_) {}
    clearPress();
    moved = false;
    longFired = false;
    startX = Number(e && e.clientX) || 0;
    startY = Number(e && e.clientY) || 0;
    startAt = Date.now();
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    const allowLongPressEdit = !!k && k !== "all";
    if (allowLongPressEdit) {
      pressT = setTimeout(() => {
        if (!startAt) return;
        if (moved) return;
        enterEdit();
      }, 420);
    }
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
    try {
      const t = e && e.target;
      if (t && t.closest && t.closest(".bm-close")) {
        const onClose = btn.__bmOnClose;
        if (typeof onClose === "function") {
          try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
          await onClose();
        }
        return;
      }
    } catch (_) {}
    if (longFired) { longFired = false; try { e.preventDefault(); e.stopPropagation(); } catch (_) {} return; }
    if (btn.classList && btn.classList.contains("editing")) return;
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    const onSelect = btn.__bmOnSelect;
    if (typeof onSelect === "function" && k) await onSelect(k);
  });

  btn.addEventListener("contextmenu", async (e) => {
    if (btn.classList && btn.classList.contains("editing")) return;
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    const onCtx = btn.__bmOnContext;
    if (typeof onCtx !== "function" || !k) return;
    try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
    try { await onCtx(k); } catch (_) {}
  });

  btn.addEventListener("keydown", (e) => {
    const key = String(e && e.key ? e.key : "");
    const editing = !!(btn.classList && btn.classList.contains("editing"));
    if (editing) {
      if (key === "Enter") { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} commitEdit(); }
      if (key === "Escape") { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} cancelEdit(); }
      return;
    }
    if (key === "Delete") {
      const onDelete = btn.__bmOnDelete;
      if (typeof onDelete !== "function") return;
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      try { onDelete(); } catch (_) {}
    }
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
  try {
    // “关闭标签”仅是临时 UI 行为：如果该会话有新输出，自动回到标签栏。
    const closed = (state && state.closedThreads && typeof state.closedThreads.get === "function") ? state.closedThreads : null;
    if (closed && closed.has(key)) {
      const info = closed.get(key) || {};
      const atSeq = Number(info.at_seq) || 0;
      const atCount = Number(info.at_count) || 0;
      const atTs = String(info.at_ts || "");
      const count = Number(prev && prev.count) || 0;
      const lastTs = String(prev && prev.last_ts ? prev.last_ts : "");
      const lastSeq = Number(prev && prev.last_seq) || 0;
      if ((lastSeq && lastSeq > atSeq) || count > atCount || (lastTs && atTs && lastTs > atTs)) closed.delete(key);
    }
  } catch (_) {}
}

export function renderTabs(dom, state, onSelectKey) {
  const host = dom.bookmarks;
  if (!host) return;

  // Avoid breaking inline rename (focus loss) while SSE updates are streaming in.
  try {
    const editingBtn = host.querySelector ? host.querySelector("button.bookmark.editing") : null;
    if (editingBtn) return;
  } catch (_) {}

  // Ensure rail container exists (host stays fixed at right).
  let rail = null;
  try {
    host.classList.add("bm-host");
    rail = host.querySelector ? host.querySelector(".bm-rail") : null;
    if (!rail) {
      rail = document.createElement("div");
      rail.className = "bm-rail";
      host.appendChild(rail);
    }
    // Back-compat cleanup: older versions had a separate popover list. If present, remove it.
    const pop = host.querySelector ? host.querySelector(".bm-pop") : null;
    if (pop && pop.parentNode === host) {
      try { host.removeChild(pop); } catch (_) {}
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
  const closed = (state && state.closedThreads && typeof state.closedThreads.has === "function")
    ? state.closedThreads
    : new Map();
  const fragRail = document.createDocumentFragment();
  const fragPop = document.createDocumentFragment();

  const _ensureHiddenSet = () => {
    if (!state.hiddenThreads || typeof state.hiddenThreads.add !== "function") state.hiddenThreads = new Set();
    return state.hiddenThreads;
  };

  const _hideKey = async (key, labelForToast = "") => {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const s = _ensureHiddenSet();
    if (s.has(k)) return;
    s.add(k);
    saveHiddenThreads(s);
    try { notifyCorner("bm_ctx", "会话列表", `已从列表移除：${labelForToast || shortId(k)}`, { ttlMs: 1600, level: "success" }); } catch (_) {}
    if (String(state.currentKey || "all") === k) await onSelectKey(_pickFallbackKey(state, k));
    else renderTabs(dom, state, onSelectKey);
  };

  const _toggleHiddenKey = async (key, labelForToast = "") => {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const s = _ensureHiddenSet();
    const was = s.has(k);
    if (was) s.delete(k);
    else s.add(k);
    saveHiddenThreads(s);
    try {
      notifyCorner(
        "bm_ctx",
        "会话列表",
        was ? `已恢复：${labelForToast || shortId(k)}` : `已从列表移除：${labelForToast || shortId(k)}`,
        { ttlMs: 1600, level: was ? "info" : "success" },
      );
    } catch (_) {}
    if (!was && String(state.currentKey || "all") === k) await onSelectKey(_pickFallbackKey(state, k));
    else renderTabs(dom, state, onSelectKey);
  };

  const _ensureClosedMap = () => {
    if (!state.closedThreads || typeof state.closedThreads.set !== "function") state.closedThreads = new Map();
    return state.closedThreads;
  };

  const _closeKey = async (key, labelForToast = "") => {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const t = state.threadIndex.get(k) || { last_seq: 0 };
    const atSeq = Number(t && t.last_seq) || 0;
    const m = _ensureClosedMap();
    m.set(k, {
      at_seq: atSeq,
      at_count: Number(t && t.count) || 0,
      at_ts: String((t && t.last_ts) ? t.last_ts : ""),
    });
    try { notifyCorner("bm_close", "会话标签", `已关闭标签：${labelForToast || shortId(k)}`, { ttlMs: 1400, level: "info" }); } catch (_) {}
    if (String(state.currentKey || "all") === k) await onSelectKey(_pickFallbackKey(state, k));
    else renderTabs(dom, state, onSelectKey);
  };

  const renderList = (container, existing, opts) => {
    const mode = String(opts && opts.mode ? opts.mode : "");

    const currentKey = String(state.currentKey || "all");

    const _appendThread = (t) => {
      const isHidden = !!(hidden && typeof hidden.has === "function" && hidden.has(t.key));
      const u = getUnreadCount(state, t.key);
      const btn = _getOrCreateBookmark(container, existing, t.key, () => document.createElement("button"));
      btn.className = "bookmark" + (isHidden ? " tab-hidden" : "") + (currentKey === t.key ? " active" : "") + (u > 0 ? " has-unread" : "");
      btn.dataset.mode = mode;
      const clr = colorForKey(t.key || "");
      const labels = threadLabels(t);
      const defaultLabel = labels.label;
      const fullLabel = labels.full;
      const custom = getCustomLabel(t.key);
      const label = custom || defaultLabel;

      try {
        btn.style.setProperty("--bm-accent", clr.fg);
        btn.style.setProperty("--bm-border", clr.border);
      } catch (_) {}
      const parts = _ensureBookmarkStructure(btn);
      if (parts) {
        try { parts.tipSpan.textContent = label; } catch (_) {}
        try { parts.labelSpan.textContent = label; } catch (_) {}
        try { parts.closeSpan.title = "关闭标签（该会话有新输出时会自动回到列表）"; } catch (_) {}
      }
      try {
        btn.dataset.label = label;
        btn.dataset.defaultLabel = defaultLabel;
      } catch (_) {}
      try { btn.setAttribute("aria-label", label); } catch (_) {}
      try {
        if (u > 0) btn.dataset.unread = u > 99 ? "99+" : String(u);
        else { try { delete btn.dataset.unread; } catch (_) { btn.dataset.unread = ""; } }
      } catch (_) {}
      try {
        const fileBase = _baseName(t.file || "");
        btn.title = `${label}${fileBase ? `\n${fileBase}` : ""}\n长按：重命名`;
      } catch (_) {}
      btn.__bmOnSelect = onSelectKey;
      btn.__bmOnContext = async (k) => { await _toggleHiddenKey(k, label); };
      btn.__bmOnDelete = async () => { await _hideKey(t.key, label); };
      btn.__bmOnClose = async () => { await _closeKey(t.key, label); };
      btn.__bmRender = () => renderTabs(dom, state, onSelectKey);
      _wireBookmarkInteractions(btn);
      return btn;
    };

    const out = document.createDocumentFragment();
    const list = items.filter((t) => {
      const isHidden = !!(hidden && typeof hidden.has === "function" && hidden.has(t.key));
      const isClosed = !!(closed && typeof closed.has === "function" && closed.has(t.key));
      if (isClosed && currentKey !== t.key) return false;
      return !isHidden;
    });

    for (const t of list) out.appendChild(_appendThread(t));
    return out;
  };

  const existingRail = new Map();
  try {
    const btns = rail && rail.querySelectorAll ? rail.querySelectorAll("button.bookmark") : [];
    for (const b of btns) {
      const k = b && b.dataset ? String(b.dataset.key || "") : "";
      if (k) existingRail.set(k, b);
    }
  } catch (_) {}

  const railFrag = renderList(rail, existingRail, { mode: "rail" });

  try { if (rail) rail.replaceChildren(railFrag); } catch (_) { try { while (rail && rail.firstChild) rail.removeChild(rail.firstChild); rail && rail.appendChild(railFrag); } catch (_) {} }
}
