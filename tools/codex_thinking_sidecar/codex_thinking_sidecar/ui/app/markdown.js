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

