export function buildThinkingMetaRight(opts = {}) {
  const mid = String(opts.mid || "").trim();
  const provider = String(opts.provider || "").trim().toLowerCase();
  const hasZh = !!opts.hasZh;
  const err = String(opts.err || "").trim();
  const translateMode = String(opts.translateMode || "").trim().toLowerCase();
  const inFlight = !!opts.inFlight;

  let statusText = "";
  if (inFlight) statusText = hasZh ? "ZH 重译中…" : "ZH 翻译中…";
  else if (err) {
    statusText = hasZh ? "ZH 已就绪（重译失败）" : "ZH 翻译失败（点重试）";
  } else if (hasZh) statusText = "ZH 已就绪";
  else if (translateMode === "manual") statusText = "ZH 待翻译（点击思考）";
  else statusText = "ZH 翻译中…";

  const pillHtml = `<span class="pill">${statusText}</span>`;

  let btnHtml = "";
  if (mid) {
    const tLabel = hasZh ? "重译" : (err ? "重试" : "翻译");
    const dis = inFlight ? " disabled" : "";
    btnHtml = `<button type="button" class="pill pill-btn think-translate" data-think-act="retranslate" data-mid="${mid}"${dis}>${tLabel}</button>`;
  }

  return `${pillHtml}${btnHtml}`;
}
