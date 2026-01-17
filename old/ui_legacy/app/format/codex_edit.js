import { escapeHtml } from "../utils.js";
import { excerptLines, normalizeNonEmptyLines } from "./wrap.js";
import { renderDiffBlock } from "./diff.js";

export function isCodexEditSummary(text) {
  const s = String(text ?? "");
  return /(^|\n)•\s+(Edited|Added|Deleted|Created|Updated|Removed)\s+/m.test(s);
}

export function parseCodexEditSummary(text) {
  const lines = String(text ?? "").split("\n");
  const sections = [];
  let cur = null;
  const flush = () => { if (cur) sections.push(cur); cur = null; };
  for (const ln of lines) {
    const m = ln.match(/^•\s+(Edited|Added|Deleted|Created|Updated|Removed)\s+(.+?)\s*$/);
    if (m) {
      flush();
      cur = { action: m[1], path: m[2], stats: "", excerpt: [] };
      continue;
    }
    if (cur && !cur.stats && /^\(\+\d+\s+-\d+\)\s*$/.test(String(ln || "").trim())) {
      cur.stats = String(ln || "").trim();
      continue;
    }
    if (cur) cur.excerpt.push(ln);
  }
  flush();
  return sections;
}

export function actionZh(action) {
  const a = String(action || "");
  if (a === "Edited") return "修改";
  if (a === "Added" || a === "Created") return "新增";
  if (a === "Deleted" || a === "Removed") return "删除";
  if (a === "Updated") return "更新";
  return a;
}

export function joinWrappedExcerptLines(lines) {
  const xs = Array.isArray(lines) ? lines.map(x => String(x ?? "")) : [];
  const out = [];
  for (const ln of xs) {
    const t = String(ln ?? "");
    const isContinuation = /^\s{6,}\S/.test(t) && !/^\s*\d+\s/.test(t) && !/^\s*\(\+/.test(t) && !/^\s*•\s+/.test(t);
    if (isContinuation && out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]} ${t.trim()}`;
    } else {
      out.push(t);
    }
  }
  return out;
}

export function renderCodexEditSummary(text) {
  const sections = parseCodexEditSummary(text);
  if (!sections.length) return "";
  const blocks = [];
  for (const sec of sections) {
    const exJoined = joinWrappedExcerptLines(sec.excerpt);
    const exLines = normalizeNonEmptyLines(exJoined.join("\n"));
    const shown = excerptLines(exLines, 14).lines;
    const actionLabel = actionZh(sec.action);
    blocks.push(`
      <div class="tool-card">
        <div class="change-head">
          <span class="pill">${escapeHtml(actionLabel)}</span>
          <code>${escapeHtml(sec.path)}</code>
          ${sec.stats ? `<span class="meta">${escapeHtml(sec.stats)}</span>` : ``}
        </div>
        <pre class="code">${renderDiffBlock(shown)}</pre>
      </div>
    `);
  }
  return blocks.join("\n");
}

