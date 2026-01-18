import { getCustomLabel } from "./sidebar/labels.js";
import { keyOf, shortId } from "./utils.js";

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
  // 兼容：调用方未传 opts 时，使用本地导出偏好（精简/翻译）。
  // 导出偏好由 UI 写入 localStorage（wire.js），这里做兜底读取，避免“设置不生效”。
  try {
    if (opts && (opts.mode == null || opts.reasoningLang == null) && typeof localStorage !== 'undefined') {
      const _bool = (v, fallback) => {
        if (v == null) return fallback;
        const s = String(v).trim().toLowerCase();
        if (s === '1' || s === 'true' || s === 'yes' || s === 'on') return true;
        if (s === '0' || s === 'false' || s === 'no' || s === 'off') return false;
        return fallback;
      };

      const quickPref = _bool(localStorage.getItem('codex_sidecar_export_quick_v1'), true);
      const translatePref = _bool(localStorage.getItem('codex_sidecar_export_translate_v1'), true);

      if (opts.mode == null) opts.mode = quickPref ? 'quick' : 'full';
      if (opts.reasoningLang == null) opts.reasoningLang = translatePref ? 'both' : 'en';
    }
  } catch (e) {
    // ignore
  }

  const k = String(key || "").trim();
  if (!k || k === "all") return { ok: false, error: "select_thread" };

  const mode = String(opts.mode || "").trim().toLowerCase() === "full" ? "full" : "quick";
  const allowKindsQuick = new Set(["user_message", "assistant_message"]);
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

  // If user asked for translated thinking but we don't have zh yet, try to translate on export.
  // This makes “翻译”导出选项真正有差异（而不是取决于你之前是否点过某条思考）。
  let translateStat = null;
  try {
    if (reasoningLang !== "en") {
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

  const labelBase = custom ? _sanitizeFileName(custom) : "";
  const idForName = threadId ? _shortIdForFile(threadId) : _shortIdForFile(_extractUuid(k) || (k.split("/").slice(-1)[0] || k));
  const idBase = _sanitizeFileName(idForName);
  const base = labelBase ? `${labelBase}_${idBase || "thread"}` : (idBase || "thread");
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const name = `codex-sidecar_${base}_${stamp}.md`;
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
  return { ok: true, mode, count: selected.length, translated: translateStat };
}

export async function exportCurrentThreadMarkdown(state, opts = {}) {
  const key = String((state && state.currentKey) ? state.currentKey : "").trim();
  return exportThreadMarkdown(state, key, opts);
}
