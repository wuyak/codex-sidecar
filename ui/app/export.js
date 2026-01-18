import { getCustomLabel } from "./sidebar/labels.js";
import { keyOf, shortId } from "./utils.js";

function _sanitizeFileName(s) {
  return String(s || "")
    .trim()
    .replaceAll(/[^\p{L}\p{N}._-]+/gu, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 80);
}

function _kindLabel(kind) {
  const k = String(kind || "");
  if (k === "user_message") return "用户输入";
  if (k === "assistant_message") return "输出";
  if (k === "reasoning_summary") return "思考";
  if (k === "tool_gate") return "终端确认";
  if (k === "tool_call") return "工具调用";
  if (k === "tool_output") return "工具输出";
  return k || "unknown";
}

function _formatHeader(t) {
  const ts = String((t && t.ts) ? t.ts : "");
  const kind = _kindLabel(t && t.kind);
  return `**${kind}${ts ? ` · ${ts}` : ""}**`;
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
  let fenceToggles = 0;
  for (const ln of lines) {
    if (/^\s*```/.test(String(ln ?? "").trimEnd())) fenceToggles += 1;
  }
  if (fenceToggles % 2 === 1) return `${src}\n\`\`\``;
  return src;
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

  const mode = String(opts.mode || "").trim().toLowerCase() === "full" ? "full" : "quick";
  const allowKindsQuick = new Set(["user_message", "assistant_message", "reasoning_summary"]);
  const reasoningLang = String(opts.reasoningLang || "auto").trim().toLowerCase();

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

  const now = new Date();
  const custom = String(getCustomLabel(k) || "").trim();
  const fileBase = _baseName(file);
  const title = custom || fileBase || (threadId ? shortId(threadId) : shortId(k)) || "导出";

  const lines = [];
  lines.push(`# ${title}`);
  if (fileBase) lines.push(`> 原始文件：${fileBase}`);
  lines.push(`> 导出时间：${_fmtLocal(now)}${mode === "quick" ? " · 精简" : ""}`);
  lines.push("---");
  lines.push("");

  for (const m of selected) {
    const kind = String(m && m.kind ? m.kind : "");
    if (mode === "quick" && !allowKindsQuick.has(kind)) continue;
    const text = (kind === "reasoning_summary")
      ? _renderReasoning(m, { lang: reasoningLang })
      : _balanceFences(String((m && m.text) ? m.text : "").trimEnd());
    const head = _formatHeader(m);
    if (head) lines.push(head);
    lines.push("");
    if (text) lines.push(text);
    lines.push("");
  }

  const labelBase = custom ? _sanitizeFileName(custom) : "";
  const idBase = _sanitizeFileName(threadId ? shortId(threadId) : (k.split("/").slice(-1)[0] || k));
  const base = labelBase || idBase || "thread";
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const name = `codex-sidecar_${base}_${stamp}.md`;
  _download(name, lines.join("\n").trim() + "\n");
  return { ok: true, mode, count: selected.length };
}

export async function exportCurrentThreadMarkdown(state, opts = {}) {
  const key = String((state && state.currentKey) ? state.currentKey : "").trim();
  return exportThreadMarkdown(state, key, opts);
}
