import { cleanThinkingText } from "../../markdown.js";
import { buildThinkingMetaRight } from "../../thinking/meta.js";

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

  const metaRightExtra = buildThinkingMetaRight({ mid, provider, hasZh: hasZhClean, err, translateMode, inFlight });

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
