import { decorateRow } from "./decorate.js";
import { cleanThinkingText, renderMarkdown, splitLeadingCodeBlock } from "./markdown.js";
import {
  extractExitCode,
  extractWallTime,
  extractOutputBody,
  firstMeaningfulLine,
  formatApplyPatchRun,
  formatOutputTree,
  formatShellRun,
  formatShellRunExpanded,
  inferToolName,
  isCodexEditSummary,
  parseToolCallText,
  parseToolOutputText,
  renderDiffText,
  statusIcon,
  renderCodexEditSummary,
  normalizeNonEmptyLines,
} from "./format.js";
import { escapeHtml, extractJsonOutputString, formatTs, safeDomId, safeJsonParse } from "./utils.js";

export function clearList(dom) {
  const list = dom.list;
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
}

export function renderEmpty(dom) {
  const list = dom.list;
  if (!list) return;
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<div class="meta">暂无数据（或仍在回放中）：先等待 2-5 秒；如仍为空，请确认 sidecar 的 <code>--codex-home</code> 指向包含 <code>sessions/**/rollout-*.jsonl</code> 的目录，然后在 Codex 里发一条消息。也可以打开 <code>/api/messages</code> 验证是否已采集到数据。</div>`;
  list.appendChild(row);
}

export function renderMessage(dom, state, msg) {
  const list = dom.list;
  if (!list) return;

  const row = document.createElement("div");
  const t = formatTs(msg.ts || "");
  const kind = msg.kind || "";
  const kindClass = String(kind || "").replace(/[^a-z0-9_-]/gi, "-");
  row.className = "row" + (kindClass ? ` kind-${kindClass}` : "");

  const mode = (dom.displayMode && dom.displayMode.value) ? dom.displayMode.value : "both";
  const isThinking = (kind === "reasoning_summary" || kind === "agent_reasoning");
  const showEn = !isThinking ? true : (mode !== "zh");
  const showZh = !isThinking ? false : (mode !== "en");
  const zhText = (typeof msg.zh === "string") ? msg.zh : "";
  const hasZh = !!zhText.trim();

  const autoscroll = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 80);

  let body = "";
  let metaLeftExtra = "";
  let metaRightExtra = "";

  if (kind === "tool_output") {
    const parsed = parseToolOutputText(msg.text || "");
    const callId = parsed.callId || "";
    const outputRaw = parsed.outputRaw || "";
    const meta = callId ? state.callIndex.get(callId) : null;
    const toolName = meta && meta.tool_name ? String(meta.tool_name) : "";
    if (toolName === "update_plan") return; // update_plan 已在 tool_call 里展示，避免重复
    const exitCode = extractExitCode(outputRaw);
    const wallTime = extractWallTime(outputRaw);
    const outputBody = extractOutputBody(outputRaw);
    const cmdFull = (meta && meta.args_obj && toolName === "shell_command") ? String(meta.args_obj.command || "") : "";
    const argsRaw = (meta && meta.args_raw) ? String(meta.args_raw || "") : "";
    const rid = `${safeDomId(msg.id || "")}_${safeDomId(callId || "")}_${state.renderSeq++}`;
    const detailsId = ("tool_" + rid + "_details");
    const summaryId = ("tool_" + rid + "_summary");

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
  } else if (kind === "tool_call") {
    const parsed = parseToolCallText(msg.text || "");
    let toolName = parsed.toolName || "tool_call";
    const callId = parsed.callId || "";
    const argsRaw = parsed.argsRaw || "";
    const argsObj = safeJsonParse(argsRaw);
    toolName = inferToolName(toolName, argsRaw, argsObj) || toolName;
    if (callId) state.callIndex.set(callId, { tool_name: toolName, args_raw: argsRaw, args_obj: argsObj });
    // Avoid duplicate clutter: tool_output already renders the useful summary for these.
    if (toolName === "shell_command" || toolName === "view_image" || toolName === "apply_patch") return;

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
      metaLeftExtra = `<span class="pill">更新计划</span><span class="pill">${escapeHtml(String(items.length || 0))} 项</span>`;
      body = `<div class="md">${renderMarkdown(md)}</div>`;
    } else {
      metaLeftExtra = `<span class="pill">工具调用</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
      const pretty = argsObj ? JSON.stringify(argsObj, null, 2) : argsRaw;
      body = `
        <div class="tool-card">
          <pre class="code">${escapeHtml(pretty || "")}</pre>
        </div>
      `;
    }
  } else if (kind === "user_message") {
    metaLeftExtra = `<span class="pill">用户输入</span>`;
    const txt = String(msg.text || "");
    const split = splitLeadingCodeBlock(txt);
    if (split && split.code) {
      body = `${split.code ? `<pre class="code">${escapeHtml(split.code)}</pre>` : ``}${split.rest ? `<div class="md">${renderMarkdown(split.rest)}</div>` : ``}`;
    } else {
      body = `<div class="md">${renderMarkdown(txt)}</div>`;
    }
  } else if (kind === "assistant_message") {
    metaLeftExtra = `<span class="pill">回答</span>`;
    const txt = String(msg.text || "");
    if (isCodexEditSummary(txt)) {
      body = renderCodexEditSummary(txt) || `<pre>${escapeHtml(txt)}</pre>`;
    } else {
      body = `<div class="md">${renderMarkdown(txt)}</div>`;
    }
  } else if (isThinking) {
    const enText = showEn ? cleanThinkingText(msg.text || "") : "";
    const zhClean = (showZh && hasZh) ? cleanThinkingText(zhText) : "";
    const hasZhClean = !!String(zhClean || "").trim();

    const pills = [];
    if (showEn) pills.push(`<span class="pill">思考（EN）</span>`);
    if (showZh && hasZhClean) pills.push(`<span class="pill">思考（ZH）</span>`);
    metaLeftExtra = pills.join("");

    const enRendered = showEn ? renderMarkdown(enText) : "";
    const enHtml = enRendered ? `<div class="md">${enRendered}</div>` : "";
    const zhRendered = (showZh && hasZhClean) ? renderMarkdown(zhClean) : "";
    const zhCls = enHtml ? "md think-split" : "md";
    const zhHtml = zhRendered ? `<div class="${zhCls}">${zhRendered}</div>` : "";
    body = (enHtml || zhHtml) ? (`${enHtml}${zhHtml}`) : `<div class="meta">（空）</div>`;
  } else {
    body = `<pre>${escapeHtml(msg.text || "")}</pre>`;
  }

  row.innerHTML = `
    <div class="meta meta-line">
      <div class="meta-left">
        <span class="timestamp">${escapeHtml(t.local || t.utc)}</span>
        ${metaLeftExtra || ""}
      </div>
      <div class="meta-right">
        ${metaRightExtra || ""}
      </div>
    </div>
    ${body}
  `;
  decorateRow(row);
  list.appendChild(row);
  if (autoscroll) window.scrollTo(0, document.body.scrollHeight);
}
