import { cleanThinkingText } from "../../markdown.js";

export function deriveThinkingData(msgText, zhText, vis) {
  const mid = String((vis && (vis.mid || vis.msgId)) ? (vis.mid || vis.msgId) : "");

  const mode0 = String((vis && vis.mode) ? vis.mode : "").trim().toLowerCase();
  const mode = (mode0 === "en" || mode0 === "zh" || mode0 === "both") ? mode0 : "both";
  const showEn = mode !== "zh";
  const showZh = mode !== "en";

  const enText = cleanThinkingText(msgText || "");

  const hasZh = !!String(zhText || "").trim();
  const zhClean = hasZh ? cleanThinkingText(zhText) : "";
  const hasZhClean = !!String(zhClean || "").trim();
  const waitingZh = showZh && !hasZhClean;

  const pills = [];

  // Mode pill (click to cycle per-row display: EN -> ZH -> 对照).
  let modeLabel = "思考";
  if (mode === "en") modeLabel = "思考（EN）";
  else if (mode === "zh") modeLabel = waitingZh ? "思考（ZH…）" : "思考（ZH）";
  else modeLabel = waitingZh ? "思考（对照…）" : "思考（对照）";

  if (mid) {
    pills.push(
      `<button type="button" class="pill pill-btn think-mode" data-think-act="cycle_mode" data-mid="${mid}" title="切换显示：EN → ZH → 对照">${modeLabel}</button>`,
    );
    const tLabel = hasZhClean ? "重译" : "翻译";
    pills.push(
      `<button type="button" class="pill pill-btn think-translate" data-think-act="retranslate" data-mid="${mid}" title="重新翻译这条思考">${tLabel}</button>`,
    );
  } else {
    pills.push(`<span class="pill">${modeLabel}</span>`);
  }

  const metaRightExtra = (!showZh)
    ? (hasZhClean ? `<span class="pill">ZH 已就绪</span>` : `<span class="pill">ZH 翻译中</span>`)
    : "";

  const enHas = !!(showEn && String(enText || "").trim());

  return {
    mode,
    showEn,
    showZh,
    enText,
    enHas,
    zhClean,
    hasZhClean,
    waitingZh,
    pills,
    metaRightExtra,
  };
}
