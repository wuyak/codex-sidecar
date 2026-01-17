import { escapeHtml } from "../utils.js";
import { renderInlineMarkdown } from "./inline.js";

export function splitTableRow(line) {
  const raw = String(line ?? "");
  let s = raw.trim();
  if (!s) return [];
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && (i + 1) < s.length && s[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (ch === "|") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

export function parseTableAlign(cell) {
  const t = String(cell ?? "").trim().replace(/\s+/g, "");
  if (!t) return null;
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  const core = t.replace(/:/g, "");
  if (!/^-{3,}$/.test(core)) return null;
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

export function isTableSeparatorLine(line) {
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  for (const c of cells) {
    if (parseTableAlign(c) === null) return false;
  }
  return true;
}

export function renderTable(headerCells, alignments, bodyRows) {
  const rows = Array.isArray(bodyRows) ? bodyRows : [];
  const h = Array.isArray(headerCells) ? headerCells : [];
  const a = Array.isArray(alignments) ? alignments : [];
  const colCount = Math.max(
    h.length,
    a.length,
    ...rows.map(r => Array.isArray(r) ? r.length : 0),
  );
  const colAlign = [];
  for (let i = 0; i < colCount; i++) colAlign.push(a[i] || "left");

  const ths = [];
  for (let i = 0; i < colCount; i++) {
    const text = (h[i] ?? "");
    const align = colAlign[i];
    const style = align ? ` style="text-align:${escapeHtml(align)}"` : "";
    ths.push(`<th${style}>${renderInlineMarkdown(text)}</th>`);
  }
  const thead = `<thead><tr>${ths.join("")}</tr></thead>`;

  const trs = [];
  for (const r of rows) {
    const row = Array.isArray(r) ? r : [];
    const tds = [];
    for (let i = 0; i < colCount; i++) {
      const text = (row[i] ?? "");
      const align = colAlign[i];
      const style = align ? ` style="text-align:${escapeHtml(align)}"` : "";
      tds.push(`<td${style}>${renderInlineMarkdown(text)}</td>`);
    }
    trs.push(`<tr>${tds.join("")}</tr>`);
  }
  const tbody = `<tbody>${trs.join("")}</tbody>`;

  return `<div class="md-table"><table>${thead}${tbody}</table></div>`;
}

