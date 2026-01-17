import { inferToolName, parseToolCallText, statusIcon } from "../../format.js";
import { escapeHtml, keyOf, safeJsonParse } from "../../utils.js";
import { renderMarkdownCached } from "../md_cache.js";

function _extractUpdatePlanFromParallelArgs(argsObj) {
  try {
    if (!argsObj || typeof argsObj !== "object") return null;
    const uses = Array.isArray(argsObj.tool_uses) ? argsObj.tool_uses : [];
    for (const it of uses) {
      if (!it || typeof it !== "object") continue;
      const rn = String(it.recipient_name || it.tool || it.name || "").trim();
      if (!rn) continue;
      const norm = rn.replace(/^functions\./, "").replace(/^multi_tool_use\./, "");
      if (norm === "update_plan" || norm.endsWith(".update_plan")) {
        const p = it.parameters;
        if (p && typeof p === "object") return p;
      }
    }
  } catch (_) {}
  return null;
}

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

  // Some Codex CLI builds wrap tool calls in multi_tool_use.parallel. Detect nested update_plan so
  // quick-view can show plan updates.
  let planArgs = null;
  let isPlanUpdate = false;
  try {
    if (toolName === "parallel") {
      planArgs = _extractUpdatePlanFromParallelArgs(argsObj);
      isPlanUpdate = !!planArgs || String(argsRaw || "").includes("update_plan");
    }
  } catch (_) {}
  if (toolName === "update_plan") {
    isPlanUpdate = true;
    if (argsObj && typeof argsObj === "object") planArgs = argsObj;
  }

  if (planArgs && typeof planArgs === "object") {
    const threadKey = keyOf(msg || {}) || "";
    const explainMap = (state && state.planExplainByKey && typeof state.planExplainByKey.get === "function")
      ? state.planExplainByKey
      : null;
    const rawExplain = (typeof planArgs.explanation === "string") ? planArgs.explanation : "";
    let explanation = rawExplain;
    // Codex CLI 常见：后续 update_plan 只更新状态，不再重复传 explanation。
    // UI 需要沿用同一会话上一次的说明，避免“说明消失”的体验差异。
    try {
      const cleaned = String(rawExplain || "").trim();
      if (cleaned && explainMap && threadKey) explainMap.set(threadKey, cleaned);
      if (!cleaned && explainMap && threadKey) explanation = String(explainMap.get(threadKey) || "");
    } catch (_) {}
    const plan = Array.isArray(planArgs.plan) ? planArgs.plan : [];
    const items = [];
    for (const it of plan) {
      if (!it || typeof it !== "object") continue;
      const st = statusIcon(it.status);
      const step = String(it.step || "").trim();
      if (!step) continue;
      items.push(`${st} ${step}`);
    }
    const lines = items.length ? items : ["（无变更）"];
    const md = [
      "**更新计划**",
      "```text",
      ...lines,
      "```",
      ...(String(explanation || "").trim() ? ["", "**说明**", String(explanation || "").trim()] : []),
    ].join("\n");
    const extra = (toolName === "parallel") ? `<span class="pill">并行</span>` : "";
    const metaLeftExtra = `<span class="pill">更新计划</span>${extra}<span class="pill">${escapeHtml(String(items.length || 0))} 项</span>`;
    const body = `<div class="md">${renderMarkdownCached(state, `md:${mid}:update_plan`, md)}</div>`;
    return { metaLeftExtra, metaRightExtra: "", body, rowClass: "tool-update_plan" };
  }
  if (isPlanUpdate) {
    const md = [
      "**更新计划**",
      "```text",
      "（参数解析失败：建议切换到全量视图查看原始 tool_call）",
      "```",
    ].join("\n");
    const extra = (toolName === "parallel") ? `<span class="pill">并行</span>` : "";
    const metaLeftExtra = `<span class="pill">更新计划</span>${extra}<span class="pill">未解析</span>`;
    const body = `<div class="md">${renderMarkdownCached(state, `md:${mid}:update_plan_fallback`, md)}</div>`;
    return { metaLeftExtra, metaRightExtra: "", body, rowClass: "tool-update_plan" };
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
