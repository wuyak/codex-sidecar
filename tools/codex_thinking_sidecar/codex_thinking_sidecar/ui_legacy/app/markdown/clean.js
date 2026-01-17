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
