import { escapeHtml } from "../../utils.js";
import { renderMarkdownCached } from "../md_cache.js";
import { deriveThinkingData } from "./derive.js";
import { renderMathInMd } from "../../math.js";

export function tryPatchThinkingRow(dom, state, msg, row, ctx) {
  const mid = (ctx && typeof ctx.mid === "string") ? ctx.mid : "";
  const t = (ctx && typeof ctx.t === "object") ? ctx.t : {};
  const zhText = (ctx && typeof ctx.zhText === "string") ? ctx.zhText : "";
  const isUpdate = !!(ctx && ctx.isUpdate);

  try {
    const metaLeft = row.querySelector ? row.querySelector(".meta-left") : null;
    const metaRight = row.querySelector ? row.querySelector(".meta-right") : null;
    if (!metaLeft || !metaRight) throw new Error("missing meta");

    const vis = ctx || {};
    const d = deriveThinkingData(msg.text || "", zhText, vis);

    // Sync mode class so per-row display toggles remain stable across updates.
    try {
      row.classList.remove("think-mode-en", "think-mode-zh", "think-mode-both");
      row.classList.add(`think-mode-${d.mode || "en"}`);
    } catch (_) {}

    metaLeft.innerHTML = `
      <span class="timestamp">${escapeHtml(t.local || t.utc)}</span>
      ${d.pills.join("")}
    `;
    metaRight.innerHTML = d.metaRightExtra || "";

    // Update EN (optional). Translation backfill is usually op=update; skip EN re-render to reduce DOM churn.
    if (!isUpdate) {
      const enEl = row.querySelector(".think-en");
      if (enEl) {
        const enRendered = renderMarkdownCached(state, `md:${mid}:think_en`, d.enText);
        enEl.innerHTML = enRendered || "";
        try { renderMathInMd(enEl); } catch (_) {}
      }
    }

    // Update ZH (always keep it ready for per-row mode toggles).
    const zhRendered = d.hasZhClean ? renderMarkdownCached(state, `md:${mid}:think_zh`, d.zhClean) : "";
    const zhEl = row.querySelector(".think-zh");
    if (!zhEl) throw new Error("missing zh container");
    zhEl.className = `think-zh md`;
    zhEl.innerHTML = zhRendered || "";
    try { renderMathInMd(zhEl); } catch (_) {}

    return true;
  } catch (_) {
    return false;
  }
}
