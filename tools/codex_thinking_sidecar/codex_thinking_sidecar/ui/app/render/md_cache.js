import { renderMarkdown } from "../markdown.js";

const _MD_CACHE_MAX = 3000;

export function renderMarkdownCached(state, cacheKey, text) {
  const src = String(text || "");
  const k = String(cacheKey || "");
  if (!k || !state || typeof state !== "object" || !state.mdCache || typeof state.mdCache.get !== "function") {
    return String(renderMarkdown(src) || "");
  }
  const cache = state.mdCache;
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
    cache.set(k, { text: src, html });
    while (cache.size > _MD_CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      if (firstKey === undefined) break;
      cache.delete(firstKey);
    }
  } catch (_) {}
  return html;
}

