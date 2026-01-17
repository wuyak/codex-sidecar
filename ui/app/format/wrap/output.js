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

