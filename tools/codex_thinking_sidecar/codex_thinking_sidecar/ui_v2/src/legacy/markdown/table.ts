import { escapeHtml } from "../utils/html";
import { renderInlineMarkdown } from "./inline";

export function splitTableRow(line: unknown): string[] {
  const raw = String(line ?? "");
  let s = raw.trim();
  if (!s) return [];
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  const cells: string[] = [];
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

export type TableAlign = "left" | "right" | "center";

export function parseTableAlign(cell: unknown): TableAlign | null {
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

export function isTableSeparatorLine(line: unknown): boolean {
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  for (const c of cells) {
    if (parseTableAlign(c) === null) return false;
  }
  return true;
}

export function renderTable(headerCells: unknown, alignments: unknown, bodyRows: unknown): string {
  const rows = Array.isArray(bodyRows) ? bodyRows : [];
  const h = Array.isArray(headerCells) ? headerCells : [];
  const a = Array.isArray(alignments) ? alignments : [];
  const colCount = Math.max(
    h.length,
    a.length,
    ...rows.map((r) => (Array.isArray(r) ? r.length : 0)),
  );
  const colAlign: TableAlign[] = [];
  for (let i = 0; i < colCount; i++) colAlign.push((a[i] as TableAlign) || "left");

  const ths: string[] = [];
  for (let i = 0; i < colCount; i++) {
    const text = String(h[i] ?? "");
    const align = colAlign[i];
    const style = align ? ` style="text-align:${escapeHtml(align)}"` : "";
    ths.push(`<th${style}>${renderInlineMarkdown(text)}</th>`);
  }
  const thead = `<thead><tr>${ths.join("")}</tr></thead>`;

  const trs: string[] = [];
  for (const r of rows) {
    const row = Array.isArray(r) ? r : [];
    const tds: string[] = [];
    for (let i = 0; i < colCount; i++) {
      const text = String(row[i] ?? "");
      const align = colAlign[i];
      const style = align ? ` style="text-align:${escapeHtml(align)}"` : "";
      tds.push(`<td${style}>${renderInlineMarkdown(text)}</td>`);
    }
    trs.push(`<tr>${tds.join("")}</tr>`);
  }
  const tbody = `<tbody>${trs.join("")}</tbody>`;

  return `<div class="md-table"><table>${thead}${tbody}</table></div>`;
}

