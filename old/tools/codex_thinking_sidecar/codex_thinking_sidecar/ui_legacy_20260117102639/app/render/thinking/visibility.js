export function isThinkingKind(kind) {
  return kind === "reasoning_summary" || kind === "agent_reasoning";
}

function _sanitizeMode(mode) {
  const m = String(mode || "").trim().toLowerCase();
  return (m === "en" || m === "zh") ? m : "";
}

export function getThinkingVisibility(dom, state, mid, zhText) {
  const hasZh = !!String(zhText || "").trim();
  let mode = hasZh ? "zh" : "en";
  // Only apply per-row overrides when ZH exists; otherwise forcing mode=zh would hide EN and show an empty block.
  if (hasZh) {
    try {
      const k = String(mid || "").trim();
      if (k && state && state.thinkModeById && typeof state.thinkModeById.get === "function") {
        const v = state.thinkModeById.get(k);
        const vv = _sanitizeMode(v);
        if (vv) mode = vv;
      }
    } catch (_) {}
  }
  let translateMode = "auto";
  try {
    const v = String((state && state.translateMode) ? state.translateMode : "").trim().toLowerCase();
    if (v === "manual") translateMode = "manual";
  } catch (_) {}
  let inFlight = false;
  try {
    const k = String(mid || "").trim();
    inFlight = !!(k && state && state.translateInFlight && typeof state.translateInFlight.has === "function" && state.translateInFlight.has(k));
  } catch (_) {
    inFlight = false;
  }
  return {
    mode,
    showEn: mode !== "zh",
    showZh: mode !== "en",
    translateMode,
    inFlight,
  };
}
