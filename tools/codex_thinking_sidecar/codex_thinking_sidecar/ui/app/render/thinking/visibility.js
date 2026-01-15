export function isThinkingKind(kind) {
  return kind === "reasoning_summary" || kind === "agent_reasoning";
}

function _sanitizeMode(mode) {
  const m = String(mode || "").trim().toLowerCase();
  return (m === "en" || m === "zh" || m === "both") ? m : "both";
}

export function getThinkingVisibility(dom, state, mid) {
  const global = (dom && dom.displayMode && dom.displayMode.value) ? dom.displayMode.value : "both";
  let mode = _sanitizeMode(global);
  try {
    const k = String(mid || "").trim();
    if (k && state && state.thinkModeById && typeof state.thinkModeById.get === "function") {
      const v = state.thinkModeById.get(k);
      if (v) mode = _sanitizeMode(v);
    }
  } catch (_) {}
  return {
    mode,
    showEn: mode !== "zh",
    showZh: mode !== "en",
  };
}
