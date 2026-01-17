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
    if (state.threadIndex && typeof state.threadIndex.clear === "function") {
      state.threadIndex.clear();
      for (const [k, v] of next.entries()) state.threadIndex.set(k, v);
    }
    state.threadsLastSyncMs = Date.now();
    state.threadsDirty = false;
  } catch (_) {}
}

