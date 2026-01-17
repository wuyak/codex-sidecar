function _isSkippableCmdLine(t) {
  const s = String(t || "").trim();
  if (!s) return true;
  if (s.startsWith("#!")) return true;
  if (s.startsWith("#")) return true;
  if (s.startsWith("set -")) return true; // 常见 bash prologue（如 set -euo pipefail）
  return false;
}

function _firstMeaningfulCmdLine(cmd) {
  const lines = String(cmd ?? "").split("\n");
  for (const ln of lines) {
    if (_isSkippableCmdLine(ln)) continue;
    const line = String(ln || "").trim();
    if (line) return line;
  }
  return String(cmd ?? "").split("\n")[0].trim();
}

export function summarizeCommand(cmd, maxLen = 96) {
  const line = _firstMeaningfulCmdLine(cmd);
  if (!line) return "";
  if (line.length <= maxLen) return line;
  return line.slice(0, Math.max(0, maxLen - 1)) + "…";
}

export function commandPreview(cmd, maxLen = 220) {
  const lines = String(cmd ?? "").split("\n");
  const kept = [];
  for (const ln of lines) {
    if (_isSkippableCmdLine(ln)) continue;
    kept.push(String(ln || "").trim());
  }
  if (kept.length === 0) return summarizeCommand(cmd, maxLen);
  let s = kept[0];
  if (kept.length > 1) s += ` (… +${kept.length - 1} 行)`;
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + "…";
}

export function wrapWords(text, width = 78) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const words = raw.split(/\s+/).filter(Boolean);
  const out = [];
  let line = "";
  const push = () => { if (line) out.push(line); line = ""; };
  for (const w of words) {
    if (w.length > width) {
      push();
      for (let i = 0; i < w.length; i += width) out.push(w.slice(i, i + width));
      continue;
    }
    if (!line) { line = w; continue; }
    if ((line + " " + w).length <= width) line += " ";
    else push();
    line += w;
  }
  push();
  return out;
}

export function wrapCommandForDisplay(cmdOne, width = 78) {
  const raw = String(cmdOne ?? "").trim();
  if (!raw) return [];
  const words = raw.split(/\s+/).filter(Boolean);
  const splitTokens = (xs, sep) => {
    const out = [];
    let cur = [];
    for (const w of xs) {
      if (w === sep) {
        if (cur.length) out.push(cur);
        cur = [w];
        continue;
      }
      cur.push(w);
    }
    if (cur.length) out.push(cur);
    return out;
  };

  // Prefer breaking at control operators/pipes for readability.
  let segs = [words];
  for (const sep of ["||", "&&", "|"]) {
    const next = [];
    for (const seg of segs) {
      if (seg.includes(sep)) next.push(...splitTokens(seg, sep));
      else next.push(seg);
    }
    segs = next;
  }

  const lines = [];
  for (const seg of segs) {
    const s = seg.join(" ").trim();
    if (!s) continue;
    const wrapped = wrapWords(s, width);
    for (const w of wrapped) lines.push(w);
  }
  if (lines.length) return lines;
  return wrapWords(raw, width);
}

