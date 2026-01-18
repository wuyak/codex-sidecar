export function renderMathInMd(root) {
  const el = root && root.nodeType === 1 ? root : null;
  if (!el) return;

  try {
    const ds = el.dataset || null;
    if (ds && ds.mathRendered === "1") return;
  } catch (_) {}

  let text = "";
  try { text = String(el.textContent || ""); } catch (_) { text = ""; }
  // Fast-path: no common math delimiters.
  if (!text || (!text.includes("$") && !text.includes("\\(") && !text.includes("\\["))) return;

  const fn = (typeof window !== "undefined") ? window.renderMathInElement : null;
  if (typeof fn !== "function") return;

  try {
    fn(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
      ],
      // KaTeX options
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "mathml",
    });
    try { el.dataset.mathRendered = "1"; } catch (_) {}
  } catch (_) {}
}

