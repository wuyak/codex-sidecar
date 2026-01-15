import { inferToolName, parseToolCallText, statusIcon } from "../../format.js";
import { escapeHtml, safeJsonParse } from "../../utils.js";
import { renderMarkdownCached } from "../md_cache.js";

export function renderToolCall(dom, state, msg, ctx) {
  const mid = (ctx && typeof ctx.mid === "string") ? ctx.mid : "";

  const parsed = parseToolCallText(msg.text || "");
  let toolName = parsed.toolName || "tool_call";
  const callId = parsed.callId || "";
  const argsRaw = parsed.argsRaw || "";
  const argsObj = safeJsonParse(argsRaw);
  toolName = inferToolName(toolName, argsRaw, argsObj) || toolName;
  if (callId && state && state.callIndex && typeof state.callIndex.set === "function") {
    state.callIndex.set(callId, { tool_name: toolName, args_raw: argsRaw, args_obj: argsObj });
  }

  // Avoid duplicate clutter: tool_output already renders the useful summary for these.
  if (toolName === "shell_command" || toolName === "view_image" || toolName === "apply_patch") return null;

  if (toolName === "update_plan" && argsObj && typeof argsObj === "object") {
    const explanation = (typeof argsObj.explanation === "string") ? argsObj.explanation : "";
    const plan = Array.isArray(argsObj.plan) ? argsObj.plan : [];
    const items = [];
    for (const it of plan) {
      if (!it || typeof it !== "object") continue;
      const st = statusIcon(it.status);
      const step = String(it.step || "").trim();
      if (!step) continue;
      items.push(`- ${st} ${step}`);
    }
    const md = [
      "**更新计划**",
      ...(items.length ? items : ["- （无变更）"]),
      ...(explanation.trim() ? ["", "**说明**", explanation.trim()] : []),
    ].join("\n");
    const metaLeftExtra = `<span class="pill">更新计划</span><span class="pill">${escapeHtml(String(items.length || 0))} 项</span>`;
    const body = `<div class="md">${renderMarkdownCached(state, `md:${mid}:update_plan`, md)}</div>`;
    return { metaLeftExtra, metaRightExtra: "", body };
  }

  const metaLeftExtra = `<span class="pill">工具调用</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
  const pretty = argsObj ? JSON.stringify(argsObj, null, 2) : argsRaw;
  const body = `
    <div class="tool-card">
      <pre class="code">${escapeHtml(pretty || "")}</pre>
    </div>
  `;
  return { metaLeftExtra, metaRightExtra: "", body };
}

