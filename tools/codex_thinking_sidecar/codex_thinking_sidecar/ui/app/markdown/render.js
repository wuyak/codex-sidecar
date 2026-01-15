import { escapeHtml } from "../utils.js";

function isCjkLikeChar(ch) {
  const c = String(ch ?? "");
  if (!c) return false;
  // CJK Unified Ideographs + extensions, Hiragana/Katakana, common punctuation block.
  return /[\u2E80-\u2EFF\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(c);
}

function isAsciiWordChar(ch) {
  const c = String(ch ?? "");
  if (!c) return false;
  return /[A-Za-z0-9]/.test(c);
}

function smartJoinParts(parts) {
  const xs = Array.isArray(parts) ? parts : [];
  let out = "";
  for (const raw of xs) {
    const piece = String(raw ?? "").trim();
    if (!piece) continue;
    if (!out) { out = piece; continue; }
    const a = out.slice(-1);
    const b = piece.slice(0, 1);
    let sep = " ";
    // Avoid introducing spaces inside CJK words when lines are terminal-wrapped mid-character.
    if (isCjkLikeChar(a) && isCjkLikeChar(b)) sep = "";
    // ASCII -> CJK: usually no space (e.g. "2个", "API接口").
    else if (isAsciiWordChar(a) && isCjkLikeChar(b)) sep = "";
    // CJK -> ASCII: prefer a space for readability (e.g. "模型 GPT").
    else if (isCjkLikeChar(a) && isAsciiWordChar(b)) sep = " ";
    out = (out + sep + piece).trim();
  }
  return out;
}

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
