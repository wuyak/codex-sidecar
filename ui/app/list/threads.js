import { pruneClosedThreads } from "../closed_threads.js";

export async function refreshThreads(state, signal) {
  if (!state || typeof state !== "object") return;
  try {
    const resp = await fetch("/api/threads", { signal, cache: "no-store" });
    const data = await resp.json();
    const threads = Array.isArray(data && data.threads) ? data.threads : [];
    const next = new Map();
    for (const t of threads) {
      const k = (t && typeof t.key === "string") ? t.key : "";
      if (k) next.set(k, t);
    }
    // Keep tab order stable: update existing entries in-place, append new keys, and only delete missing ones.
    if (state.threadIndex && typeof state.threadIndex.set === "function") {
      const cur = state.threadIndex;
      for (const [k, v] of next.entries()) {
        const prev = cur.get(k);
        if (prev && typeof prev === "object" && v && typeof v === "object") {
          const merged = { ...prev, ...v };
          if (prev.kinds && !v.kinds) merged.kinds = prev.kinds;
          cur.set(k, merged);
        } else {
          cur.set(k, v);
        }
      }
      for (const k of Array.from(cur.keys())) {
        if (!next.has(k)) cur.delete(k);
      }
    }
    try { pruneClosedThreads(state); } catch (_) {}
    state.threadsLastSyncMs = Date.now();
    state.threadsDirty = false;
  } catch (_) {}
}
