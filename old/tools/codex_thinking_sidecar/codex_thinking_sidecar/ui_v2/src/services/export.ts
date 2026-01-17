import type { SidecarMessage, SidecarThread } from "../api/types";
import { api } from "../api/client";
import { keyOf, shortId } from "../utils/ids";

function sanitizeFileName(s: string): string {
  return String(s || "")
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, 80);
}

function kindLabel(kind: string): string {
  const k = String(kind || "");
  if (k === "user_message") return "用户输入";
  if (k === "assistant_message") return "输出";
  if (k === "reasoning_summary") return "思考";
  if (k === "tool_gate") return "终端确认";
  if (k === "tool_call") return "工具调用";
  if (k === "tool_output") return "工具输出";
  return k || "unknown";
}

function formatHeader(t: SidecarMessage): string {
  const ts = String((t && t.ts) ? t.ts : "");
  const kind = kindLabel(String(t?.kind || ""));
  return `## ${ts ? `${ts} · ` : ""}${kind}`;
}

function wrapMaybeFence(kind: string, text: string): string {
  const k = String(kind || "");
  const s = String(text || "").trimEnd();
  if (!s) return "";
  if (k === "reasoning_summary") return ["```text", s, "```"].join("\n");
  return s;
}

function download(name: string, text: string): void {
  const blob = new Blob([String(text || "")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } catch (_) {}
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url);
    } catch (_) {}
    try {
      if (a.parentNode) a.parentNode.removeChild(a);
    } catch (_) {}
  }, 120);
}

export async function exportCurrentThreadMarkdown(
  threadKey: string,
  threadIndex: Map<string, SidecarThread>,
  mode: "quick" | "full",
): Promise<{ ok: boolean; error?: string; count?: number }> {
  const key = String(threadKey || "").trim();
  if (!key || key === "all") return { ok: false, error: "select_thread" };

  const allowKindsQuick = new Set(["user_message", "assistant_message", "reasoning_summary"]);

  const r = await api.getMessages(undefined);
  const messages = Array.isArray(r.messages) ? r.messages : [];

  const selected = messages.filter((m) => keyOf(m) === key);
  selected.sort((a, b) => (Number(a && a.seq) || 0) - (Number(b && b.seq) || 0));

  const thread = threadIndex.get(key) || ({} as SidecarThread);
  const threadId = String((thread as any).thread_id || "");
  const file = String((thread as any).file || "");

  const lines: string[] = [];
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
    const text = wrapMaybeFence(kind, String((m as any).text || ""));
    lines.push(formatHeader(m));
    lines.push("");
    if (text) lines.push(text);
    lines.push("");
  }

  const base = sanitizeFileName(threadId ? shortId(threadId) : (key.split("/").slice(-1)[0] || key));
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const name = `codex-sidecar_${base || "thread"}_${stamp}.md`;
  download(name, `${lines.join("\n").trim()}\n`);
  return { ok: true, mode, count: selected.length };
}
