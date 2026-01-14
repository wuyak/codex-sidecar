import { keyOf, tsToMs } from "./utils.js";

export function connectEventStream(dom, state, upsertThread, renderTabs, renderMessage, setStatus, refreshList) {
  state.uiEventSource = new EventSource("/events");
  state.uiEventSource.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      upsertThread(state, msg);
      const k = keyOf(msg);
      const shouldRender = (state.currentKey === "all" || state.currentKey === k);
      if (shouldRender) {
        const ms = tsToMs(msg && msg.ts);
        const last = state.lastRenderedMs;
        // If an older timestamp arrives after newer ones, do a full refresh so ordering stays sane.
        // (This can happen if upstream补写/乱序落盘，或 watcher 重启回放造成的短暂乱序。)
        if (Number.isFinite(ms) && Number.isFinite(last) && ms + 1000 < last && typeof refreshList === "function") {
          refreshList();
        } else {
          renderMessage(dom, state, msg);
          if (Number.isFinite(ms)) state.lastRenderedMs = ms;
        }
      }
      renderTabs(dom, state);
    } catch (e) {}
  });
  state.uiEventSource.addEventListener("error", () => {
    try { setStatus(dom, "连接已断开（可能已停止/退出）"); } catch (_) {}
  });
}
