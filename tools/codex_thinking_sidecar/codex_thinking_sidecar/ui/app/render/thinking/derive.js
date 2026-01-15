import { cleanThinkingText } from "../../markdown.js";

export function deriveThinkingData(msgText, zhText, vis) {
  const showEn = !!(vis && vis.showEn);
  const showZh = !!(vis && vis.showZh);
  const enText = showEn ? cleanThinkingText(msgText || "") : "";

  const hasZh = !!String(zhText || "").trim();
  const zhClean = hasZh ? cleanThinkingText(zhText) : "";
  const hasZhClean = !!String(zhClean || "").trim();
  const waitingZh = !hasZhClean;

  const pills = [];
  if (showEn) pills.push(`<span class="pill">思考（EN）</span>`);
  if (showZh && hasZhClean) pills.push(`<span class="pill">思考（ZH）</span>`);
  else if (showZh && waitingZh) pills.push(`<span class="pill">思考（ZH…）</span>`);

  const metaRightExtra = (!showZh)
    ? (hasZhClean ? `<span class="pill">ZH 已就绪</span>` : `<span class="pill">ZH 翻译中</span>`)
    : "";

  const enHas = !!(showEn && String(enText || "").trim());

  return {
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

