import { colorForKey, keyOf, rolloutStampFromFile, shortId } from "../utils.js";
import { isOfflineKey } from "../offline.js";
import { removeOfflineShowByKey, saveOfflineShowList } from "../offline_show.js";
import { getCustomLabel, setCustomLabel } from "./labels.js";
import { loadHiddenThreads, saveHiddenThreads } from "./hidden.js";
import { saveClosedThreads } from "../closed_threads.js";
import { getUnreadCount, jumpToNextUnread } from "../unread.js";
import { flashToastAt } from "../utils/toast.js";

function _canHoverTip(e) {
  try {
    const pt = e && e.pointerType ? String(e.pointerType) : "";
    if (pt && pt !== "mouse") return false;
  } catch (_) {}
  try {
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return false;
  } catch (_) {}
  return true;
}

function _toastFromEl(el, text, opts = {}) {
  const msg = String(text || "").trim();
  if (!msg) return;
  const durationMs = Number.isFinite(Number(opts.durationMs)) ? Number(opts.durationMs) : 1300;
  try {
    const node = el && el.getBoundingClientRect ? el : null;
    const r = node ? node.getBoundingClientRect() : null;
    const x = r ? (r.left + r.width / 2) : (window.innerWidth / 2);
    const y = r ? (r.top + r.height / 2) : (window.innerHeight - 80);
    flashToastAt(x, y, msg, { isLight: true, durationMs });
  } catch (_) {}
}

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

function threadLabels(t, opts = {}) {
  const offline = isOfflineKey(String(t && t.key ? t.key : ""));
  const stampFull = rolloutStampFromFile(t.file || "");
  const stampShort = _stampShort(stampFull);
  const idPart = t.thread_id ? shortId(t.thread_id) : shortId(((t.file || "").split("/").slice(-1)[0]) || (t.key || ""));
  const full0 = (stampFull && idPart) ? `${stampFull} · ${idPart}` : (stampFull || idPart || "unknown");
  const label0 = (stampShort && idPart) ? `${stampShort} · ${idPart}` : (idPart || stampShort || stampFull || "unknown");
  const showOfflinePrefix = !Object.prototype.hasOwnProperty.call(opts || {}, "offlinePrefix") ? true : !!opts.offlinePrefix;
  const pre = (offline && showOfflinePrefix) ? "离线 · " : "";
  return { label: `${pre}${label0}`, full: `${pre}${full0}` };
}

function _pickFallbackKey(state, excludeKey = "") {
  const ex = String(excludeKey || "");
  const hidden = (state && state.hiddenThreads && typeof state.hiddenThreads.has === "function")
    ? state.hiddenThreads
    : loadHiddenThreads();
  const closed = (state && state.closedThreads && typeof state.closedThreads.has === "function")
    ? state.closedThreads
    : null;
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
    if (isOfflineKey(k)) continue;
    if (k === ex) continue;
    // Prefer parent sessions: keep subagent threads inside their parent UI.
    try {
      const pid = String((t && t.parent_thread_id) ? t.parent_thread_id : "").trim();
      const sk = String((t && t.source_kind) ? t.source_kind : "").trim().toLowerCase();
      if (pid && sk === "subagent" && state && state.threadIndex && typeof state.threadIndex.has === "function" && state.threadIndex.has(pid)) {
        continue;
      }
    } catch (_) {}
    if (hidden && typeof hidden.has === "function" && hidden.has(k)) continue;
    if (closed && typeof closed.has === "function" && closed.has(k)) continue;
    return k;
  }
  return "all";
}

let _bmHoverTipEl = null;

function _ensureBmHoverTipEl() {
  try {
    if (_bmHoverTipEl && document.body && document.body.contains(_bmHoverTipEl)) return _bmHoverTipEl;
  } catch (_) {}
  try {
    const el = document.createElement("div");
    el.className = "bm-hover-tip";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    _bmHoverTipEl = el;
    return el;
  } catch (_) {
    _bmHoverTipEl = null;
    return null;
  }
}

function _placeBmHoverTip(anchorEl) {
  const tip = _ensureBmHoverTipEl();
  if (!tip || !anchorEl || typeof anchorEl.getBoundingClientRect !== "function") return;
  try {
    const r = anchorEl.getBoundingClientRect();
    let x = r.left + r.width / 2;
    const y = r.top - 8;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    requestAnimationFrame(() => {
      try {
        const tr = tip.getBoundingClientRect();
        const half = tr.width / 2;
        const pad = 10;
        if (x - half < pad) x = pad + half;
        if (x + half > (window.innerWidth - pad)) x = window.innerWidth - pad - half;
        tip.style.left = `${x}px`;
      } catch (_) {}
    });
  } catch (_) {}
}

function _showBmHoverTip(anchorEl, text) {
  const tip = _ensureBmHoverTipEl();
  if (!tip) return;
  const msg = String(text || "").trim();
  if (!msg) return;
  try { tip.textContent = msg; } catch (_) {}
  try { tip.classList.add("show"); } catch (_) {}
  _placeBmHoverTip(anchorEl);
}

function _hideBmHoverTip() {
  const tip = _ensureBmHoverTipEl();
  if (!tip) return;
  try { tip.classList.remove("show"); } catch (_) {}
}

export function clearTabs(dom) {
  const host = dom.bookmarks;
  if (!host) return;
  try { _hideBmHoverTip(); } catch (_) {}
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

  const tipRename = "长按重命名";
  const tipClose = () => {
    const m = String(btn.dataset && btn.dataset.mode ? btn.dataset.mode : "").trim().toLowerCase();
    return (m === "offline") ? "移除展示" : "关闭监听";
  };

  let tipT = 0;
  const _clearTipTimer = () => {
    if (tipT) { try { clearTimeout(tipT); } catch (_) {} }
    tipT = 0;
  };
  const _scheduleTip = (anchorEl, text, delayMs = 260) => {
    _clearTipTimer();
    const d = Math.max(0, Number(delayMs) || 0);
    tipT = setTimeout(() => {
      tipT = 0;
      try { _showBmHoverTip(anchorEl || btn, text); } catch (_) {}
    }, d);
  };

  btn.addEventListener("pointerenter", (e) => {
    if (!_canHoverTip(e)) return;
    if (btn.classList && btn.classList.contains("editing")) return;
    _scheduleTip(btn, tipRename);
  });
  btn.addEventListener("pointerleave", (e) => {
    if (!_canHoverTip(e)) return;
    _clearTipTimer();
    _hideBmHoverTip();
  });

  try {
    const parts = _ensureBookmarkStructure(btn);
    const closeEl = parts && parts.closeSpan ? parts.closeSpan : null;
    if (closeEl && !closeEl.__bmTipWired) {
      closeEl.__bmTipWired = true;
      closeEl.addEventListener("pointerenter", (e) => {
        if (!_canHoverTip(e)) return;
        _scheduleTip(closeEl, tipClose(), 120);
      });
      closeEl.addEventListener("pointerleave", (e) => {
        if (!_canHoverTip(e)) return;
        _clearTipTimer();
        try {
          if (btn.matches && btn.matches(":hover")) _scheduleTip(btn, tipRename, 260);
          else _hideBmHoverTip();
        } catch (_) {
          _hideBmHoverTip();
        }
      });
    }
  } catch (_) {}

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
          // The close icon click often removes the bookmark immediately, so no pointerleave
          // will fire to clean up the hover tip. Hide it proactively to avoid stale tips.
          _clearTipTimer();
          _hideBmHoverTip();
          try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
          await onClose(t);
        }
        return;
      }
    } catch (_) {}
    if (longFired) { longFired = false; try { e.preventDefault(); e.stopPropagation(); } catch (_) {} return; }
    if (btn.classList && btn.classList.contains("editing")) return;
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    const onSelect = btn.__bmOnSelect;
    const onJump = btn.__bmOnJumpUnread;
    const rerender = btn.__bmRender;

    const hadUnread = !!(btn.classList && btn.classList.contains("has-unread"));
    const isActive = !!(btn.classList && btn.classList.contains("active"));

    // Same tab: click cycles through unread (earliest -> latest) instead of reselecting.
    if (hadUnread && isActive && typeof onJump === "function") {
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      const r = await onJump();
      if (r && r.ok) {
        if (typeof rerender === "function") rerender();
        return;
      }
      // Fallback: if jump fails, continue with normal select behavior.
    }

    if (typeof onSelect === "function" && k) await onSelect(k);

    // After selecting an unread tab, jump to the first unread once (user can click again to continue).
    if (hadUnread && typeof onJump === "function") {
      const r = await onJump();
      if (r && r.ok && typeof rerender === "function") rerender();
    }
  });

  btn.addEventListener("contextmenu", async (e) => {
    if (btn.classList && btn.classList.contains("editing")) return;
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    const onCtx = btn.__bmOnContext;
    if (typeof onCtx !== "function" || !k) return;
    try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
    try { await onCtx(k, btn); } catch (_) {}
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
      try { onDelete(btn); } catch (_) {}
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
  const kind = String(msg && msg.kind ? msg.kind : "");
  const isGate = kind === "tool_gate";

  // Keep stable identifiers: some events may omit fields; fill them in when available.
  try {
    const fp = String(msg && msg.file ? msg.file : "").trim();
    if (fp && (!prev.file || String(prev.file || "").trim() !== fp)) prev.file = fp;
  } catch (_) {}
  try {
    const tid = String(msg && msg.thread_id ? msg.thread_id : "").trim();
    if (tid && (!prev.thread_id || String(prev.thread_id || "").trim() !== tid)) prev.thread_id = tid;
  } catch (_) {}
  try {
    const sk = String(msg && msg.source_kind ? msg.source_kind : "").trim();
    if (sk && (!prev.source_kind || String(prev.source_kind || "").trim() !== sk)) prev.source_kind = sk;
  } catch (_) {}
  try {
    const pid = String(msg && msg.parent_thread_id ? msg.parent_thread_id : "").trim();
    if (pid && (!prev.parent_thread_id || String(prev.parent_thread_id || "").trim() !== pid)) prev.parent_thread_id = pid;
  } catch (_) {}
  try {
    const d = msg && msg.subagent_depth;
    if (Number.isFinite(Number(d))) prev.subagent_depth = Number(d);
  } catch (_) {}

  // Keep kinds for closed-thread baseline comparisons (avoid waking closed sessions on gate noise).
  try {
    if (!prev.kinds || typeof prev.kinds !== "object") prev.kinds = {};
    if (kind) prev.kinds[kind] = Number(prev.kinds[kind] || 0) + 1;
  } catch (_) {}

  // Thread ordering/count should be driven by meaningful dialog output; tool_gate is UI-only noise.
  if (!isGate) {
    prev.count = (prev.count || 0) + 1;
    const ts = msg.ts || "";
    if (ts && (!prev.last_ts || ts > prev.last_ts)) prev.last_ts = ts;
    const seq = Number.isFinite(Number(msg && msg.seq)) ? Number(msg.seq) : 0;
    if (seq && (!prev.last_seq || seq > prev.last_seq)) prev.last_seq = seq;
  }
  state.threadIndex.set(key, prev);
  try {
    // “清除对话”是临时 UI 行为：该会话有新输出后自动回到列表。
    const closed = (state && state.closedThreads && typeof state.closedThreads.get === "function") ? state.closedThreads : null;
    if (closed && closed.has(key)) {
      const info = closed.get(key) || {};
      const atSeq = Number(info.at_seq) || 0;
      const atCount = Number(info.at_count) || 0;
      const atTs = String(info.at_ts || "");
      const curSeq = Number(prev.last_seq) || 0;
      const curCount = Number(prev.count) || 0;
      const curTs = String(prev.last_ts || "");
      let hasNew = false;
      if (curSeq && curSeq > atSeq) hasNew = true;
      else if (curCount && curCount > atCount) hasNew = true;
      else if (curTs && atTs && curTs > atTs) hasNew = true;
      else {
        const atKinds = (info.at_kinds && typeof info.at_kinds === "object") ? info.at_kinds : {};
        const curKinds = (prev.kinds && typeof prev.kinds === "object") ? prev.kinds : {};
        hasNew = (Number(curKinds.assistant_message) || 0) > (Number(atKinds.assistant_message) || 0)
          || (Number(curKinds.user_message) || 0) > (Number(atKinds.user_message) || 0)
          || (Number(curKinds.reasoning_summary) || 0) > (Number(atKinds.reasoning_summary) || 0);
      }
      if (hasNew) {
        closed.delete(key);
        try { saveClosedThreads(closed); } catch (_) {}
      }
    }
  } catch (_) {}
}

export function renderTabs(dom, state, onSelectKey) {
  const hostLive = dom.bookmarks;
  const hostOffline = dom.offlineBookmarks;
  if (!hostLive) return;

  // Avoid breaking inline rename (focus loss) while SSE updates are streaming in.
  try {
    const editingLive = hostLive.querySelector ? hostLive.querySelector("button.bookmark.editing") : null;
    const editingOff = hostOffline && hostOffline.querySelector ? hostOffline.querySelector("button.bookmark.editing") : null;
    if (editingLive || editingOff) return;
  } catch (_) {}

  const _ensureRailHost = (host) => {
    if (!host) return null;
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
    return rail;
  };

  const railLive = _ensureRailHost(hostLive);
  const railOffline = hostOffline ? _ensureRailHost(hostOffline) : null;
  if (!railLive) return;

  // Tabs should keep a stable order (browser-like). Do not reorder by activity on every refresh.
  const itemsAll = Array.from(state.threadIndex.values());
  const currentKeyRaw = String(state.currentKey || "all");
  const hiddenForResolve = (state && state.hiddenThreads && typeof state.hiddenThreads.has === "function")
    ? state.hiddenThreads
    : loadHiddenThreads();
  const closedForResolve = (state && state.closedThreads && typeof state.closedThreads.has === "function")
    ? state.closedThreads
    : null;
  const _parentVisibleInTabs = (pid) => {
    const p = String(pid || "").trim();
    if (!p) return false;
    try {
      if (!(state && state.threadIndex && typeof state.threadIndex.has === "function" && state.threadIndex.has(p))) return false;
      if (hiddenForResolve && typeof hiddenForResolve.has === "function" && hiddenForResolve.has(p)) return false;
      if (closedForResolve && typeof closedForResolve.has === "function" && closedForResolve.has(p)) return false;
    } catch (_) {
      return false;
    }
    return true;
  };
  const _resolveTabKey = (k) => {
    const key = String(k || "");
    if (!key || key === "all") return key;
    try {
      const t = state && state.threadIndex && typeof state.threadIndex.get === "function" ? state.threadIndex.get(key) : null;
      const pid = String(t && t.parent_thread_id ? t.parent_thread_id : "").trim();
      const sk = String(t && t.source_kind ? t.source_kind : "").trim().toLowerCase();
      if (pid && sk === "subagent" && _parentVisibleInTabs(pid)) {
        return pid;
      }
    } catch (_) {}
    return key;
  };
  const currentTabKey = _resolveTabKey(currentKeyRaw);
  const _isChildThread = (t) => {
    try {
      const pid = String(t && t.parent_thread_id ? t.parent_thread_id : "").trim();
      const sk = String(t && t.source_kind ? t.source_kind : "").trim().toLowerCase();
      if (!pid || sk !== "subagent") return false;
      // If the parent thread is present, keep the child inside the parent UI.
      return _parentVisibleInTabs(pid);
    } catch (_) {
      return false;
    }
  };
  const items = itemsAll.filter((t) => {
    const k = String(t && t.key ? t.key : "");
    if (!k) return false;
    if (isOfflineKey(k)) return false;
    return !_isChildThread(t);
  });
  const offlineItems = Array.isArray(state && state.offlineShow) ? state.offlineShow : [];

  try {
    if (document && document.body && document.body.dataset) {
      if (offlineItems.length) document.body.dataset.offtabs = "1";
      else { try { delete document.body.dataset.offtabs; } catch (_) { document.body.dataset.offtabs = "0"; } }
    }
  } catch (_) {}

  const hidden = (state && state.hiddenThreads && typeof state.hiddenThreads.has === "function")
    ? state.hiddenThreads
    : loadHiddenThreads();
  const closed = (state && state.closedThreads && typeof state.closedThreads.has === "function")
    ? state.closedThreads
    : new Map();

  const host = hostLive;

  const _ensureHiddenSet = () => {
    if (!state.hiddenThreads || typeof state.hiddenThreads.add !== "function") state.hiddenThreads = new Set();
    return state.hiddenThreads;
  };

  const _hideKey = async (key, labelForToast = "", sourceEl = null) => {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const s = _ensureHiddenSet();
    if (s.has(k)) return;
    s.add(k);
    saveHiddenThreads(s);
    _toastFromEl(sourceEl || host, `已从列表移除：${labelForToast || shortId(k)}`, { durationMs: 1600 });
    if (String(currentTabKey || state.currentKey || "all") === k) await onSelectKey(_pickFallbackKey(state, k));
    else renderTabs(dom, state, onSelectKey);
  };

  const _toggleHiddenKey = async (key, labelForToast = "", sourceEl = null) => {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const s = _ensureHiddenSet();
    const was = s.has(k);
    if (was) s.delete(k);
    else s.add(k);
    saveHiddenThreads(s);
    _toastFromEl(
      sourceEl || host,
      was ? `已恢复：${labelForToast || shortId(k)}` : `已从列表移除：${labelForToast || shortId(k)}`,
      { durationMs: 1600 },
    );
    if (!was && String(currentTabKey || state.currentKey || "all") === k) await onSelectKey(_pickFallbackKey(state, k));
    else renderTabs(dom, state, onSelectKey);
  };

  const _closeKey = async (key, labelForToast = "", sourceEl = null) => {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const s = _ensureHiddenSet();
    if (s.has(k)) return;
    s.add(k);
    saveHiddenThreads(s);
    if (String(currentTabKey || state.currentKey || "all") === k) await onSelectKey(_pickFallbackKey(state, k));
    else renderTabs(dom, state, onSelectKey);
  };

  const renderList = (container, existing, opts) => {
    const mode = String(opts && opts.mode ? opts.mode : "");

    const currentKey = String(currentTabKey || "all");

    const _appendThread = (t) => {
      const isHidden = !!(hidden && typeof hidden.has === "function" && hidden.has(t.key));
      const u = getUnreadCount(state, t.key);
      const btn = _getOrCreateBookmark(container, existing, t.key, () => document.createElement("button"));
      btn.dataset.mode = mode || "live";
      const clr = colorForKey(t.key || "");
      const labels = threadLabels(t, { offlinePrefix: true });
      const defaultLabel = labels.label;
      const fullLabel = labels.full;
      const custom = getCustomLabel(t.key);
      const label = custom || defaultLabel;
      btn.className = "bookmark" + (isHidden ? " tab-hidden" : "") + (currentKey === t.key ? " active" : "") + (u > 0 ? " has-unread" : "");

      try {
        btn.style.setProperty("--bm-accent", clr.fg);
        btn.style.setProperty("--bm-border", clr.border);
      } catch (_) {}
      const parts = _ensureBookmarkStructure(btn);
      if (parts) {
        try { parts.labelSpan.textContent = label; } catch (_) {}
        try { parts.labelSpan.removeAttribute("title"); } catch (_) {}
        try { parts.closeSpan.removeAttribute("title"); } catch (_) {}
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
      try { btn.removeAttribute("title"); } catch (_) {}
      btn.__bmOnSelect = onSelectKey;
      btn.__bmOnContext = async (k, el) => { await _toggleHiddenKey(k, label, el || btn); };
      btn.__bmOnDelete = async (el) => { await _hideKey(t.key, label, el || btn); };
      btn.__bmOnClose = async (el) => { await _closeKey(t.key, label, el || btn); };
      btn.__bmOnJumpUnread = async () => {
        try { return jumpToNextUnread(dom, state, { key: t.key }); } catch (_) { return { ok: false, reason: "jump_failed" }; }
      };
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
    const btns = railLive && railLive.querySelectorAll ? railLive.querySelectorAll("button.bookmark") : [];
    for (const b of btns) {
      const k = b && b.dataset ? String(b.dataset.key || "") : "";
      if (k) existingRail.set(k, b);
    }
  } catch (_) {}

  const railFrag = renderList(railLive, existingRail, { mode: "live" });

  // Preserve horizontal scroll position to avoid “jumping” when SSE refreshes rerender the rail.
  let prevScrollLeft = 0;
  try { prevScrollLeft = railLive ? Number(railLive.scrollLeft) || 0 : 0; } catch (_) {}

  try { if (railLive) railLive.replaceChildren(railFrag); } catch (_) { try { while (railLive && railLive.firstChild) railLive.removeChild(railLive.firstChild); railLive && railLive.appendChild(railFrag); } catch (_) {} }

  try { if (railLive) railLive.scrollLeft = prevScrollLeft; } catch (_) {}

  // Subagent switcher (2nd-level tabs): keep child sessions grouped under their parent.
  const _renderSubagentTabs = () => {
    const host = dom && dom.subagentTabs ? dom.subagentTabs : null;
    if (!host) return;
    const ck = String(currentKeyRaw || "all");
    if (!ck || ck === "all" || isOfflineKey(ck)) {
      try { host.classList.add("hidden"); } catch (_) {}
      try { host.replaceChildren(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
      return;
    }

    const parentKey = String(currentTabKey || ck);
    if (!parentKey || parentKey === "all") {
      try { host.classList.add("hidden"); } catch (_) {}
      try { host.replaceChildren(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
      return;
    }

    const kids = [];
    try {
      for (const t of itemsAll) {
        const pid = String(t && t.parent_thread_id ? t.parent_thread_id : "").trim();
        const sk = String(t && t.source_kind ? t.source_kind : "").trim().toLowerCase();
        if (sk !== "subagent" || !pid) continue;
        if (pid !== parentKey) continue;
        kids.push(t);
      }
    } catch (_) {}

    if (!kids.length) {
      try { host.classList.add("hidden"); } catch (_) {}
      try { host.replaceChildren(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
      return;
    }

    kids.sort((a, b) => {
      const sa = rolloutStampFromFile((a && a.file) ? a.file : "");
      const sb = rolloutStampFromFile((b && b.file) ? b.file : "");
      if (sa !== sb) return String(sa || "").localeCompare(String(sb || ""));
      return String(a && a.key ? a.key : "").localeCompare(String(b && b.key ? b.key : ""));
    });

    try { host.classList.remove("hidden"); } catch (_) {}
    try { host.replaceChildren(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
    const frag = document.createDocumentFragment();

    const mkBtn = (label, sub, key, active) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "subtab" + (active ? " active" : "");
      btn.dataset.key = String(key || "");
      const t = document.createElement("span");
      t.textContent = String(label || "");
      btn.appendChild(t);
      const ss = String(sub || "").trim();
      if (ss) {
        const s = document.createElement("span");
        s.className = "subtab-sub";
        s.textContent = ss;
        btn.appendChild(s);
      }
      try { btn.removeAttribute("title"); } catch (_) {}
      try { btn.setAttribute("aria-label", `${label}${ss ? ` ${ss}` : ""}`.trim()); } catch (_) {}
      btn.addEventListener("click", () => { try { onSelectKey(String(key || "")); } catch (_) {} });
      return btn;
    };

    // Parent (main) tab.
    frag.appendChild(mkBtn("主", "", parentKey, ck === parentKey));

    for (let i = 0; i < kids.length; i++) {
      const t = kids[i];
      const label = `子${i + 1}`;
      const stampFull = rolloutStampFromFile((t && t.file) ? t.file : "");
      const stampShort = _stampShort(stampFull);
      frag.appendChild(mkBtn(label, stampShort, String(t && t.key ? t.key : ""), ck === String(t && t.key ? t.key : "")));
    }

    host.appendChild(frag);
  };
  try { _renderSubagentTabs(); } catch (_) {}

  // Offline “展示标签栏”：不进入 hiddenThreads，不产生未读；关闭=移除展示。
  if (!railOffline) return;

  const _removeOffline = async (key, labelForToast = "", sourceEl = null) => {
    const k = String(key || "").trim();
    if (!k) return;
    const next = removeOfflineShowByKey(state.offlineShow, k);
    try { state.offlineShow = next; } catch (_) {}
    try { saveOfflineShowList(next); } catch (_) {}

    const curKey = String(state.currentKey || "all");
    if (curKey === k) {
      let pick = "";
      try { pick = String(next && next[0] && next[0].key ? next[0].key : ""); } catch (_) { pick = ""; }
      if (!pick) pick = _pickFallbackKey(state, k);
      await onSelectKey(pick || "all");
      return;
    }
    renderTabs(dom, state, onSelectKey);
  };

  const existingOff = new Map();
  try {
    const btns = railOffline.querySelectorAll ? railOffline.querySelectorAll("button.bookmark") : [];
    for (const b of btns) {
      const k = b && b.dataset ? String(b.dataset.key || "") : "";
      if (k) existingOff.set(k, b);
    }
  } catch (_) {}

  const fragOff = document.createDocumentFragment();
  const currentKey = String(state.currentKey || "all");
  for (const it of offlineItems) {
    if (!it || typeof it !== "object") continue;
    const key = String(it.key || "").trim();
    const rel = String(it.rel || "").trim();
    if (!key) continue;

    const t = {
      key,
      thread_id: String(it.thread_id || "").trim(),
      file: String(it.file || "").trim() || rel,
    };

    const btn = _getOrCreateBookmark(railOffline, existingOff, key, () => document.createElement("button"));
    btn.dataset.mode = "offline";
    const clr = colorForKey(key);
    const labels = threadLabels(t, { offlinePrefix: false });
    const defaultLabel = labels.label;
    const custom = getCustomLabel(key);
    const label = custom || defaultLabel;
    btn.className = "bookmark" + (currentKey === key ? " active" : "");

    try {
      btn.style.setProperty("--bm-accent", clr.fg);
      btn.style.setProperty("--bm-border", clr.border);
    } catch (_) {}
    const parts = _ensureBookmarkStructure(btn);
    if (parts) {
      try { parts.labelSpan.textContent = label; } catch (_) {}
      try { parts.labelSpan.removeAttribute("title"); } catch (_) {}
      try { parts.closeSpan.removeAttribute("title"); } catch (_) {}
    }
    try {
      btn.dataset.label = label;
      btn.dataset.defaultLabel = defaultLabel;
    } catch (_) {}
    try { btn.setAttribute("aria-label", label); } catch (_) {}
    try { delete btn.dataset.unread; } catch (_) { btn.dataset.unread = ""; }
    try { btn.removeAttribute("title"); } catch (_) {}

    btn.__bmOnSelect = onSelectKey;
    btn.__bmOnContext = async (k, el) => { await _removeOffline(k, label, el || btn); };
    btn.__bmOnDelete = async (el) => { await _removeOffline(key, label, el || btn); };
    btn.__bmOnClose = async (el) => { await _removeOffline(key, label, el || btn); };
    btn.__bmOnJumpUnread = null;
    btn.__bmRender = () => renderTabs(dom, state, onSelectKey);
    _wireBookmarkInteractions(btn);
    fragOff.appendChild(btn);
  }

  let prevScrollLeftOff = 0;
  try { prevScrollLeftOff = Number(railOffline.scrollLeft) || 0; } catch (_) {}
  try { railOffline.replaceChildren(fragOff); } catch (_) { try { while (railOffline.firstChild) railOffline.removeChild(railOffline.firstChild); railOffline.appendChild(fragOff); } catch (_) {} }
  try { railOffline.scrollLeft = prevScrollLeftOff; } catch (_) {}
}
