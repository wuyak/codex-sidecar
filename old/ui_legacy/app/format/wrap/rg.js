function _countEscapedNewlines(s) {
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
      const n = _countEscapedNewlines(rest);
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

