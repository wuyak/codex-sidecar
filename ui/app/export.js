import { getCustomLabel } from "./sidebar/labels.js";
import { keyOf, shortId } from "./utils.js";

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
  if (fileBase) lines.push(`> 源文件：${fileBase}`);
  const modeLabel = mode === "quick" ? "精简" : "全量";
  const thinkLabel = (reasoningLang === "en")
    ? "思考：原文"
    : (reasoningLang === "zh" || reasoningLang === "toggle")
      ? "思考：译文"
      : (reasoningLang === "both")
        ? "思考：双语"
        : "思考：自动";
  lines.push(`> 导出时间：${_fmtLocal(now)} · 模式：${modeLabel} · ${thinkLabel}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  const sections = [];
  let idx = 0;
  for (const m of selected) {
    const kind = String(m && m.kind ? m.kind : "");
    if (mode === "quick" && !allowKindsQuick.has(kind)) continue;
    idx += 1;
    const kindName = _kindLabel(kind);
    const tsLocal = _fmtMaybeLocal(m && m.ts ? m.ts : "");
    const head = `## ${idx}. ${kindName}${tsLocal ? ` · ${tsLocal}` : ""}`;

    let text = "";
    if (kind === "reasoning_summary") {
      text = _renderReasoning(m, { lang: reasoningLang });
    } else {
      const raw = String((m && m.text) ? m.text : "").trimEnd();
      if (mode === "full" && (kind === "tool_call" || kind === "tool_output")) {
        text = _safeCodeFence(raw, "text");
      } else {
        text = _balanceFences(raw);
      }
    }
    sections.push([head, "", text || ""].join("\n").trimEnd());
  }
  lines.push(sections.join("\n\n---\n\n"));

  const labelBase = title ? _sanitizeFileName(title) : "";
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
