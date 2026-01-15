import { renderMarkdownCached } from "../md_cache.js";
import { deriveThinkingData } from "./derive.js";

export function renderThinkingBlock(state, msg, ctx) {
  const mid = (ctx && typeof ctx.mid === "string") ? ctx.mid : "";
  const zhText = (ctx && typeof ctx.zhText === "string") ? ctx.zhText : "";

  const vis = ctx || {};
  const d = deriveThinkingData(msg.text || "", zhText, vis);

  const metaLeftExtra = d.pills.join("");
  const metaRightExtra = d.metaRightExtra || "";

  const enRendered = d.enHas ? renderMarkdownCached(state, `md:${mid}:think_en`, d.enText) : "";
  const zhRendered = (d.showZh && d.hasZhClean) ? renderMarkdownCached(state, `md:${mid}:think_zh`, d.zhClean) : "";

  const parts = [`<div class="think">`];
  if (d.enHas) parts.push(`<div class="think-en md">${enRendered || ""}</div>`);
  if (d.showZh) {
    const zhCls = `think-zh md${d.enHas ? " think-split" : ""}`;
    parts.push(`<div class="${zhCls}">${zhRendered || ""}</div>`);
    if (d.waitingZh) parts.push(`<div class="think-wait meta">（ZH 翻译中…）</div>`);
  }
  parts.push(`</div>`);
  const body = parts.join("");

  return { metaLeftExtra, metaRightExtra, body };
}

