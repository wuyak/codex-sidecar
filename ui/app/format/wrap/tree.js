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

