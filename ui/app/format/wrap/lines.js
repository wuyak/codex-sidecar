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

