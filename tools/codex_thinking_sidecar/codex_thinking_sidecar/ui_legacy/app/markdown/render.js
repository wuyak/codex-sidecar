import { escapeHtml } from "../utils.js";
import { renderInlineMarkdown, smartJoinParts } from "./inline.js";
import { isTableSeparatorLine, parseTableAlign, renderTable, splitTableRow } from "./table.js";

export function renderMarkdown(md) {
  const src = String(md ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = src.split("\n");
  const blocks = [];
  let inCode = false;
  let codeLines = [];
  let para = [];
  let list = null; // { type: "ul"|"ol", items: string[] }

  const flushPara = () => {
    if (!para.length) return;
    const text = smartJoinParts(para).replace(/\s+/g, " ").trim();
    para = [];
    if (!text) return;
    blocks.push(`<p>${renderInlineMarkdown(text)}</p>`);
  };

  const flushList = () => {
    if (!list || !Array.isArray(list.items) || list.items.length === 0) { list = null; return; }
    const tag = (list.type === "ol") ? "ol" : "ul";
    const lis = list.items.map((it) => `<li>${renderInlineMarkdown(it)}</li>`).join("");
    blocks.push(`<${tag}>${lis}</${tag}>`);
    list = null;
  };

  const flushCode = () => {
    const body = codeLines.join("\n").replace(/\n+$/g, "");
    codeLines = [];
    blocks.push(`<pre class="code">${escapeHtml(body)}</pre>`);
  };

  for (let i = 0; i < lines.length; i++) {
    const ln = String(lines[i] ?? "");
    const t = ln.trimEnd();

    const fence = t.match(/^\s*```/);
    if (fence) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushPara();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(ln);
      continue;
    }

    // Markdown table:
    // | a | b |
    // |---|---:|
    // | x | y |
    //
    // Or without outer pipes.
    if (t.includes("|") && (i + 1) < lines.length && isTableSeparatorLine(String(lines[i + 1] ?? ""))) {
      flushPara();
      flushList();
      const header = splitTableRow(t);
      const aligns = splitTableRow(String(lines[i + 1] ?? "")).map(parseTableAlign).filter(Boolean);
      const rows = [];
      i += 2;
      for (; i < lines.length; i++) {
        const rln = String(lines[i] ?? "");
        const rt = rln.trimEnd();
        if (!rt.trim()) break;
        if (!rt.includes("|")) break;
        if (isTableSeparatorLine(rt)) break;
        rows.push(splitTableRow(rt));
      }
      // step back one line so the outer loop can handle the first non-table line
      i -= 1;
      blocks.push(renderTable(header, aligns, rows));
      continue;
    }

    if (!t.trim()) {
      flushPara();
      flushList();
      continue;
    }

    // Separator line (common in terminal-style summaries, e.g. "────").
    // Keep the text (so copy works), but ensure it doesn't get merged into nearby paragraphs.
    if (/^\s*[-—–_─━]{3,}\s*$/.test(t)) {
      flushPara();
      flushList();
      blocks.push(`<p class="md-sep">${escapeHtml(t.trim())}</p>`);
      continue;
    }

    const bh = t.match(/^\s*\*\*([^*]+)\*\*\s*$/);
    if (bh) {
      flushPara();
      flushList();
      const text = String(bh[1] ?? "").trim();
      blocks.push(`<h3>${renderInlineMarkdown(text)}</h3>`);
      continue;
    }

    const h = t.match(/^\s*(#{1,3})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      const level = Math.min(3, Math.max(1, (h[1] || "").length));
      const text = String(h[2] ?? "").trim();
      blocks.push(`<h${level}>${renderInlineMarkdown(text)}</h${level}>`);
      continue;
    }

    const li = t.match(/^\s*(?:[-*]|[•◦])\s+(.*)$/);
    if (li) {
      flushPara();
      if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(String(li[1] ?? "").trim());
      continue;
    }

    const oli = t.match(/^\s*\d+[.)]\s+(.*)$/);
    if (oli) {
      flushPara();
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(String(oli[1] ?? "").trim());
      continue;
    }

    // Continuation lines for list items (common in terminal-wrapped bullets).
    // Example:
    // - foo bar baz +
    //   continued...
    if (list && Array.isArray(list.items) && list.items.length > 0) {
      const isIndented = /^\s{2,}\S/.test(ln);
      const isAnotherItem = /^\s*(?:[-*]|[•◦]|\d+[.)])\s+\S/.test(t);
      if (isIndented && !isAnotherItem) {
        const prev = String(list.items[list.items.length - 1] || "");
        const joined = smartJoinParts([prev, t.trim()]);
        list.items[list.items.length - 1] = joined.trim();
        continue;
      }
    }

    flushList();
    para.push(t.trim());
  }

  if (inCode) flushCode();
  flushPara();
  flushList();
  return blocks.join("\n");
}

