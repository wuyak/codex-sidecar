import { cleanThinkingText } from "../../markdown.js";
import { escapeHtml } from "../../utils.js";

export function deriveThinkingData(msgText, zhText, vis) {
  const mid = String((vis && (vis.mid || vis.msgId)) ? (vis.mid || vis.msgId) : "");
  const provider = String((vis && vis.translatorProvider) ? vis.translatorProvider : "").trim().toLowerCase();

  const mode0 = String((vis && vis.mode) ? vis.mode : "").trim().toLowerCase();
  const mode = (mode0 === "en" || mode0 === "zh") ? mode0 : "en";
  const showEn = mode === "en";
  const showZh = mode === "zh";

  const enText = cleanThinkingText(msgText || "");

  const hasZh = !!String(zhText || "").trim();
  const zhClean = hasZh ? cleanThinkingText(zhText) : "";
  const hasZhClean = !!String(zhClean || "").trim();
  const err = String((vis && vis.translateError) ? vis.translateError : "").trim();
  const translateMode = String((vis && vis.translateMode) ? vis.translateMode : "").trim().toLowerCase();
  const inFlight = !!(vis && vis.inFlight);

  const pills = [];
  pills.push(`<span class="pill">思考</span>`);

  const stPills = [];
  let statusText = "";
  let statusTitle = "";
  if (provider === "none") statusText = "未启用翻译";
  else if (hasZhClean) statusText = "ZH 已就绪";
  else if (err) { statusText = "ZH 翻译失败（点重试）"; statusTitle = err; }
  else if (translateMode === "manual") statusText = (inFlight ? "ZH 翻译中…" : "ZH 待翻译（点击思考）");
  else statusText = "ZH 翻译中…";
  const titleAttr = statusTitle ? ` title="${escapeHtml(statusTitle)}"` : "";
  stPills.push(`<span class="pill"${titleAttr}>${statusText}</span>`);

  let trBtn = "";
  if (mid && provider !== "none") {
    const tLabel = hasZhClean ? "重译" : (err ? "重试" : "翻译");
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
