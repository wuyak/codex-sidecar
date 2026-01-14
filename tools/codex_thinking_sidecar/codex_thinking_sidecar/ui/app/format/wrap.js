export function summarizeCommand(cmd, maxLen = 96) {
  const lines = String(cmd ?? "").split("\n");
  const skip = (t) => {
    const s = String(t || "").trim();
    if (!s) return true;
    if (s.startsWith("#!")) return true;
    if (s.startsWith("#")) return true;
    if (s.startsWith("set -")) return true; // 常见 bash prologue（如 set -euo pipefail）
    return false;
  };
  let line = "";
  for (const ln of lines) {
    if (skip(ln)) continue;
    line = String(ln || "").trim();
    break;
  }
  if (!line) line = String(cmd ?? "").split("\n")[0].trim();
  if (!line) return "";
  if (line.length <= maxLen) return line;
  return line.slice(0, Math.max(0, maxLen - 1)) + "…";
}

export function commandPreview(cmd, maxLen = 220) {
  const lines = String(cmd ?? "").split("\n");
  const skip = (t) => {
    const s = String(t || "").trim();
    if (!s) return true;
    if (s.startsWith("#!")) return true;
    if (s.startsWith("#")) return true;
    if (s.startsWith("set -")) return true;
    return false;
  };
  const kept = [];
  for (const ln of lines) {
    if (skip(ln)) continue;
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
    if ((line + " " + w).length <= width) line += " " + w;
    else { push(); line = w; }
  }
  push();
  return out;
}

export function normalizeNonEmptyLines(s) {
  const lines = String(s ?? "").split("\n");
  // trim leading/trailing empties
  let a = 0;
  let b = lines.length;
  while (a < b && !String(lines[a] || "").trim()) a++;
  while (b > a && !String(lines[b - 1] || "").trim()) b--;
  const out = [];
  let blankRun = 0;
  for (const raw of lines.slice(a, b)) {
    const ln = String(raw ?? "").replace(/\s+$/g, "");
    if (!ln.trim()) {
      blankRun += 1;
      if (blankRun > 1) continue;
      out.push("");
      continue;
    }
    blankRun = 0;
    out.push(ln);
  }
  return out;
}

export function excerptLines(lines, maxLines = 6) {
  const xs = Array.isArray(lines) ? lines : [];
  if (xs.length <= maxLines) return { lines: xs, truncated: false };
  const head = xs.slice(0, 3);
  const tail = xs.slice(-3);
  return { lines: head.concat(["…（展开查看更多）"], tail), truncated: true };
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

export function wrapTreeContent(line, width = 74) {
  const raw = String(line ?? "");
  if (!raw) return [];
  if (raw.length <= width) return [raw];
  const out = [];
  let rest = raw;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut < 12) cut = width;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

export function normalizeTreeLine(line) {
  const s = String(line ?? "");
  // Reduce ugly indentation for typical `nl -ba` / line-numbered outputs.
  if (/^\s+\d+(\s|$)/.test(s)) return s.replace(/^\s+/, "");
  return s;
}

function countEscapedNewlines(s) {
  try {
    const m = String(s ?? "").match(/\n/g);
    return m ? m.length : 0;
  } catch (_) {
    return 0;
  }
}

export function formatRgOutput(lines, maxHits = 1) {
  const xs = Array.isArray(lines) ? lines : [];
  const out = [];
  let used = 0;
  for (const ln of xs) {
    if (used >= maxHits) break;
    const m = String(ln ?? "").match(/^(.+?):(\d+):(.*)$/);
    if (m && m[1] && String(m[1]).includes("/")) {
      const path = String(m[1] || "");
      const rest = String(m[3] || "");
      const parts = path.split("/");
      const base = parts.pop() || path;
      const dir = (parts.join("/") + "/") || path;
      out.push(dir);
      out.push(`${base}:`);
      const n = countEscapedNewlines(rest);
      if (n > 0) out.push(`… +${n} lines`);
    } else {
      out.push(String(ln ?? ""));
    }
    used += 1;
  }
  const remaining = xs.length - used;
  if (remaining > 0) out.push(`… +${remaining} matches`);
  return out;
}

export function summarizeOutputLines(lines, maxLines = 6) {
  const xs = Array.isArray(lines) ? lines : [];
  const clipped = xs.map((ln) => {
    const s = String(ln ?? "");
    if (s.length <= 240) return s;
    return s.slice(0, 239) + "…";
  });
  if (clipped.length <= maxLines) return clipped;
  const head = clipped.slice(0, maxLines);
  const remaining = clipped.length - maxLines;
  return head.concat([`… +${remaining} lines`]);
}

export function firstMeaningfulLine(s) {
  const lines = String(s ?? "").split("\n");
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    if (t.startsWith("call_id=")) continue;
    return t;
  }
  return "";
}

