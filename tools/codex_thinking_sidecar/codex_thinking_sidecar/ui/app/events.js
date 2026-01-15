import { keyOf, tsToMs } from "./utils.js";

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

export function connectEventStream(dom, state, upsertThread, renderTabs, renderMessage, setStatus, refreshList) {
  state.uiEventSource = new EventSource("/events");

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
      const mid = (msg && typeof msg.id === "string") ? msg.id : "";

      // Updates should not bump thread counts.
      if (op !== "update") upsertThread(state, msg);

      const k = keyOf(msg);
      const shouldRender = (state.currentKey === "all" || state.currentKey === k);
      if (shouldRender) {
        if (op === "update" && mid && state.rowIndex && state.rowIndex.has(mid)) {
          const oldRow = state.rowIndex.get(mid);
          renderMessage(dom, state, msg, { patchEl: oldRow });
        } else if (op !== "update") {
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
      }
      renderTabs(dom, state);
    } catch (e) {}
  }

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
    try { setStatus(dom, "连接已断开（可能已停止/退出）"); } catch (_) {}
  });
}
