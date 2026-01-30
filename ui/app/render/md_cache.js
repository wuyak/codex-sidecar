import { renderMarkdown } from "../markdown.js";
import { escapeHtml } from "../utils.js";

const _MD_CACHE_MAX = 3000;
const _MD_PARSE_MAX_CHARS = 180_000;

export function renderMarkdownCached(state, cacheKey, text) {
  const src = String(text || "");
  // Guardrail: extremely large markdown blocks can freeze the browser if parsed synchronously.
  // Fall back to plain <pre> rendering to keep the UI responsive.
  if (src.length > _MD_PARSE_MAX_CHARS) {
    return `<pre class="md-raw">${escapeHtml(src)}</pre>`;
  }
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
