import { keyOf } from "../utils.js";
import { applyMsgToList } from "./timeline.js";
import { bufferForKey, pushPending, shouldBufferKey } from "./buffer.js";

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
    if (state.ssePendingOverflow) {
      state.ssePendingOverflow = false;
      try { if (Array.isArray(state.ssePending)) state.ssePending.length = 0; } catch (_) {}
      try { Promise.resolve(refreshList()).catch(() => {}); } catch (_) {}
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
      // Clear manual translate in-flight state as soon as ZH arrives, so render can flip status immediately.
      try {
        if (op === "update" && msg && typeof msg.id === "string" && state && state.translateInFlight && typeof state.translateInFlight.delete === "function") {
          const hasZh = (typeof msg.zh === "string") && String(msg.zh || "").trim();
          const hasErr = (typeof msg.translate_error === "string") && String(msg.translate_error || "").trim();
          if (hasZh || hasErr) state.translateInFlight.delete(msg.id);
        }
      } catch (_) {}

      // Updates should not bump thread counts.
      if (op !== "update") upsertThread(state, msg);

      const k = keyOf(msg);
      const shouldRender = (state.currentKey === "all" || state.currentKey === k);
      if (shouldRender) {
        applyMsgToList(dom, state, msg, renderMessage);
        // 当前在 all 视图时，其他已缓存会话的视图仍需要“慢慢跟上”，否则切回会显示旧内容。
        if (state.currentKey === "all" && shouldBufferKey(state, k)) {
          bufferForKey(state, k, msg);
        }
      } else {
        // 仅为“已缓存的会话视图”缓冲，避免长时间挂着时对大量冷门 key 无限占用内存。
        if (shouldBufferKey(state, k)) bufferForKey(state, k, msg);
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
        try {
          state.threadsDirty = true;
          state.threadsLastSyncMs = 0;
        } catch (_) {}

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
        pushPending(state, msg);
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
