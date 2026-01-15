import {
  extractExitCode,
  extractOutputBody,
  extractWallTime,
  firstMeaningfulLine,
  formatApplyPatchRun,
  formatOutputTree,
  formatShellRun,
  formatShellRunExpanded,
  normalizeNonEmptyLines,
  parseToolOutputText,
  renderDiffText,
} from "../../format.js";
import { escapeHtml, extractJsonOutputString, safeDomId, safeJsonParse } from "../../utils.js";
import { renderMarkdownCached } from "../md_cache.js";

export function renderToolOutput(dom, state, msg, ctx) {
  const mid = (ctx && typeof ctx.mid === "string") ? ctx.mid : "";

  const parsed = parseToolOutputText(msg.text || "");
  const callId = parsed.callId || "";
  const outputRaw = parsed.outputRaw || "";
  const meta = callId ? (state && state.callIndex ? state.callIndex.get(callId) : null) : null;
  const exitCode = extractExitCode(outputRaw);
  const wallTime = extractWallTime(outputRaw);
  const outputBody = extractOutputBody(outputRaw);
  const toolName = meta && meta.tool_name ? String(meta.tool_name) : "";

  if (toolName === "update_plan") return null; // update_plan 已在 tool_call 里展示，避免重复
  // 容错：极少数情况下 tool_call 丢失导致无法识别 tool_name，但 update_plan 的 output 往往只有 "Plan updated"。
  if (!toolName && String(outputBody || "").trim() === "Plan updated") return null;

  const cmdFull = (meta && meta.args_obj && toolName === "shell_command") ? String(meta.args_obj.command || "") : "";
  const argsRaw = (meta && meta.args_raw) ? String(meta.args_raw || "") : "";
  const seq = state && typeof state.renderSeq === "number" ? state.renderSeq++ : 0;
  const rid = `${safeDomId(mid)}_${safeDomId(callId || "")}_${seq}`;
  const detailsId = ("tool_" + rid + "_details");
  const summaryId = ("tool_" + rid + "_summary");

  let metaLeftExtra = "";
  let metaRightExtra = "";
  let body = "";
  let runShort = "";
  let expandedText = "";

  if (toolName === "shell_command" && cmdFull) {
    metaLeftExtra = `<span class="pill">工具输出</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
    runShort = formatShellRun(cmdFull, outputBody, exitCode);
    const runLong = formatShellRunExpanded(cmdFull, outputBody, exitCode);
    if (runLong && runLong !== runShort) expandedText = runLong;
  } else if (toolName === "apply_patch") {
    metaLeftExtra = `<span class="pill">工具输出</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
    runShort = formatApplyPatchRun(argsRaw, outputBody, 8);
    const patchText = String(argsRaw || "").trim();
    const runLong = formatApplyPatchRun(argsRaw, outputBody, 200);
    const parts = [];
    if (runLong && runLong !== runShort) parts.push(String(runLong || "").trim());
    if (patchText) {
      if (parts.length) parts.push("");
      parts.push(patchText);
    }
    expandedText = parts.join("\n");
  } else if (toolName === "view_image") {
    metaLeftExtra = `<span class="pill">工具输出</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
    const p = (meta && meta.args_obj) ? String(meta.args_obj.path || "") : "";
    const base = (p.split(/[\\/]/).pop() || "").trim();
    const first = firstMeaningfulLine(outputBody) || "attached local image";
    runShort = `• ${first}${base ? `: ${base}` : ``}`;
  } else {
    if (toolName) metaLeftExtra = `<span class="pill">工具输出</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
    else metaLeftExtra = `<span class="pill">工具输出</span><span class="pill">未知工具</span>`;
    const header = `• ${toolName || "tool_output"}`;
    const jsonOut = extractJsonOutputString(outputBody);
    const lines = normalizeNonEmptyLines(jsonOut || outputBody);
    runShort = formatOutputTree(header, lines, 10);
    const runLong = formatOutputTree(header, lines, 120);
    if (runLong && runLong !== runShort) expandedText = runLong;
  }

  if (!String(runShort || "").trim()) {
    const header = `• ${toolName || "tool_output"}`;
    runShort = formatOutputTree(header, normalizeNonEmptyLines(outputBody), 10);
  }

  const hasDetails = !!String(expandedText || "").trim();
  if (hasDetails) {
    const detailsText = String(expandedText || "").trim();
    const detailsHtml = (toolName === "apply_patch") ? renderDiffText(detailsText) : escapeHtml(detailsText);
    metaRightExtra = `<button class="tool-toggle" type="button" data-target="${escapeHtml(detailsId)}" data-swap="${escapeHtml(summaryId)}">详情</button>`;
    body = `
      <div class="tool-card">
        ${runShort ? `<pre id="${escapeHtml(summaryId)}" class="code">${escapeHtml(runShort)}</pre>` : ``}
        <pre id="${escapeHtml(detailsId)}" class="code hidden">${detailsHtml}</pre>
      </div>
    `;
  } else {
    body = `
      <div class="tool-card">
        ${runShort ? `<pre id="${escapeHtml(summaryId)}" class="code">${escapeHtml(runShort)}</pre>` : ``}
      </div>
    `;
  }

  // Unused but kept for parity with formatters.
  void wallTime;

  return { metaLeftExtra, metaRightExtra, body };
}

