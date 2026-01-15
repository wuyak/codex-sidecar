import { keyOf, shortId } from "./utils.js";

function _sanitizeFileName(s) {
  return String(s || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 80);
}

function _kindLabel(kind) {
  const k = String(kind || "");
  if (k === "user_message") return "用户输入";
  if (k === "assistant_message") return "输出";
  if (k === "reasoning_summary") return "思考";
  if (k === "agent_reasoning") return "思考(实时)";
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
  if (k === "reasoning_summary" || k === "agent_reasoning") {
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

export async function exportCurrentThreadMarkdown(state, opts = {}) {
  const key = String((state && state.currentKey) ? state.currentKey : "").trim();
  if (!key || key === "all") return { ok: false, error: "select_thread" };

  const mode = String(opts.mode || "").trim().toLowerCase() === "full" ? "full" : "quick";
  const allowKindsQuick = new Set(["user_message", "assistant_message", "reasoning_summary", "agent_reasoning"]);

  let messages = [];
  try {
    const r = await fetch(`/api/messages?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json());
    messages = Array.isArray(r && r.messages) ? r.messages : [];
  } catch (_) {
    return { ok: false, error: "fetch_failed" };
  }

  const selected = messages.filter(m => keyOf(m) === key);
  selected.sort((a, b) => (Number(a && a.seq) || 0) - (Number(b && b.seq) || 0));

  const thread = (state && state.threadIndex && typeof state.threadIndex.get === "function")
    ? (state.threadIndex.get(key) || {})
    : {};
  const threadId = String(thread.thread_id || "");
  const file = String(thread.file || "");

  const lines = [];
  lines.push(`# Codex Sidecar 导出（${mode === "quick" ? "精简" : "全量"}）`);
  lines.push("");
  lines.push(`- key: ${key}`);
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

  const base = _sanitizeFileName(threadId ? shortId(threadId) : (key.split("/").slice(-1)[0] || key));
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const name = `codex-sidecar_${base || "thread"}_${stamp}.md`;
  _download(name, lines.join("\n").trim() + "\n");
  return { ok: true, mode, count: selected.length };
}

