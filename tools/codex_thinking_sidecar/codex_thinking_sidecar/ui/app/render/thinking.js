import { cleanThinkingText } from "../markdown.js";
import { escapeHtml } from "../utils.js";
import { renderMarkdownCached } from "./md_cache.js";

export function isThinkingKind(kind) {
  return kind === "reasoning_summary" || kind === "agent_reasoning";
}

export function getThinkingVisibility(dom) {
  const mode = (dom && dom.displayMode && dom.displayMode.value) ? dom.displayMode.value : "both";
  return {
    mode,
    showEn: mode !== "zh",
    showZh: mode !== "en",
  };
}

export function tryPatchThinkingRow(dom, state, msg, row, ctx) {
  const mid = (ctx && typeof ctx.mid === "string") ? ctx.mid : "";
  const t = (ctx && typeof ctx.t === "object") ? ctx.t : {};
  const showEn = !!(ctx && ctx.showEn);
  const showZh = !!(ctx && ctx.showZh);
  const zhText = (ctx && typeof ctx.zhText === "string") ? ctx.zhText : "";

  try {
    const metaLeft = row.querySelector ? row.querySelector(".meta-left") : null;
    const metaRight = row.querySelector ? row.querySelector(".meta-right") : null;
    if (!metaLeft || !metaRight) throw new Error("missing meta");

    const enText = showEn ? cleanThinkingText(msg.text || "") : "";
    const hasZh = !!zhText.trim();
    const zhClean = (hasZh) ? cleanThinkingText(zhText) : "";
    const hasZhClean = !!String(zhClean || "").trim();
    const waitingZh = (!hasZhClean);

    const pills = [];
    if (showEn) pills.push(`<span class="pill">思考（EN）</span>`);
    if (showZh && hasZhClean) pills.push(`<span class="pill">思考（ZH）</span>`);
    else if (showZh && waitingZh) pills.push(`<span class="pill">思考（ZH…）</span>`);

    const metaRightExtra = (!showZh)
      ? (hasZhClean ? `<span class="pill">ZH 已就绪</span>` : `<span class="pill">ZH 翻译中</span>`)
      : "";

    metaLeft.innerHTML = `
      <span class="timestamp">${escapeHtml(t.local || t.utc)}</span>
      ${pills.join("")}
    `;
    metaRight.innerHTML = metaRightExtra || "";

    // Update EN (optional)
    if (showEn) {
      const enRendered = renderMarkdownCached(state, `md:${mid}:think_en`, enText);
      const enEl = row.querySelector(".think-en");
      if (enEl) enEl.innerHTML = enRendered || "";
    }

    // Update ZH (optional)
    if (showZh) {
      const zhRendered = hasZhClean ? renderMarkdownCached(state, `md:${mid}:think_zh`, zhClean) : "";
      const enHas = !!(showEn && String(enText || "").trim());
      const zhEl = row.querySelector(".think-zh");
      if (!zhEl) throw new Error("missing zh container");
      zhEl.className = `think-zh md${enHas ? " think-split" : ""}`;
      zhEl.innerHTML = zhRendered || "";

      let waitEl = row.querySelector(".think-wait");
      if (waitingZh) {
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
    }

    return true;
  } catch (_) {
    return false;
  }
}

export function renderThinkingBlock(state, msg, ctx) {
  const mid = (ctx && typeof ctx.mid === "string") ? ctx.mid : "";
  const showEn = !!(ctx && ctx.showEn);
  const showZh = !!(ctx && ctx.showZh);
  const zhText = (ctx && typeof ctx.zhText === "string") ? ctx.zhText : "";

  const enText = showEn ? cleanThinkingText(msg.text || "") : "";
  const hasZh = !!zhText.trim();
  const zhClean = (hasZh) ? cleanThinkingText(zhText) : "";
  const hasZhClean = !!String(zhClean || "").trim();
  const waitingZh = (!hasZhClean);

  const pills = [];
  if (showEn) pills.push(`<span class="pill">思考（EN）</span>`);
  if (showZh && hasZhClean) pills.push(`<span class="pill">思考（ZH）</span>`);
  else if (showZh && waitingZh) pills.push(`<span class="pill">思考（ZH…）</span>`);
  const metaLeftExtra = pills.join("");

  const metaRightExtra = (!showZh)
    ? (hasZhClean ? `<span class="pill">ZH 已就绪</span>` : `<span class="pill">ZH 翻译中</span>`)
    : "";

  const enHas = !!(showEn && String(enText || "").trim());
  const enRendered = enHas ? renderMarkdownCached(state, `md:${mid}:think_en`, enText) : "";
  const zhRendered = (showZh && hasZhClean) ? renderMarkdownCached(state, `md:${mid}:think_zh`, zhClean) : "";

  const parts = [`<div class="think">`];
  if (enHas) parts.push(`<div class="think-en md">${enRendered || ""}</div>`);
  if (showZh) {
    const zhCls = `think-zh md${enHas ? " think-split" : ""}`;
    parts.push(`<div class="${zhCls}">${zhRendered || ""}</div>`);
    if (waitingZh) parts.push(`<div class="think-wait meta">（ZH 翻译中…）</div>`);
  }
  parts.push(`</div>`);
  const body = parts.join("");

  return { metaLeftExtra, metaRightExtra, body };
}

