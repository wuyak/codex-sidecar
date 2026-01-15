import { escapeHtml } from "../utils.js";

export function buildThinkingMetaRight(opts = {}) {
  const mid = String(opts.mid || "").trim();
  const provider = String(opts.provider || "").trim().toLowerCase();
  const hasZh = !!opts.hasZh;
  const err = String(opts.err || "").trim();
  const translateMode = String(opts.translateMode || "").trim().toLowerCase();
  const inFlight = !!opts.inFlight;

  let statusText = "";
  let statusTitle = "";
  if (provider === "none") statusText = "未启用翻译";
  else if (hasZh) statusText = "ZH 已就绪";
  else if (err) { statusText = "ZH 翻译失败（点重试）"; statusTitle = err; }
  else if (translateMode === "manual") statusText = (inFlight ? "ZH 翻译中…" : "ZH 待翻译（点击思考）");
  else statusText = "ZH 翻译中…";

  const titleAttr = statusTitle ? ` title="${escapeHtml(statusTitle)}"` : "";
  const pillHtml = `<span class="pill"${titleAttr}>${statusText}</span>`;

  let btnHtml = "";
  if (mid && provider !== "none") {
    const tLabel = hasZh ? "重译" : (err ? "重试" : "翻译");
    const dis = inFlight ? " disabled" : "";
    btnHtml = `<button type="button" class="pill pill-btn think-translate" data-think-act="retranslate" data-mid="${mid}" title="翻译/重新翻译这条思考"${dis}>${tLabel}</button>`;
  }

  return `${pillHtml}${btnHtml}`;
}

