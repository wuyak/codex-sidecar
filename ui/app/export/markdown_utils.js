export function balanceFences(md) {
  const src = String(md ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!src) return "";
  const lines = src.split("\n");
  let open = "";
  for (const ln of lines) {
    const t = String(ln ?? "").trimEnd();
    const m = t.match(/^\s*(```+|~~~+)/);
    if (!m) continue;
    const fence = String(m[1] || "");
    if (!fence) continue;
    if (!open) {
      open = fence;
      continue;
    }
    // Only close when the fence char matches; other fences inside code blocks are just text.
    if (open[0] === fence[0] && fence.length >= open.length) open = "";
  }
  if (open) return `${src}\n${open}`;
  return src;
}

export function safeCodeFence(text, lang = "text") {
  const src = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!src) return "";
  let maxRun = 3;
  try {
    const runs = src.match(/`{3,}/g) || [];
    for (const r of runs) maxRun = Math.max(maxRun, String(r || "").length);
  } catch (_) {}
  const fence = "`".repeat(Math.max(4, maxRun + 1));
  const info = String(lang || "").trim();
  return `${fence}${info ? info : ""}\n${src}\n${fence}`;
}

function _unescapeHtml(text) {
  const s = String(text ?? "");
  // Order matters: decode &amp; first so "&amp;lt;" becomes "&lt;" then "<".
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export function convertKnownHtmlCodeBlocksToFences(md) {
  const src = String(md ?? "");
  if (!src || !src.includes("<pre")) return src;
  // Some environments may persist UI-rendered blocks (e.g. <pre class="code">...</pre>).
  // Export target is Markdown: convert back to fenced code blocks for portability.
  return src.replace(/<pre\s+class=(["'])code\1\s*>([\s\S]*?)<\/pre>/gi, (_m, _q, body) => {
    const raw = String(body ?? "").replace(/<br\s*\/?>/gi, "\n");
    const decoded = _unescapeHtml(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
    return safeCodeFence(decoded, "text");
  });
}
