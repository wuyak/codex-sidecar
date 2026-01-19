import { getCustomLabel } from "./sidebar/labels.js";
import { extractJsonOutputString, keyOf, safeJsonParse, shortId } from "./utils.js";
import { getExportPrefsForKey } from "./export_prefs.js";
import {
  extractExitCode,
  extractOutputBody,
  firstMeaningfulLine,
  formatApplyPatchRun,
  formatOutputTree,
  formatShellRun,
  formatShellRunExpanded,
  inferToolName,
  normalizeNonEmptyLines,
  parseToolCallText,
  parseToolOutputText,
  statusIcon,
} from "./format.js";

function _extractUuid(s) {
  const raw = String(s || "");
  if (!raw) return "";
  const m = raw.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return m ? String(m[0] || "") : "";
}

function _sanitizeFileName(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  try {
    return raw
      // Cross-platform-safe: remove control chars + Windows reserved chars.
      .replaceAll(/[\u0000-\u001f\u007f]+/g, " ")
      .replaceAll(/[<>:"/\\|?*]+/g, " ")
      .replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  } catch (_) {
    // Conservative fallback.
    return raw
      .replaceAll(/[\u0000-\u001f\u007f]+/g, " ")
      .replaceAll(/[<>:"/\\|?*]+/g, " ")
      .replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, 80);
  }
}

function _shortIdForFile(s) {
  const raw = String(s || "").trim();
  if (!raw) return "";
  if (raw.length <= 10) return raw;
  return raw.slice(0, 6) + "-" + raw.slice(-4);
}

function _pickCustomLabel(key, threadId, filePath) {
  const k = String(key || "").trim();
  const tid = String(threadId || "").trim();
  const f = String(filePath || "").trim();

  let v = "";
  try { v = String(getCustomLabel(k) || "").trim(); } catch (_) { v = ""; }
  if (v) return v;

  if (tid && tid !== k) {
    try { v = String(getCustomLabel(tid) || "").trim(); } catch (_) { v = ""; }
    if (v) return v;
  }
  if (f && f !== k) {
    try { v = String(getCustomLabel(f) || "").trim(); } catch (_) { v = ""; }
    if (v) return v;
  }

  // Back-compat: some older UIs might have used a file-path key; try parse uuid from it.
  const fromFile = _extractUuid(f || k);
  if (fromFile && fromFile !== k && fromFile !== tid) {
    try { v = String(getCustomLabel(fromFile) || "").trim(); } catch (_) { v = ""; }
    if (v) return v;
  }
  return "";
}

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

function _baseName(p) {
  const s = String(p || "");
  if (!s) return "";
  const parts = s.split(/[\\/]/g);
  return parts[parts.length - 1] || s;
}

function _balanceFences(md) {
  const src = String(md ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!src) return "";
  const lines = src.split("\n");
  let open = "";
  for (const ln of lines) {
    const t = String(ln ?? "").trimEnd();
    const m = t.match(/^\s*(```+|~~~+)/);
    if (!m) continue;
    const fence = String(m[1] || "");
    if (!fence) continue;
    if (!open) {
      open = fence;
      continue;
    }
    // Only close when the fence char matches; other fences inside code blocks are just text.
    if (open[0] === fence[0] && fence.length >= open.length) open = "";
  }
  if (open) return `${src}\n${open}`;
  return src;
}

function _safeCodeFence(text, lang = "text") {
  const src = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!src) return "";
  let maxRun = 3;
  try {
    const runs = src.match(/`{3,}/g) || [];
    for (const r of runs) maxRun = Math.max(maxRun, String(r || "").length);
  } catch (_) {}
  const fence = "`".repeat(Math.max(4, maxRun + 1));
  const info = String(lang || "").trim();
  return `${fence}${info ? info : ""}\n${src}\n${fence}`;
}

const _DEFAULT_QUICK_BLOCKS = new Set(["user_message", "assistant_message", "reasoning_summary", "tool_gate", "update_plan"]);

function _getQuickBlocks(state) {
  try {
    const raw = state && state.quickViewBlocks ? state.quickViewBlocks : null;
    if (raw instanceof Set && raw.size > 0) return new Set(raw);
    if (Array.isArray(raw) && raw.length > 0) return new Set(raw.map((x) => String(x || "").trim()).filter(Boolean));
  } catch (_) {}
  return new Set(_DEFAULT_QUICK_BLOCKS);
}

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

function _classifyToolCallText(text) {
  const parsed = parseToolCallText(text || "");
  const argsRaw = String(parsed.argsRaw || "").trimEnd();
  const argsObj = safeJsonParse(argsRaw);
  const toolName = inferToolName(parsed.toolName || "", argsRaw, argsObj) || String(parsed.toolName || "");
  const callId = String(parsed.callId || "").trim();

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

  return { toolName, callId, argsRaw, argsObj, isPlanUpdate, planArgs };
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
  return ["<details>", `<summary>${s}</summary>`, "", b, "", "</details>"].join("\n").trimEnd();
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
  return `${head}${_safeCodeFence(pretty || "", lang)}`.trimEnd();
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
    if (runShort) blocks.push(_safeCodeFence(runShort, "text"));
    const detailParts = [];
    if (runLong && runLong !== runShort) detailParts.push(_safeCodeFence(runLong, "text"));
    if (patchText) detailParts.push(_safeCodeFence(patchText, "diff"));
    if (detailParts.length) blocks.push(_details("详情", detailParts.join("\n\n")));
    return blocks.join("\n\n").trimEnd();
  }

  if (toolName === "apply_patch") {
    const runShort = formatApplyPatchRun(argsRaw, outputBody, 8);
    const runLong = formatApplyPatchRun(argsRaw, outputBody, 200);
    const patchText = String(argsRaw || "").trim();
    const blocks = [];
    if (runShort) blocks.push(_safeCodeFence(runShort, "text"));
    const detailParts = [];
    if (runLong && runLong !== runShort) detailParts.push(_safeCodeFence(runLong, "text"));
    if (patchText) detailParts.push(_safeCodeFence(patchText, "diff"));
    if (detailParts.length) blocks.push(_details("详情", detailParts.join("\n\n")));
    return blocks.join("\n\n").trimEnd();
  }

  if (toolName === "view_image") {
    const p = (argsObj && typeof argsObj === "object") ? String(argsObj.path || "") : "";
    const base = (p.split(/[\\/]/).pop() || "").trim();
    const first = firstMeaningfulLine(outputBody) || "attached local image";
    const line = `• ${first}${base ? `: ${base}` : ``}`;
    return _safeCodeFence(line, "text");
  }

  const header = `• ${toolName || "tool_output"}`;
  const jsonOut = extractJsonOutputString(outputBody);
  const lines = normalizeNonEmptyLines(jsonOut || outputBody);
  const runShort = formatOutputTree(header, lines, 10);
  const runLong = formatOutputTree(header, lines, 120);
  const blocks = [];
  if (runShort) blocks.push(_safeCodeFence(runShort, "text"));
  if (runLong && runLong !== runShort) blocks.push(_details("详情", _safeCodeFence(runLong, "text")));
  return blocks.join("\n\n").trimEnd();
}

async function _ensureReasoningTranslated({ messages, threadId, maxN = 6, waitMs = 4500 }) {
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

  let queued = 0;
  for (const m of needs) {
    const id = String(m && m.id ? m.id : "").trim();
    if (!id) continue;
    try {
      const r = await fetch("/api/control/retranslate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }).then((x) => x.json()).catch(() => null);
      if (r && r.ok) queued += 1;
    } catch (_) {}
  }

  // Best-effort wait for updates to land (avoid blocking too long).
  const start = Date.now();
  let filled = 0;
  while ((Date.now() - start) < Math.max(0, Number(waitMs) || 0)) {
    try {
      const url = threadId
        ? `/api/messages?thread_id=${encodeURIComponent(threadId)}&t=${Date.now()}`
        : `/api/messages?t=${Date.now()}`;
      const r = await fetch(url, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      const ms = Array.isArray(r && r.messages) ? r.messages : [];
      const byId = new Map(ms.map((x) => [String(x && x.id ? x.id : ""), x]));
      filled = 0;
      for (const m of needs) {
        const id = String(m && m.id ? m.id : "").trim();
        if (!id) continue;
        const cur = byId.get(id);
        const zh = String(cur && cur.zh ? cur.zh : "").trim();
        if (zh) filled += 1;
      }
      if (filled >= needs.length) break;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 240));
  }
  return { ok: true, queued, filled, waited_ms: Date.now() - start };
}

function _renderReasoning(m, opts = {}) {
  const en = String((m && m.text) ? m.text : "").trimEnd();
  const zh = String((m && m.zh) ? m.zh : "").trimEnd();
  const err = String((m && m.translate_error) ? m.translate_error : "").trim();
  const mode = String(opts.lang || "auto").trim().toLowerCase();
  const hasZh = !!(zh && !err);
  if (mode === "en") return _balanceFences(en);
  if (mode === "zh") return _balanceFences(hasZh ? zh : en);
  if (mode === "both" && hasZh && en) {
    return _balanceFences([`### 中文`, "", zh, "", `### English`, "", en].join("\n").trimEnd());
  }
  if (mode === "toggle" && hasZh) {
    const parts = [];
    if (zh) parts.push(zh.trimEnd());
    if (en) {
      parts.push("");
      parts.push("<details>");
      parts.push("<summary>English</summary>");
      parts.push("");
      parts.push(en.trimEnd());
      parts.push("");
      parts.push("</details>");
    }
    return _balanceFences(parts.join("\n").trimEnd());
  }
  // auto: prefer zh when available, otherwise keep original.
  return _balanceFences(hasZh ? zh : en);
}

function _download(name, text) {
  const blob = new Blob([String(text || "")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  try { a.click(); } catch (_) {}
  setTimeout(() => {
    try { URL.revokeObjectURL(url); } catch (_) {}
    try { if (a.parentNode) a.parentNode.removeChild(a); } catch (_) {}
  }, 120);
}

export async function exportThreadMarkdown(state, key, opts = {}) {
  const k = String(key || "").trim();
  if (!k || k === "all") return { ok: false, error: "select_thread" };
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
  const quickBlocks = _getQuickBlocks(state);

  let messages = [];
  const thread = (state && state.threadIndex && typeof state.threadIndex.get === "function")
    ? (state.threadIndex.get(k) || {})
    : {};
  const threadId = String(thread.thread_id || "");
  const file = String(thread.file || "");

  try {
    const url = threadId ? `/api/messages?thread_id=${encodeURIComponent(threadId)}&t=${Date.now()}` : `/api/messages?t=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store" }).then(r => r.json());
    messages = Array.isArray(r && r.messages) ? r.messages : [];
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
    const tc = _classifyToolCallText(m && m.text ? m.text : "");
    if (!tc.callId) continue;
    callMeta.set(tc.callId, { tool_name: tc.toolName, args_raw: tc.argsRaw, args_obj: tc.argsObj });
  }

  // If user asked for translated thinking but we don't have zh yet, try to translate on export.
  // This makes “翻译”导出选项真正有差异（而不是取决于你之前是否点过某条思考）。
  let translateStat = null;
  try {
    const needThinking = (mode === "full") || (quickBlocks && quickBlocks.has("reasoning_summary"));
    if (needThinking && reasoningLang !== "en") {
      translateStat = await _ensureReasoningTranslated({ messages: selected, threadId, maxN: 6, waitMs: 4500 });
      if (translateStat && translateStat.filled >= 1) {
        const url = threadId ? `/api/messages?thread_id=${encodeURIComponent(threadId)}&t=${Date.now()}` : `/api/messages?t=${Date.now()}`;
        const r2 = await fetch(url, { cache: "no-store" }).then(r => r.json()).catch(() => null);
        const ms2 = Array.isArray(r2 && r2.messages) ? r2.messages : [];
        messages = ms2;
        const sel2 = threadId ? messages : messages.filter(m => keyOf(m) === k);
        sel2.sort((a, b) => (Number(a && a.seq) || 0) - (Number(b && b.seq) || 0));
        selected.length = 0;
        for (const x of sel2) selected.push(x);
      }
    }
  } catch (_) {}

  const now = new Date();
  const custom = _pickCustomLabel(k, threadId, file);
  const fileBase = _baseName(file);
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
        const tc0 = _classifyToolCallText(m && m.text ? m.text : "");
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
      const tc = _classifyToolCallText(m && m.text ? m.text : "");
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
      text = _balanceFences(raw);
    }
    idx += 1;
    const head = `## ${idx}. ${kindName}${tsLocal ? ` · ${tsLocal}` : ""}`;
    sections.push([head, "", text || ""].join("\n").trimEnd());
  }
  lines.push(sections.join("\n\n---\n\n"));

  const safeTitle = _sanitizeFileName(title) || "导出";
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

  _download(name, bodyLines.join("\n") + "\n");
  return { ok: true, mode, count: sections.length, translated: translateStat };
}

export async function exportCurrentThreadMarkdown(state, opts = {}) {
  const key = String((state && state.currentKey) ? state.currentKey : "").trim();
  return exportThreadMarkdown(state, key, opts);
}
