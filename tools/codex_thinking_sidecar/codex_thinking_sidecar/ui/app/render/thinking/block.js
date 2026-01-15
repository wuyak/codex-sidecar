import { renderMarkdownCached } from "../md_cache.js";
import { deriveThinkingData } from "./derive.js";

export function renderThinkingBlock(state, msg, ctx) {
  const mid = (ctx && typeof ctx.mid === "string") ? ctx.mid : "";
  const zhText = (ctx && typeof ctx.zhText === "string") ? ctx.zhText : "";

  const vis = ctx || {};
  const d = deriveThinkingData(msg.text || "", zhText, vis);

  const metaLeftExtra = d.pills.join("");
  const metaRightExtra = d.metaRightExtra || "";

  const enRendered = d.enText ? renderMarkdownCached(state, `md:${mid}:think_en`, d.enText) : "";
  const zhRendered = d.hasZhClean ? renderMarkdownCached(state, `md:${mid}:think_zh`, d.zhClean) : "";

  const parts = [`<div class="think">`];
  if (d.enText) parts.push(`<div class="think-en md">${enRendered || ""}</div>`);
  parts.push(`<div class="think-zh md">${zhRendered || ""}</div>`);
  parts.push(`</div>`);
  const body = parts.join("");

  return { metaLeftExtra, metaRightExtra, body, rowModeClass: `think-mode-${d.mode || "en"}` };
}
