import { renderMarkdown } from "../markdown.js";

const _MD_CACHE_MAX = 3000;
// Cache budget by total characters (approximate; JS strings are UTF-16).
// This avoids unbounded memory growth when long-running sessions accumulate many rendered blocks.
const _MD_CACHE_MAX_CHARS = 4_000_000;
// Avoid caching very large blocks (still render them, but don't retain in mdCache).
const _MD_CACHE_ENTRY_MAX_CHARS = 200_000;

const _cacheStats = new WeakMap(); // Map -> { chars:number }

function _entryChars(e) {
  try {
    if (!e || typeof e !== "object") return 0;
    const n = Number(e.chars);
    if (Number.isFinite(n) && n >= 0) return n;
    const t = String(e.text || "");
    const h = String(e.html || "");
    return t.length + h.length;
  } catch (_) {
    return 0;
  }
}

function _statsFor(cache) {
  if (!cache || typeof cache !== "object") return { chars: 0 };
  let st = _cacheStats.get(cache);
  if (!st) {
    st = { chars: 0 };
    _cacheStats.set(cache, st);
  }
  return st;
}

export function renderMarkdownCached(state, cacheKey, text) {
  const src = String(text || "");
  const k = String(cacheKey || "");
  if (!k || !state || typeof state !== "object" || !state.mdCache || typeof state.mdCache.get !== "function") {
    return String(renderMarkdown(src) || "");
  }
  const cache = state.mdCache;
  const st = _statsFor(cache);
  try {
    const prev = cache.get(k);
    if (prev && typeof prev === "object" && prev.text === src && typeof prev.html === "string") {
      // bump LRU
      cache.delete(k);
      cache.set(k, prev);
      return prev.html;
    }
  } catch (_) {}
  const html = String(renderMarkdown(src) || "");
  try {
    const nextChars = src.length + html.length;
    // Do not cache huge entries (keeps display identical while avoiding memory spikes).
    if (nextChars <= _MD_CACHE_ENTRY_MAX_CHARS) {
      // If overwriting existing entry, adjust stats first.
      try {
        const old = cache.get(k);
        if (old && typeof old === "object") st.chars -= _entryChars(old);
      } catch (_) {}
      cache.set(k, { text: src, html, chars: nextChars });
      st.chars += nextChars;
    }

    // Evict by entry count and by total char budget (LRU = insertion order).
    while (cache.size > _MD_CACHE_MAX || st.chars > _MD_CACHE_MAX_CHARS) {
      const firstKey = cache.keys().next().value;
      if (firstKey === undefined) break;
      try {
        const victim = cache.get(firstKey);
        if (victim && typeof victim === "object") st.chars -= _entryChars(victim);
      } catch (_) {}
      cache.delete(firstKey);
    }
  } catch (_) {}
  return html;
}
