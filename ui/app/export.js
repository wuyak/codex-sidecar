import { extractJsonOutputString, keyOf, shortId } from "./utils.js";
import { getExportPrefsForKey } from "./export_prefs.js";
import { isOfflineKey, offlineRelFromKey } from "./offline.js";
import { loadOfflineZhMap, upsertOfflineZhBatch } from "./offline_zh.js";
import { downloadTextFile } from "./export/download.js";
import { baseName, pickCustomLabel, sanitizeFileName } from "./export/naming.js";
import { classifyToolCallText } from "./export/tool_calls.js";
import { getQuickBlocks } from "./export/quick_blocks.js";
import { balanceFences, convertKnownHtmlCodeBlocksToFences, safeCodeFence } from "./export/markdown_utils.js";
import {
  extractExitCode,
  extractOutputBody,
  firstMeaningfulLine,
  formatApplyPatchRun,
  formatOutputTree,
  formatShellRun,
  formatShellRunExpanded,
  normalizeNonEmptyLines,
  parseToolOutputText,
  statusIcon,
} from "./format.js";

const _EXPORT_ENGINE_TAG = "md_fence_v2_20260120_1650";

// Export is side-effectful (triggers a file download). To avoid “点击多个导出后卡住，
// 过几十秒突然下载一大批”的体验，默认只允许同时进行 1 个导出任务。
let _exportInFlight = null; // { key, startedMs }

function _kindLabel(kind) {
  const k = String(kind || "");
  if (k === "user_message") return "用户输入";
  if (k === "assistant_message") return "回答";
  if (k === "reasoning_summary") return "思考";
  if (k === "tool_gate") return "终端确认";
  if (k === "tool_call") return "工具调用";
  if (k === "tool_output") return "工具输出";
  return k || "unknown";
}

function _fmtLocal(dt) {
  const d = dt instanceof Date ? dt : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const MM = pad(d.getMinutes());
  const SS = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
}

function _fmtMaybeLocal(ts) {
  const s = String(ts || "").trim();
  if (!s) return "";
  try {
    const d = new Date(s);
    if (Number.isFinite(d.getTime())) return _fmtLocal(d);
  } catch (_) {}
  return s;
}

function _renderUpdatePlan(planArgs) {
  const p = (planArgs && typeof planArgs === "object") ? planArgs : null;
  if (!p) return "";
  const rawExplain = (typeof p.explanation === "string") ? p.explanation : "";
  const explanation = String(rawExplain || "").trim();
  const plan = Array.isArray(p.plan) ? p.plan : [];
  const items = [];
  for (const it of plan) {
    if (!it || typeof it !== "object") continue;
    const st = statusIcon(it.status);
    const step = String(it.step || "").trim();
    if (!step) continue;
    items.push(`${st} ${step}`);
  }
  const lines = items.length ? items : ["（无变更）"];
  const parts = [
    "**更新计划**",
    "```text",
    ...lines,
    "```",
  ];
  if (explanation) parts.push("", "**说明**", explanation);
  return parts.join("\n").trimEnd();
}

function _extractApplyPatchFromShellCommand(cmdFull) {
  const lines = String(cmdFull ?? "").split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] ?? "").trimStart();
    if (t.startsWith("*** Begin Patch")) { start = i; break; }
  }
  if (start < 0) return "";
  let end = -1;
  for (let i = lines.length - 1; i >= start; i--) {
    const t = String(lines[i] ?? "").trimStart();
    if (t.startsWith("*** End Patch")) { end = i; break; }
  }
  if (end < 0) end = lines.length - 1;
  return lines.slice(start, end + 1).join("\n").trim();
}

function _details(summary, body) {
  const s = String(summary || "详情").trim() || "详情";
  const b = String(body || "").trimEnd();
  // Export target is Markdown: avoid HTML <details>/<summary> for better portability across renderers.
  return [`**${s}**`, "", b].join("\n").trimEnd();
}

function _isSuppressedToolCallTool(toolName) {
  const t = String(toolName || "").trim();
  return t === "shell_command" || t === "apply_patch" || t === "view_image";
}

function _renderToolCallMd(tc) {
  if (!tc || typeof tc !== "object") return "";
  if (tc.isPlanUpdate) return _renderUpdatePlan(tc.planArgs);
  const tool = String(tc.toolName || "").trim();
  const pretty = tc.argsObj ? JSON.stringify(tc.argsObj, null, 2) : String(tc.argsRaw || "").trimEnd();
  const lang = tc.argsObj ? "json" : "text";
  const head = tool ? `**${tool}**\n\n` : "";
  return `${head}${safeCodeFence(pretty || "", lang)}`.trimEnd();
}

function _renderToolOutputMd(outputRaw, meta) {
  const raw = String(outputRaw || "");
  const toolName = String(meta && meta.tool_name ? meta.tool_name : "").trim();
  const argsObj = meta && meta.args_obj ? meta.args_obj : null;
  const argsRaw = String(meta && meta.args_raw ? meta.args_raw : "").trimEnd();

  const exitCode = extractExitCode(raw);
  const outputBody = extractOutputBody(raw);

  if (toolName === "shell_command") {
    const cmdFull = (argsObj && typeof argsObj === "object") ? String(argsObj.command || "") : "";
    const runShort = formatShellRun(cmdFull, outputBody, exitCode);
    const runLong = formatShellRunExpanded(cmdFull, outputBody, exitCode);
    const patchText = _extractApplyPatchFromShellCommand(cmdFull);
    const blocks = [];
    if (runShort) blocks.push(safeCodeFence(runShort, "text"));
    const detailParts = [];
    if (runLong && runLong !== runShort) detailParts.push(safeCodeFence(runLong, "text"));
    if (patchText) detailParts.push(safeCodeFence(patchText, "diff"));
    if (detailParts.length) blocks.push(_details("详情", detailParts.join("\n\n")));
    return blocks.join("\n\n").trimEnd();
  }

  if (toolName === "apply_patch") {
    const runShort = formatApplyPatchRun(argsRaw, outputBody, 8);
    const runLong = formatApplyPatchRun(argsRaw, outputBody, 200);
    const patchText = String(argsRaw || "").trim();
    const blocks = [];
    if (runShort) blocks.push(safeCodeFence(runShort, "text"));
    const detailParts = [];
    if (runLong && runLong !== runShort) detailParts.push(safeCodeFence(runLong, "text"));
    if (patchText) detailParts.push(safeCodeFence(patchText, "diff"));
    if (detailParts.length) blocks.push(_details("详情", detailParts.join("\n\n")));
    return blocks.join("\n\n").trimEnd();
  }

  if (toolName === "view_image") {
    const p = (argsObj && typeof argsObj === "object") ? String(argsObj.path || "") : "";
    const base = (p.split(/[\\/]/).pop() || "").trim();
    const first = firstMeaningfulLine(outputBody) || "attached local image";
    const line = `• ${first}${base ? `: ${base}` : ``}`;
    return safeCodeFence(line, "text");
  }

  const header = `• ${toolName || "tool_output"}`;
  const jsonOut = extractJsonOutputString(outputBody);
  const lines = normalizeNonEmptyLines(jsonOut || outputBody);
  const runShort = formatOutputTree(header, lines, 10);
  const runLong = formatOutputTree(header, lines, 120);
  const blocks = [];
  if (runShort) blocks.push(safeCodeFence(runShort, "text"));
  if (runLong && runLong !== runShort) blocks.push(_details("详情", safeCodeFence(runLong, "text")));
  return blocks.join("\n\n").trimEnd();
}

async function _ensureReasoningTranslatedDirect({ messages, maxN = 12 }) {
  const arr = Array.isArray(messages) ? messages : [];
  const needs = arr
    .filter((m) => {
      const kind = String(m && m.kind ? m.kind : "");
      if (kind !== "reasoning_summary") return false;
      const id = String(m && m.id ? m.id : "").trim();
      if (!id) return false;
      const zh = String(m && m.zh ? m.zh : "").trim();
      return !zh;
    })
    .slice(0, Math.max(0, Number(maxN) || 0));

  if (!needs.length) return { ok: true, queued: 0, filled: 0, waited_ms: 0 };

  const start = Date.now();
  let filled = 0;
  try {
    const items = needs.map((m) => ({ id: String(m.id || ""), text: String(m.text || "") }));

    const _postItems = async (url) => {
      const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutMs = Math.min(30000, 6000 + items.length * 900);
      const t = ac ? setTimeout(() => { try { ac.abort(); } catch (_) {} }, timeoutMs) : 0;
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
          ...(ac ? { signal: ac.signal } : {}),
        });
        const resp = await r.json().catch(() => null);
        const outItems = Array.isArray(resp && resp.items) ? resp.items : [];
        return { ok: !!(r && r.ok && resp && resp.ok !== false), status: Number(r && r.status) || 0, outItems };
      } finally {
        if (t) { try { clearTimeout(t); } catch (_) {} }
      }
    };

    // Prefer the unified translate_text endpoint.
    // Fallback to /api/offline/translate only when translate_text is truly missing (404).
    let outItems = [];
    let r1 = null;
    try { r1 = await _postItems("/api/control/translate_text"); } catch (_) { r1 = null; }
    if (r1 && Array.isArray(r1.outItems)) outItems = r1.outItems;
    if (r1 && !r1.ok && r1.status === 404) {
      try {
        const r2 = await _postItems("/api/offline/translate");
        outItems = r2.outItems;
      } catch (_) {}
    }

    const byId = new Map(outItems.map((x) => [String(x && x.id ? x.id : ""), x]));
    for (const m of needs) {
      const id = String(m && m.id ? m.id : "").trim();
      if (!id) continue;
      const r = byId.get(id);
      const zh = String(r && (r.zh || r.text) ? (r.zh || r.text) : "").trimEnd();
      const err = String(r && r.error ? r.error : "").trim();
      if (zh) {
        m.zh = zh;
        filled += 1;
      } else if (err) {
        try { m.translate_error = err; } catch (_) {}
      }
    }
  } catch (_) {}

  return { ok: true, queued: needs.length, filled, waited_ms: Date.now() - start };
}

async function _ensureReasoningTranslatedOffline({ state, rel, messages, maxN = 12 }) {
  const arr = Array.isArray(messages) ? messages : [];
  const rel0 = String(rel || "").trim();
  const needs = arr
    .filter((m) => {
      const kind = String(m && m.kind ? m.kind : "");
      if (kind !== "reasoning_summary") return false;
      const id = String(m && m.id ? m.id : "").trim();
      if (!id) return false;
      const zh = String(m && m.zh ? m.zh : "").trim();
      return !zh;
    })
    .slice(0, Math.max(0, Number(maxN) || 0));

  if (!needs.length) return { ok: true, queued: 0, filled: 0, waited_ms: 0 };

  const start = Date.now();
  let filled = 0;
  const persist = {};
  try {
    if (!state.offlineZhById || typeof state.offlineZhById.set !== "function") state.offlineZhById = new Map();
    const items = needs.map((m) => ({ id: String(m.id || ""), text: String(m.text || "") }));

    const _postItems = async (url) => {
      const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timeoutMs = Math.min(30000, 6000 + items.length * 900);
      const t = ac ? setTimeout(() => { try { ac.abort(); } catch (_) {} }, timeoutMs) : 0;
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
          ...(ac ? { signal: ac.signal } : {}),
        });
        const resp = await r.json().catch(() => null);
        const outItems = Array.isArray(resp && resp.items) ? resp.items : [];
        return { ok: !!(r && r.ok && resp && resp.ok !== false), status: Number(r && r.status) || 0, outItems };
      } finally {
        if (t) { try { clearTimeout(t); } catch (_) {} }
      }
    };

    // Prefer unified translate_text; only fallback when endpoint is missing (404).
    let outItems = [];
    let r1 = null;
    try { r1 = await _postItems("/api/control/translate_text"); } catch (_) { r1 = null; }
    if (r1 && Array.isArray(r1.outItems)) outItems = r1.outItems;
    if (r1 && !r1.ok && r1.status === 404) {
      try {
        const r2 = await _postItems("/api/offline/translate");
        outItems = r2.outItems;
      } catch (_) {}
    }

    const byId = new Map(outItems.map((x) => [String(x && x.id ? x.id : ""), x]));

    for (const m of needs) {
      const id = String(m && m.id ? m.id : "").trim();
      if (!id) continue;
      const r = byId.get(id);
      const zh = String(r && (r.zh || r.text) ? (r.zh || r.text) : "").trimEnd();
      const err = String(r && r.error ? r.error : "").trim();
      if (zh) {
        m.zh = zh;
        filled += 1;
        try { persist[id] = zh; } catch (_) {}
        try { state.offlineZhById.set(id, { zh, err: "" }); } catch (_) {}
      } else if (err) {
        try { m.translate_error = err; } catch (_) {}
        try { state.offlineZhById.set(id, { zh: "", err }); } catch (_) {}
      }
    }
  } catch (_) {}

  try { if (rel0 && Object.keys(persist).length) upsertOfflineZhBatch(rel0, persist); } catch (_) {}
  return { ok: true, queued: needs.length, filled, waited_ms: Date.now() - start };
}

function _renderReasoning(m, opts = {}) {
  const en = String((m && m.text) ? m.text : "").trimEnd();
  const zh = String((m && m.zh) ? m.zh : "").trimEnd();
  const err = String((m && m.translate_error) ? m.translate_error : "").trim();
  const mode = String(opts.lang || "auto").trim().toLowerCase();
  const hasZh = !!(zh && !err);
  if (mode === "en") return balanceFences(en);
  if (mode === "zh") return balanceFences(hasZh ? zh : en);
  if (mode === "both" && hasZh && en) {
    return balanceFences([`### 中文`, "", zh, "", `### English`, "", en].join("\n").trimEnd());
  }
  if (mode === "toggle" && hasZh) {
    const parts = [];
    if (zh) parts.push(zh.trimEnd());
    if (en) {
      parts.push("");
      parts.push("**English**");
      parts.push("");
      parts.push(en.trimEnd());
    }
    return balanceFences(parts.join("\n").trimEnd());
  }
  // auto: prefer zh when available, otherwise keep original.
  return balanceFences(hasZh ? zh : en);
}

export async function exportThreadMarkdown(state, key, opts = {}) {
  const k = String(key || "").trim();
  if (!k || k === "all") return { ok: false, error: "select_thread" };

  if (_exportInFlight) {
    return {
      ok: false,
      error: "export_in_flight",
      in_flight: {
        key: String(_exportInFlight.key || ""),
        waited_ms: Math.max(0, Date.now() - (Number(_exportInFlight.startedMs) || Date.now())),
      },
    };
  }
  _exportInFlight = { key: k, startedMs: Date.now() };
  try {
  // 兼容：调用方未传 opts 时，使用会话级导出偏好（精简/译文）。
  try {
    if (opts && (opts.mode == null || opts.reasoningLang == null)) {
      const p = getExportPrefsForKey(k);
      if (opts.mode == null) opts.mode = p.quick ? "quick" : "full";
      if (opts.reasoningLang == null) opts.reasoningLang = p.translate ? "zh" : "en";
    }
  } catch (_) {}

  const mode = String(opts.mode || "").trim().toLowerCase() === "full" ? "full" : "quick";
  const reasoningLang = String(opts.reasoningLang || "auto").trim().toLowerCase();
  const quickBlocks = getQuickBlocks(state);

  let messages = [];
  const thread = (state && state.threadIndex && typeof state.threadIndex.get === "function")
    ? (state.threadIndex.get(k) || {})
    : {};
  const offline = isOfflineKey(k);
  let rel = "";
  let threadId = String(thread.thread_id || "");
  let file = String(thread.file || "");

  try {
    if (offline) {
      rel = offlineRelFromKey(k);
      const tail = Math.max(0, Number(state && state.replayLastLines) || 0) || 200;
      const url = `/api/offline/messages?rel=${encodeURIComponent(rel)}&tail_lines=${encodeURIComponent(tail)}&t=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store" }).then(r => r.json());
      messages = Array.isArray(r && r.messages) ? r.messages : [];
      try {
        const fp = String(r && r.file ? r.file : "").trim();
        if (fp) file = fp;
      } catch (_) {}
      try {
        if (!threadId) threadId = String(messages && messages[0] && messages[0].thread_id ? messages[0].thread_id : "");
      } catch (_) {}
      // 回填本地离线译文缓存（localStorage + 内存 Map；UI 与导出一致）
      try {
        const ls = rel ? loadOfflineZhMap(rel) : {};
        if (!state.offlineZhById || typeof state.offlineZhById.get !== "function") state.offlineZhById = new Map();
        if (state && state.offlineZhById && typeof state.offlineZhById.get === "function") {
          for (const m of messages) {
            if (!m || typeof m !== "object") continue;
            if (String(m.kind || "") !== "reasoning_summary") continue;
            const id = String(m.id || "").trim();
            if (!id) continue;
            if (String(m.zh || "").trim()) continue;
            let zh = "";
            try { zh = String(ls && ls[id] ? ls[id] : "").trim(); } catch (_) { zh = ""; }
            if (!zh) {
              const cached = state.offlineZhById.get(id);
              if (!cached || typeof cached !== "object") continue;
              zh = String(cached.zh || "").trim();
              const err = String(cached.err || "").trim();
              if (err) m.translate_error = err;
            }
            if (zh) {
              m.zh = zh;
              try { state.offlineZhById.set(id, { zh, err: "" }); } catch (_) {}
            }
          }
        }
      } catch (_) {}
    } else {
      const url = threadId ? `/api/messages?thread_id=${encodeURIComponent(threadId)}&t=${Date.now()}` : `/api/messages?t=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store" }).then(r => r.json());
      messages = Array.isArray(r && r.messages) ? r.messages : [];
    }
  } catch (_) {
    return { ok: false, error: "fetch_failed" };
  }

  const selected = threadId ? messages : messages.filter(m => keyOf(m) === k);
  selected.sort((a, b) => (Number(a && a.seq) || 0) - (Number(b && b.seq) || 0));

  // Build a minimal call index for tool_output rendering (mirrors UI behavior).
  const callMeta = new Map(); // call_id -> { tool_name, args_raw, args_obj }
  for (const m of selected) {
    const kind = String(m && m.kind ? m.kind : "");
    if (kind !== "tool_call") continue;
    const tc = classifyToolCallText(m && m.text ? m.text : "");
    if (!tc.callId) continue;
    callMeta.set(tc.callId, { tool_name: tc.toolName, args_raw: tc.argsRaw, args_obj: tc.argsObj });
  }

  // If user asked for translated thinking but we don't have zh yet, try to translate on export.
  // This makes “译文”导出选项真正有差异（而不是取决于你之前是否点过某条思考）。
  let translateStat = null;
  try {
    const needThinking = (mode === "full") || (quickBlocks && quickBlocks.has("reasoning_summary"));
    if (needThinking && reasoningLang !== "en") {
      const missing = selected.filter((m) => {
        const kind = String(m && m.kind ? m.kind : "");
        if (kind !== "reasoning_summary") return false;
        const id = String(m && m.id ? m.id : "").trim();
        if (!id) return false;
        const zh = String(m && m.zh ? m.zh : "").trim();
        return !zh;
      }).length;

      // Export is a “one-shot”: be more aggressive than normal UI translation so the output
      // actually reflects the user's choice (译文/原文).
      const maxN = Math.min(missing, mode === "quick" ? 18 : 48);

      if (offline) {
        translateStat = await _ensureReasoningTranslatedOffline({ state, rel, messages: selected, maxN });
      } else {
        translateStat = await _ensureReasoningTranslatedDirect({ messages: selected, maxN });
      }
    }
  } catch (_) {}

  const now = new Date();
  const custom = pickCustomLabel(k, threadId, file);
  const fileBase = baseName(file);
  const title = custom || fileBase || (threadId ? shortId(threadId) : shortId(k)) || "导出";

  const lines = [];
  lines.push(`# ${title}`);
  const modeLabel = mode === "quick" ? "精简" : "全量";
  const thinkMode = (reasoningLang === "en")
    ? "原文"
    : (reasoningLang === "zh" || reasoningLang === "toggle")
      ? "译文"
      : (reasoningLang === "both")
        ? "双语"
        : "自动";
  const idShort = threadId ? shortId(threadId) : shortId(k);
  lines.push("");
  lines.push(`| 项目 | 值 |`);
  lines.push(`| --- | --- |`);
  if (idShort) lines.push(`| Thread | \`${idShort}\` |`);
  if (fileBase) lines.push(`| 源文件 | \`${fileBase}\` |`);
  lines.push(`| 导出时间 | ${_fmtLocal(now)} |`);
  lines.push(`| 导出模式 | ${modeLabel} |`);
  lines.push(`| 思考语言 | ${thinkMode} |`);
  lines.push(`| 导出引擎 | \`${_EXPORT_ENGINE_TAG}\` |`);
  try {
    if (translateStat && translateStat.queued) {
      lines.push(`| 导出翻译 | 已触发 ${translateStat.queued} 条（已就绪 ${translateStat.filled} 条，等待 ${translateStat.waited_ms}ms） |`);
    }
  } catch (_) {}
  lines.push("");
  lines.push("---");
  lines.push("");

  const sections = [];
  let idx = 0;
  for (const m of selected) {
    const kind = String(m && m.kind ? m.kind : "");

    // Quick-mode filtering mirrors UI quick-view blocks.
    if (mode === "quick") {
      if (kind === "user_message" && !quickBlocks.has("user_message")) continue;
      if (kind === "assistant_message" && !quickBlocks.has("assistant_message")) continue;
      if (kind === "reasoning_summary" && !quickBlocks.has("reasoning_summary")) continue;
      if (kind === "tool_gate" && !quickBlocks.has("tool_gate")) continue;
      if (kind === "tool_call") {
        const tc0 = classifyToolCallText(m && m.text ? m.text : "");
        if (_isSuppressedToolCallTool(tc0.toolName)) continue; // UI never shows these tool_call rows
        if (tc0.isPlanUpdate) {
          if (!quickBlocks.has("update_plan")) continue;
        } else {
          if (!quickBlocks.has("tool_call")) continue;
        }
      }
      if (kind === "tool_output" && !quickBlocks.has("tool_output")) {
        // Rare fallback: some environments may lose tool_name but still emit a plan update output.
        const po0 = parseToolOutputText(m && m.text ? m.text : "");
        const body0 = extractOutputBody(String(po0.outputRaw || ""));
        const isPlanUpdated = String(body0 || "").trim() === "Plan updated";
        if (!(isPlanUpdated && quickBlocks.has("update_plan"))) continue;
      }
      // Unknown kinds are hidden in quick mode.
      if (!["user_message", "assistant_message", "reasoning_summary", "tool_gate", "tool_call", "tool_output"].includes(kind)) continue;
    }

    const tsLocal = _fmtMaybeLocal(m && m.ts ? m.ts : "");

    let text = "";
    let kindName = _kindLabel(kind);
    if (kind === "reasoning_summary") {
      text = _renderReasoning(m, { lang: reasoningLang });
    } else if (kind === "tool_call") {
      const tc = classifyToolCallText(m && m.text ? m.text : "");
      if (_isSuppressedToolCallTool(tc.toolName)) continue; // mirror UI: tool_output already carries the useful summary
      kindName = tc.isPlanUpdate ? "更新计划" : `${_kindLabel(kind)}${tc.toolName ? ` · ${tc.toolName}` : ""}`;
      text = _renderToolCallMd(tc);
    } else if (kind === "tool_output") {
      const po = parseToolOutputText(m && m.text ? m.text : "");
      const callId = String(po.callId || "").trim();
      const meta = callId ? callMeta.get(callId) : null;
      const toolName = String(meta && meta.tool_name ? meta.tool_name : "").trim();
      const outputBody = extractOutputBody(String(po.outputRaw || ""));

      // Mirror UI: update_plan tool_output is redundant (already shown in tool_call as "更新计划").
      if (toolName === "update_plan") continue;
      if (!toolName && String(outputBody || "").trim() === "Plan updated") {
        kindName = "更新计划";
        text = ["**更新计划**", "```text", "- Plan updated", "```"].join("\n");
      } else {
        kindName = `${_kindLabel(kind)}${toolName ? ` · ${toolName}` : ""}`;
        text = _renderToolOutputMd(po.outputRaw || "", meta);
      }
    } else {
      const raw = String((m && m.text) ? m.text : "").trimEnd();
      text = balanceFences(convertKnownHtmlCodeBlocksToFences(raw));
    }
    idx += 1;
    const head = `## ${idx}. ${kindName}${tsLocal ? ` · ${tsLocal}` : ""}`;
    sections.push([head, "", text || ""].join("\n").trimEnd());
  }
  lines.push(sections.join("\n\n---\n\n"));

  const safeTitle = sanitizeFileName(title) || "导出";
  const name = `${safeTitle}.md`;
  const _cls = (s) => {
    const t = (s ?? "").trim();
    if (!t) return "blank";
    if (t.startsWith("```")) return "fence";
    if (t.startsWith("#")) return "heading";
    if (t.startsWith("- ")) return "list";
    if (t.startsWith(">")) return "quote";
    if (t.startsWith("|")) return "table";
    if (t.startsWith("---")) return "hr";
    return "text";
  };

  const bodyLines = [];
  let prevKeptBlank = true; // 直接吞掉开头空行
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] == null ? "" : String(lines[i]);
    const kind = _cls(line);

    if (kind === "fence") {
      bodyLines.push(line);
      prevKeptBlank = false;
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      bodyLines.push(line);
      prevKeptBlank = false;
      continue;
    }

    if (kind === "blank") {
      const prevKind = i > 0 ? _cls(lines[i - 1]) : "start";
      const nextKind = i + 1 < lines.length ? _cls(lines[i + 1]) : "end";

      // 修复“每行之间插一空行”导致的稀疏：文本-空行-文本 直接收紧。
      if (prevKind === "text" && nextKind === "text") continue;
      // 标题之间无需额外空行。
      if (prevKind === "heading" && nextKind === "heading") continue;
      // 连续空行只保留 1 个。
      if (prevKeptBlank) continue;

      bodyLines.push("");
      prevKeptBlank = true;
      continue;
    }

    bodyLines.push(line);
    prevKeptBlank = false;
  }

  while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
  while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();

  downloadTextFile(name, bodyLines.join("\n") + "\n", "text/markdown;charset=utf-8");
  return { ok: true, mode, count: sections.length, translated: translateStat };
  } finally {
    _exportInFlight = null;
  }
}

export async function exportCurrentThreadMarkdown(state, opts = {}) {
  const key = String((state && state.currentKey) ? state.currentKey : "").trim();
  return exportThreadMarkdown(state, key, opts);
}
