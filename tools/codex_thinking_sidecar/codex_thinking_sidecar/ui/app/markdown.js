import { escapeHtml } from "./utils.js";

function renderInlineMarkdown(text) {
  const raw = String(text ?? "");
  if (!raw) return "";
  const parts = raw.split("`");
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i] ?? "";
    if ((i % 2) === 1) {
      out.push(`<code>${escapeHtml(seg)}</code>`);
    } else {
      let h = escapeHtml(seg);
      h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
      out.push(h);
    }
  }
  return out.join("");
}

function splitTableRow(line) {
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

function parseTableAlign(cell) {
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

function isTableSeparatorLine(line) {
  const cells = splitTableRow(line);
  if (cells.length === 0) return false;
  for (const c of cells) {
    if (parseTableAlign(c) === null) return false;
  }
  return true;
}

function renderTable(headerCells, alignments, bodyRows) {
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
    const text = para.join(" ").replace(/\s+/g, " ").trim();
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
        list.items[list.items.length - 1] = (String(list.items[list.items.length - 1] || "") + " " + t.trim()).trim();
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

function looksLikeCodeLine(ln) {
  const t = String(ln ?? "").trim();
  if (!t) return false;
  if (/^(Added|Edited|Deleted|Created|Updated|Removed)\s+/.test(t)) return true;
  if (/^\d+\s*[+-]\s/.test(t)) return true; // e.g. "1 +import ..."
  if (/^\*\*\*\s+(Begin Patch|Add File|Update File|Delete File):\s+/.test(t)) return true;
  if (/^diff --git\s+/.test(t)) return true;
  if (/^@@\s/.test(t) || t.startsWith("@@")) return true;
  if (/^[+-](?!\s)/.test(t)) return true; // "+foo" / "-bar" (avoid "- bullet")
  if (/^(import|from|export|function|const|let|var|class)\b/.test(t)) return true;
  if (/^(Traceback|Exception|Error:)\b/.test(t)) return true;
  return false;
}

export function splitLeadingCodeBlock(text) {
  const src = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!src.includes("\n")) return { code: "", rest: src };
  // 用户已显式用 fenced code block 时，保持原 Markdown。
  if (/^\s*```/m.test(src)) return { code: "", rest: src };

  const lines = src.split("\n");
  let matches = 0;
  let end = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i] ?? "");
    const t = raw.trimEnd();
    if (!t.trim()) { end = i + 1; continue; }
    if (looksLikeCodeLine(t)) { matches += 1; end = i + 1; continue; }
    // 确保不是误判：至少 3 行“代码/日志”才切分。
    if (matches >= 3) break;
    return { code: "", rest: src };
  }

  if (matches < 3) return { code: "", rest: src };
  const code = lines.slice(0, end).join("\n").trimEnd();
  const rest = lines.slice(end).join("\n").trim();
  return { code, rest };
}

export function cleanThinkingText(md) {
  const src = String(md ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = src.split("\n");
  const out = [];
  let inCode = false;
  let blankRun = 0;

  const isFence = (s) => /^\s*```/.test(String(s ?? "").trimEnd());

  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i] ?? "");
    const trimmedEnd = raw.replace(/\s+$/g, "");
    const t = trimmedEnd.trim();

    if (isFence(trimmedEnd)) {
      out.push(trimmedEnd);
      inCode = !inCode;
      blankRun = 0;
      continue;
    }

    if (inCode) {
      out.push(raw);
      continue;
    }

    // 删除仅包含 "_" 的噪音分隔行（避免破坏变量名/路径等正常下划线）。
    if (t && /^_+$/.test(t)) continue;

    // 修复类似 "……_" / "..._" 的孤立结尾下划线（多见于上游 Markdown 断行/翻译残留）。
    let ln = trimmedEnd.replace(/(……|…|\.{3})\s*_+(\s*)$/g, "$1$2");

    // 连续空行压缩为最多 1 行（代码块内不处理）。
    if (!ln.trim()) {
      blankRun++;
      if (blankRun > 1) continue;
      out.push("");
      continue;
    }
    blankRun = 0;
    out.push(ln);
  }
  return out.join("\n");
}
