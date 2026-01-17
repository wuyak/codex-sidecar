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

export function renderInlineMarkdown(text) {
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

