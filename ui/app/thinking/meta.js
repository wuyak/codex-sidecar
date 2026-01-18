export function buildThinkingMetaRight(opts = {}) {
  const mid = String(opts.mid || "").trim();
  const provider = String(opts.provider || "").trim().toLowerCase();
  const hasZh = !!opts.hasZh;
  const err = String(opts.err || "").trim();
  const translateMode = String(opts.translateMode || "").trim().toLowerCase();
  const inFlight = !!opts.inFlight;

  let statusText = "";
  if (inFlight) statusText = hasZh ? "重译中…" : "翻译中…";
  else if (err) {
    statusText = hasZh ? "已翻译（重译失败）" : "翻译失败（点重试）";
  } else if (hasZh) statusText = "已翻译";
  else if (translateMode === "manual") statusText = "待翻译（点击思考）";
  else statusText = "翻译中…";

  const pillHtml = `<span class="pill">${statusText}</span>`;

  let btnHtml = "";
  if (mid) {
    const tLabel = hasZh ? "重译" : (err ? "重试" : "翻译");
    const dis = inFlight ? " disabled" : "";
    btnHtml = `<button type="button" class="pill pill-btn think-translate" data-think-act="retranslate" data-mid="${mid}"${dis}>${tLabel}</button>`;
  }

  return `${pillHtml}${btnHtml}`;
}
