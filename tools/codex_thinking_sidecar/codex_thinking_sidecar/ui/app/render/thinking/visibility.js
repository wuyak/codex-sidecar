export function isThinkingKind(kind) {
  return kind === "reasoning_summary" || kind === "agent_reasoning";
}

export function getThinkingVisibility(dom) {
  const mode = (dom && dom.displayMode && dom.displayMode.value) ? dom.displayMode.value : "both";
  return {
    mode,
    showEn: mode !== "zh",
    showZh: mode !== "en",
  };
}

