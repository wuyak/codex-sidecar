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
  return `## ${ts ? ts + " · " : ""}${kind}`;
}

function _wrapMaybeFence(kind, text) {
  const k = String(kind || "");
  const s = String(text || "").trimEnd();
  if (!s) return "";
  if (k === "reasoning_summary") {
    return ["```text", s, "```"].join("\n");
  }
  return s;
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

  const lines = [];
  lines.push(`# Codex Sidecar 导出（${mode === "quick" ? "精简" : "全量"}）`);
  lines.push("");
  lines.push(`- key: ${k}`);
  if (threadId) lines.push(`- thread_id: ${threadId}`);
  if (file) lines.push(`- file: ${file}`);
  lines.push(`- exported_at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const m of selected) {
    const kind = String(m && m.kind ? m.kind : "");
    if (mode === "quick" && !allowKindsQuick.has(kind)) continue;
    const text = _wrapMaybeFence(kind, m && m.text);
    lines.push(_formatHeader(m));
    lines.push("");
    if (text) lines.push(text);
    lines.push("");
  }

  const custom = String(getCustomLabel(k) || "").trim();
  const labelBase = custom ? _sanitizeFileName(custom) : "";
  const idBase = _sanitizeFileName(threadId ? shortId(threadId) : (k.split("/").slice(-1)[0] || k));
  const base = labelBase || idBase || "thread";
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const name = `codex-sidecar_${base}${labelBase && idBase && labelBase !== idBase ? `_${idBase}` : ""}_${stamp}.md`;
  _download(name, lines.join("\n").trim() + "\n");
  return { ok: true, mode, count: selected.length };
}

export async function exportCurrentThreadMarkdown(state, opts = {}) {
  const key = String((state && state.currentKey) ? state.currentKey : "").trim();
  return exportThreadMarkdown(state, key, opts);
}
