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

export function smartJoinParts(parts) {
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

function _renderTextSegment(seg) {
  let h = escapeHtml(seg);
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return h;
}

export function renderInlineMarkdown(text) {
  const raw = String(text ?? "");
  if (!raw) return "";
  const out = [];
  let i = 0;
  while (i < raw.length) {
    const open = raw.indexOf("`", i);
    if (open < 0) {
      out.push(_renderTextSegment(raw.slice(i)));
      break;
    }

    // Our inline parser only supports single-backtick code spans.
    // Treat runs like "``" or "```" as literal text to avoid swallowing the rest of the paragraph.
    if (raw[open + 1] === "`") {
      out.push(_renderTextSegment(raw.slice(i, open + 1)));
      i = open + 1;
      continue;
    }

    const close = raw.indexOf("`", open + 1);
    if (close < 0) {
      out.push(_renderTextSegment(raw.slice(i)));
      break;
    }

    out.push(_renderTextSegment(raw.slice(i, open)));
    out.push(`<code>${escapeHtml(raw.slice(open + 1, close))}</code>`);
    i = close + 1;
  }

  return out.join("");
}
