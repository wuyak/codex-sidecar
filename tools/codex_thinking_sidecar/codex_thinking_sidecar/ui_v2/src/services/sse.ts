import type { SidecarMessage } from "../api/types";

export type SseHandlers = {
  onOpen?: () => void;
  onError?: (err: Event) => void;
  onMessage?: (msg: SidecarMessage) => void;
  onBatch?: (msgs: SidecarMessage[]) => void;
  shouldBuffer?: () => boolean;
};

export function connectSse(handlers: SseHandlers): EventSource {
  const es = new EventSource(`/events?t=${Date.now()}`);
  let buf: SidecarMessage[] = [];
  let flushTimer = 0;
  let pollTimer = 0;

  const flush = () => {
    flushTimer = 0;
    if (!buf.length) return;
    try {
      if (handlers.shouldBuffer?.()) {
        // Keep polling until the refresh lock is released, otherwise the last batch
        // may get stuck if no new SSE message arrives afterwards.
        if (!pollTimer) {
          pollTimer = window.setTimeout(() => {
            pollTimer = 0;
            flush();
          }, 160);
        }
        return;
      }
    } catch (_) {}

    const batch = buf;
    buf = [];
    if (pollTimer) {
      try {
        clearTimeout(pollTimer);
      } catch (_) {}
      pollTimer = 0;
    }
    if (handlers.onBatch) {
      try {
        handlers.onBatch(batch);
      } catch (_) {}
      return;
    }
    for (const msg of batch) {
      try {
        handlers.onMessage?.(msg);
      } catch (_) {}
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = window.setTimeout(flush, 50);
  };

  es.addEventListener("open", () => {
    try {
      handlers.onOpen?.();
    } catch (_) {}
    scheduleFlush();
  });
  es.addEventListener("error", (e) => {
    try {
      handlers.onError?.(e);
    } catch (_) {}
    scheduleFlush();
  });
  es.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(String((ev as MessageEvent).data || "{}")) as SidecarMessage;
      buf.push(msg);
      scheduleFlush();
    } catch (_) {}
  });
  return es;
}
