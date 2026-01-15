import { escapeHtml } from "../../utils.js";
import { renderMarkdownCached } from "../md_cache.js";
import { deriveThinkingData } from "./derive.js";

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
      row.classList.add(`think-mode-${d.mode || "both"}`);
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
      }
    }

    // Update ZH (always keep it ready for per-row mode toggles).
    const zhRendered = d.hasZhClean ? renderMarkdownCached(state, `md:${mid}:think_zh`, d.zhClean) : "";
    const zhEl = row.querySelector(".think-zh");
    if (!zhEl) throw new Error("missing zh container");
    const split = (d.mode === "both" && String(d.enText || "").trim()) ? " think-split" : "";
    zhEl.className = `think-zh md${split}`;
    zhEl.innerHTML = zhRendered || "";

    let waitEl = row.querySelector(".think-wait");
    if (!d.hasZhClean) {
      if (!waitEl) {
        waitEl = document.createElement("div");
        waitEl.className = "think-wait meta";
        waitEl.textContent = "（ZH 翻译中…）";
        try {
          const anchor = (zhEl.closest && zhEl.closest(".pre-wrap")) ? zhEl.closest(".pre-wrap") : zhEl;
          anchor.parentNode && anchor.parentNode.insertBefore(waitEl, anchor.nextSibling);
        } catch (_) {}
      } else {
        waitEl.textContent = "（ZH 翻译中…）";
      }
    } else if (waitEl && waitEl.parentNode) {
      try { waitEl.parentNode.removeChild(waitEl); } catch (_) {}
    }

    return true;
  } catch (_) {
    return false;
  }
}
