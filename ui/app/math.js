export function renderMathInMd(root) {
  const el = root && root.nodeType === 1 ? root : null;
  if (!el) return;

  let text = "";
  try { text = String(el.textContent || ""); } catch (_) { text = ""; }
  // Fast-path: no common math delimiters.
  //
  // Note:
  // - KaTeX auto-render supports `$...$`, but shell prompts also contain `$` and often appear twice
  //   in pasted terminal transcripts, which can accidentally match across newlines and "eat" spaces.
  // - To avoid breaking user input display, we only enable `$...$` when all `$` in the block look like
  //   "real inline math" pairs (same line + boundary checks). Otherwise `$` is treated as plain text.
  function _inlineDollarPolicy(src) {
    const s = String(src || "");
    if (!s.includes("$")) return { safe: false, unsafe: false };

    const isWs = (ch) => !!(ch && /\s/.test(ch));
    const isLeftBoundary = (ch) => (!ch) || isWs(ch) || /[([{<"'\u2018\u201c]/.test(ch);
    const isRightBoundary = (ch) => (!ch) || isWs(ch) || /[)\]}>,"'.!?:;\u2019\u201d]/.test(ch);

    const lines = s.split("\n");
    let safeFound = false;
    let unsafeFound = false;

    for (const lineRaw of lines) {
      const line = String(lineRaw || "");
      if (!line.includes("$")) continue;

      const safeDelims = new Set();

      // First pass: find "safe" `$...$` pairs in this line.
      let i = 0;
      while (i < line.length) {
        const open = line.indexOf("$", i);
        if (open < 0) break;
        i = open + 1;

        // Skip escaped \$ and $$ (display delimiter)
        if ((open > 0 && line[open - 1] === "\\") || line[open + 1] === "$") continue;

        const before = open > 0 ? line[open - 1] : "";
        const after = (open + 1) < line.length ? line[open + 1] : "";
        // `$` must be bounded and not followed by whitespace (avoid shell prompts like " $ cmd").
        if (!isLeftBoundary(before) || !after || isWs(after) || after === "$") continue;

        let j = open + 1;
        while (j < line.length) {
          const close = line.indexOf("$", j);
          if (close < 0) break;
          j = close + 1;

          // Skip escaped \$ and $$ (display delimiter)
          if ((close > 0 && line[close - 1] === "\\") || line[close + 1] === "$") continue;

          const beforeClose = close > 0 ? line[close - 1] : "";
          const afterClose = (close + 1) < line.length ? line[close + 1] : "";
          if (!beforeClose || isWs(beforeClose)) continue;
          if (!isRightBoundary(afterClose)) continue;

          const inner = line.slice(open + 1, close);
          // Keep inline `$...$` short; longer formulas should use `$$...$$` / `\\(...\\)`.
          if (!inner || inner.length > 160) continue;

          safeDelims.add(open);
          safeDelims.add(close);
          safeFound = true;
          break;
        }
      }

      // Second pass: if this line contains any "$" that isn't a safe delimiter, treat as unsafe.
      let k = 0;
      while (k < line.length) {
        const idx = line.indexOf("$", k);
        if (idx < 0) break;
        k = idx + 1;
        if (idx > 0 && line[idx - 1] === "\\") continue; // escaped \$
        if (line[idx + 1] === "$") { k = idx + 2; continue; } // $$ (display)
        if (!safeDelims.has(idx)) unsafeFound = true;
      }
    }

    return { safe: safeFound, unsafe: unsafeFound };
  }

  const hasDisplay = !!(text && text.includes("$$"));
  const hasParen = !!(text && (text.includes("\\(") || text.includes("\\[")));
  const pol = _inlineDollarPolicy(text);
  const enableInlineDollar = !!(pol.safe && !pol.unsafe);
  if (!hasDisplay && !hasParen && !enableInlineDollar) return;

  const fn = (typeof window !== "undefined") ? window.renderMathInElement : null;
  if (typeof fn !== "function") return;

  try {
    const ds = el.dataset || null;
    if (ds) {
      if (ds.mathRendered === "1" && ds.mathSource === text) return;
      ds.mathSource = text;
    }
  } catch (_) {}

  try {
    const delimiters = [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
    ];
    if (enableInlineDollar) delimiters.push({ left: "$", right: "$", display: false });

    fn(el, {
      delimiters,
      // KaTeX options
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "htmlAndMathml",
    });
    try { el.dataset.mathRendered = "1"; } catch (_) {}
  } catch (_) {}
}
