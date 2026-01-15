import { applyMsgToList } from "./timeline.js";

const _SSE_BUFFER_MAX = 200;

export function shouldBufferKey(state, key) {
  const k = String(key || "");
  if (!k || k === "all") return false;
  const cache = state && state.viewCache;
  if (!cache || typeof cache.has !== "function") return false;
  return cache.has(k);
}

export function bufferForKey(state, key, msg) {
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

  // Coalesce op=update by id to avoid flooding buffers during slow translation backfill.
  try {
    const op = String((msg && msg.op) ? msg.op : "").trim().toLowerCase();
    const mid = (msg && typeof msg.id === "string") ? msg.id : "";
    if (op === "update" && mid) {
      for (let i = buf.length - 1; i >= 0; i--) {
        const prev = buf[i];
        if (!prev || typeof prev !== "object") continue;
        const pop = String((prev.op) ? prev.op : "").trim().toLowerCase();
        const pid = (typeof prev.id === "string") ? prev.id : "";
        if (pop === "update" && pid === mid) {
          buf[i] = msg;
          state.sseByKey.set(k, buf);
          return;
        }
      }
    }
  } catch (_) {}

  buf.push(msg);
  state.sseByKey.set(k, buf);
}

export function pushPending(state, msg) {
  if (!state || typeof state !== "object") return;
  if (!Array.isArray(state.ssePending)) state.ssePending = [];

  // During refreshList(), coalesce op=update by id (translation backfill may be bursty).
  try {
    const op = String((msg && msg.op) ? msg.op : "").trim().toLowerCase();
    const mid = (msg && typeof msg.id === "string") ? msg.id : "";
    if (op === "update" && mid) {
      const buf = state.ssePending;
      for (let i = buf.length - 1; i >= 0; i--) {
        const prev = buf[i];
        if (!prev || typeof prev !== "object") continue;
        const pop = String((prev.op) ? prev.op : "").trim().toLowerCase();
        const pid = (typeof prev.id === "string") ? prev.id : "";
        if (pop === "update" && pid === mid) {
          buf[i] = msg;
          return;
        }
      }
    }
  } catch (_) {}

  state.ssePending.push(msg);
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
    try { applyMsgToList(dom, state, msg, renderMessage); } catch (_) {}
  }
  try { renderTabs(dom, state); } catch (_) {}
  return { overflow: false, count: buf.length };
}

