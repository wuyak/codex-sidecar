import { keyOf, tsToMs } from "./utils.js";

const _SSE_BUFFER_MAX = 200;

function _cmpKey(a, b) {
  const ta = a && a.ms;
  const tb = b && b.ms;
  const fa = Number.isFinite(ta);
  const fb = Number.isFinite(tb);
  if (fa && fb) {
    if (ta !== tb) return ta - tb;
  } else if (fa) return -1;
  else if (fb) return 1;

  const sa = a && a.seq;
  const sb = b && b.seq;
  const fsa = Number.isFinite(sa);
  const fsb = Number.isFinite(sb);
  if (fsa && fsb) {
    if (sa !== sb) return sa - sb;
  } else if (fsa) return -1;
  else if (fsb) return 1;

  const ia = String((a && a.id) ? a.id : "");
  const ib = String((b && b.id) ? b.id : "");
  return ia.localeCompare(ib);
}

function _findInsertIndex(timeline, item) {
  // Binary search: find first index where timeline[idx] > item.
  let lo = 0;
  let hi = timeline.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = _cmpKey(timeline[mid], item);
    if (c <= 0) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function _bufferForKey(state, key, msg) {
  if (!state || typeof state !== "object") return;
  const k = String(key || "");
  if (!k || k === "all") return;

  if (!state.sseByKey || typeof state.sseByKey.get !== "function") state.sseByKey = new Map();
  if (!state.sseOverflow || typeof state.sseOverflow.has !== "function") state.sseOverflow = new Set();
  if (state.sseOverflow.has(k)) return;

  let buf = state.sseByKey.get(k);
  if (!Array.isArray(buf)) buf = [];
  if (buf.length >= _SSE_BUFFER_MAX) {
    state.sseOverflow.add(k);
    state.sseByKey.delete(k);
    return;
  }
  buf.push(msg);
  state.sseByKey.set(k, buf);
}

function _shouldBufferKey(state, key) {
  const k = String(key || "");
  if (!k || k === "all") return false;
  const cache = state && state.viewCache;
  if (!cache || typeof cache.has !== "function") return false;
  return cache.has(k);
}

function _applyMsgToList(dom, state, msg, renderMessage) {
  const op = String((msg && msg.op) ? msg.op : "").trim().toLowerCase();
  const mid = (msg && typeof msg.id === "string") ? msg.id : "";

  if (op === "update" && mid && state.rowIndex && state.rowIndex.has(mid)) {
    const oldRow = state.rowIndex.get(mid);
    renderMessage(dom, state, msg, { patchEl: oldRow });
    return;
  }
  if (op === "update") return;

  // Keep a strict ordering invariant: insert by (timestamp, seq) instead of append+refresh.
  if (!state.timeline || !Array.isArray(state.timeline)) state.timeline = [];
  const ms = tsToMs(msg && msg.ts);
  const seq = Number.isFinite(Number(msg && msg.seq)) ? Number(msg.seq) : NaN;
  const item = { id: mid, ms, seq };
  if (mid && state.rowIndex && state.rowIndex.has(mid)) {
    const oldRow = state.rowIndex.get(mid);
    renderMessage(dom, state, msg, { patchEl: oldRow });
  } else {
    const idx = _findInsertIndex(state.timeline, item);
    let beforeEl = null;
    if (idx < state.timeline.length) {
      const beforeId = state.timeline[idx] && state.timeline[idx].id;
      beforeEl = (beforeId && state.rowIndex) ? state.rowIndex.get(beforeId) : null;
    }
    renderMessage(dom, state, msg, { insertBefore: beforeEl });
    if (mid && state.rowIndex && state.rowIndex.has(mid)) state.timeline.splice(idx, 0, item);
  }
  if (Number.isFinite(ms)) state.lastRenderedMs = Math.max(Number(state.lastRenderedMs) || 0, ms);
}

export function drainBufferedForKey(dom, state, key, renderMessage, renderTabs) {
  const k = String(key || "");
  if (!k || k === "all") return { overflow: true, count: 0 };
  if (!state || typeof state !== "object") return { overflow: true, count: 0 };

  try {
    if (state.sseOverflow && typeof state.sseOverflow.has === "function" && state.sseOverflow.has(k)) {
      return { overflow: true, count: 0 };
    }
  } catch (_) {}

  const buf = (state.sseByKey && typeof state.sseByKey.get === "function") ? state.sseByKey.get(k) : null;
  if (!Array.isArray(buf) || buf.length === 0) return { overflow: false, count: 0 };

  try { state.sseByKey.delete(k); } catch (_) {}

  for (const msg of buf) {
    try { _applyMsgToList(dom, state, msg, renderMessage); } catch (_) {}
  }
  try { renderTabs(dom, state); } catch (_) {}
  return { overflow: false, count: buf.length };
}

export function connectEventStream(dom, state, upsertThread, renderTabs, renderMessage, setStatus, refreshList) {
  state.uiEventSource = new EventSource("/events");

  let _tabsTimer = 0;
  let _tabsDirty = false;
  function _scheduleTabs(delayMs = 80) {
    if (!state || typeof state !== "object") return;
    _tabsDirty = true;
    const delay = (state.isRefreshing && Number.isFinite(Number(delayMs)))
      ? Math.max(Number(delayMs) || 0, 160)
      : (Number(delayMs) || 0);
    if (_tabsTimer) return;
    _tabsTimer = setTimeout(() => {
      _tabsTimer = 0;
      if (!_tabsDirty) return;
      _tabsDirty = false;
      try { renderTabs(dom, state); } catch (_) {}
    }, delay);
  }

  function _scheduleFlush(delayMs = 0) {
    if (!state || typeof state !== "object") return;
    if (state.sseFlushTimer) return;
    state.sseFlushTimer = setTimeout(() => {
      state.sseFlushTimer = 0;
      _flushPending();
    }, delayMs);
  }

  function _flushPending() {
    if (!state || typeof state !== "object") return;
    if (state.isRefreshing) {
      _scheduleFlush(50);
      return;
    }
    const pending = Array.isArray(state.ssePending) ? state.ssePending.splice(0) : [];
    if (!pending.length) return;
    for (const msg of pending) _handleMsg(msg);
    if (state.ssePending && state.ssePending.length) _scheduleFlush(0);
  }

  function _handleMsg(msg) {
    try {
      const op = String((msg && msg.op) ? msg.op : "").trim().toLowerCase();

      // Updates should not bump thread counts.
      if (op !== "update") upsertThread(state, msg);

      const k = keyOf(msg);
      const shouldRender = (state.currentKey === "all" || state.currentKey === k);
      if (shouldRender) {
        _applyMsgToList(dom, state, msg, renderMessage);
        // 当前在 all 视图时，其他已缓存会话的视图仍需要“慢慢跟上”，否则切回会显示旧内容。
        if (state.currentKey === "all" && _shouldBufferKey(state, k)) {
          _bufferForKey(state, k, msg);
        }
      } else {
        // 仅为“已缓存的会话视图”缓冲，避免长时间挂着时对大量冷门 key 无限占用内存。
        if (_shouldBufferKey(state, k)) _bufferForKey(state, k, msg);
      }
      // 译文回填（op=update）不影响会话计数/排序，避免每条 update 都重绘侧栏。
      if (op !== "update") _scheduleTabs(80);
    } catch (e) {}
  }

  state.uiEventSource.addEventListener("open", () => {
    try {
      const ever = !!(state && state.sseEverOpen);
      state.sseEverOpen = true;
      const hadError = !!(state && state.sseHadError);
      state.sseHadError = false;

      // Only resync after a real disconnect/reconnect (avoid double-refresh on initial connect).
      if (ever && hadError) {
        try { setStatus(dom, "连接已恢复，正在同步…"); } catch (_) {}

        // Mark cached views as overflow so switching will refresh from source.
        try {
          if (state.viewCache && typeof state.viewCache.keys === "function") {
            if (!state.sseOverflow || typeof state.sseOverflow.add !== "function") state.sseOverflow = new Set();
            for (const k of state.viewCache.keys()) {
              if (k && k !== "all") state.sseOverflow.add(k);
            }
          }
        } catch (_) {}
        // Drop buffered SSE during reconnect; we'll resync from source.
        try { if (state.sseByKey && typeof state.sseByKey.clear === "function") state.sseByKey.clear(); } catch (_) {}

        try { Promise.resolve(refreshList()).catch(() => {}); } catch (_) {}
      }
    } catch (_) {}
  });

  state.uiEventSource.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (state && typeof state === "object" && state.isRefreshing) {
        if (!Array.isArray(state.ssePending)) state.ssePending = [];
        state.ssePending.push(msg);
        _scheduleFlush(50);
        return;
      }
      _handleMsg(msg);
    } catch (e) {}
  });
  state.uiEventSource.addEventListener("error", () => {
    try {
      if (state && typeof state === "object") {
        if (state.sseHadError) return;
        state.sseHadError = true;
      }
      try { setStatus(dom, "连接已断开，等待自动重连…"); } catch (_) {}
    } catch (_) {}
  });
}
