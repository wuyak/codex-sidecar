import { cleanThinkingText } from "../../markdown.js";

export function deriveThinkingData(msgText, zhText, vis) {
  const mid = String((vis && (vis.mid || vis.msgId)) ? (vis.mid || vis.msgId) : "");

  const mode0 = String((vis && vis.mode) ? vis.mode : "").trim().toLowerCase();
  const mode = (mode0 === "en" || mode0 === "zh") ? mode0 : "en";
  const showEn = mode === "en";
  const showZh = mode === "zh";

  const enText = cleanThinkingText(msgText || "");

  const hasZh = !!String(zhText || "").trim();
  const zhClean = hasZh ? cleanThinkingText(zhText) : "";
  const hasZhClean = !!String(zhClean || "").trim();
  const translateMode = String((vis && vis.translateMode) ? vis.translateMode : "").trim().toLowerCase();
  const inFlight = !!(vis && vis.inFlight);

  const pills = [];
  pills.push(`<span class="pill">思考</span>`);

  const stPills = [];
  if (hasZhClean) stPills.push(`<span class="pill">ZH 已就绪</span>`);
  else if (translateMode === "manual") stPills.push(`<span class="pill">${inFlight ? "ZH 翻译中…" : "ZH 待翻译（点击思考）"}</span>`);
  else stPills.push(`<span class="pill">ZH 翻译中…</span>`);

  let trBtn = "";
  if (mid) {
    const tLabel = hasZhClean ? "重译" : "翻译";
    const dis = inFlight ? " disabled" : "";
    trBtn = `<button type="button" class="pill pill-btn think-translate" data-think-act="retranslate" data-mid="${mid}" title="翻译/重新翻译这条思考"${dis}>${tLabel}</button>`;
  }
  const metaRightExtra = `${stPills.join("")}${trBtn}`;

  const enHas = !!(String(enText || "").trim());

  return {
    mode,
    showEn,
    showZh,
    enText,
    enHas,
    zhClean,
    hasZhClean,
    pills,
    metaRightExtra,
  };
}
