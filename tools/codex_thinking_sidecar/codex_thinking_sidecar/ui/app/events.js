import { keyOf } from "./utils.js";

export function connectEventStream(dom, state, upsertThread, renderTabs, renderMessage, setStatus) {
  state.uiEventSource = new EventSource("/events");
  state.uiEventSource.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      upsertThread(state, msg);
      const k = keyOf(msg);
      if (state.currentKey === "all" || state.currentKey === k) renderMessage(dom, state, msg);
      renderTabs(dom, state);
    } catch (e) {}
  });
  state.uiEventSource.addEventListener("error", () => {
    try { setStatus(dom, "连接已断开（可能已停止/退出）"); } catch (_) {}
  });
}

