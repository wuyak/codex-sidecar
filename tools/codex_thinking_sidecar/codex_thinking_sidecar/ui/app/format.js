import { escapeHtml, extractJsonOutputString, safeJsonParse } from "./utils.js";

export function statusIcon(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed" || s === "done") return "✅";
  if (s === "in_progress" || s === "running") return "▶";
  if (s === "pending" || s === "todo") return "⏳";
  if (s === "canceled" || s === "cancelled") return "🚫";
  if (s === "failed" || s === "error") return "❌";
  return "•";
}

export function parseToolCallText(text) {
  const lines = String(text ?? "").split("\n");
  const known = ["shell_command", "apply_patch", "view_image", "update_plan", "web_search_call"];

  let toolName = "";
  for (const ln of lines) {
    const t = String(ln ?? "").trim();
    if (!t) continue;
    toolName = t;
    break;
  }

  let callId = "";
  let callIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] ?? "").trim();
    if (!t) continue;
    let m = t.match(/^call_id\s*[=:\uFF1A]\s*([^\s]+)\s*$/);
    if (m) { callId = String(m[1] ?? "").trim(); callIdx = i; break; }
    m = t.match(/call_id\s*[=:\uFF1A]\s*([A-Za-z0-9_-]+)/);
    if (m) { callId = String(m[1] ?? "").trim(); callIdx = i; break; }
  }

  // If the first line isn't a plain tool name (rare variants), try to detect known tool names.
  if (toolName && !known.includes(toolName) && (toolName.startsWith("tool_call") || toolName.includes("tool_call"))) {
    for (const k of known) {
      if (String(text ?? "").includes(k)) { toolName = k; break; }
    }
  }

  // Heuristic: find the real payload start.
  //
  // - apply_patch: payload often begins with "*** Begin Patch"
  // - shell_command/update_plan: payload often begins with JSON "{...}"
  // - Some formats may put call_id after the payload; do not assume ordering.
  let payloadIdx = -1;
  // 1) Strong marker: apply_patch patch body
  for (let i = 1; i < lines.length; i++) {
    const t = String(lines[i] ?? "").trimStart();
    if (!t) continue;
    if (t === "原始参数" || t === "参数") continue;
    if (t.startsWith("*** Begin Patch")) { payloadIdx = i; break; }
  }
  // 2) JSON payload (shell_command/update_plan variants)
  if (payloadIdx < 0) {
    for (let i = 1; i < lines.length; i++) {
      const t = String(lines[i] ?? "").trimStart();
      if (!t) continue;
      if (t === "原始参数" || t === "参数") continue;
      if (t.startsWith("{") || t.startsWith("[")) { payloadIdx = i; break; }
    }
  }

  let idx = 1;
  if (payloadIdx >= 0) idx = payloadIdx;
  else if (callIdx >= 0) idx = callIdx + 1;
  // Prefer the first JSON-ish line after idx (useful for "原始参数" variants).
  for (let i = idx; i < lines.length; i++) {
    const t = String(lines[i] ?? "").trimStart();
    if (!t) continue;
    if (t === "原始参数" || t === "参数") continue;
    if (t.startsWith("{") || t.startsWith("[")) { idx = i; break; }
    // Otherwise keep idx as-is.
    break;
  }
  const argsRaw = lines.slice(idx).join("\n").trimEnd();
  return { toolName, callId, argsRaw };
}

export function inferToolName(toolName, argsRaw, argsObj) {
  const t = String(toolName || "").trim();
  const raw = String(argsRaw || "");
  // If already looks like a real tool name, keep it.
  if (t && !t.startsWith("tool_call") && !t.startsWith("tool_output") && t !== "tool_call") return t;
  // Heuristics for legacy / variant formats.
  if (raw.includes("*** Begin Patch")) return "apply_patch";
  try {
    if (argsObj && typeof argsObj === "object") {
      if (Array.isArray(argsObj.plan) || (Array.isArray(argsObj.plan) && typeof argsObj.explanation === "string")) return "update_plan";
      if (typeof argsObj.command === "string") return "shell_command";
      if (typeof argsObj.path === "string") return "view_image";
    }
  } catch (_) {}
  return t;
}

export function parseToolOutputText(text) {
  const lines = String(text ?? "").split("\n");
  let callId = "";
  for (let i = 0; i < lines.length; i++) {
    const t = String(lines[i] ?? "").trim();
    if (!t) continue;
    let m = t.match(/^call_id\s*[=:\uFF1A]\s*([^\s]+)\s*$/);
    if (m) { callId = String(m[1] ?? "").trim(); break; }
    m = t.match(/call_id\s*[=:\uFF1A]\s*([A-Za-z0-9_-]+)/);
    if (m) { callId = String(m[1] ?? "").trim(); break; }
  }
  const kept = [];
  for (const ln of lines) {
    const t = String(ln ?? "").trim();
    if (t && /^call_id\s*[=:\uFF1A]/.test(t)) continue;
    kept.push(String(ln ?? ""));
  }
  const outputRaw = kept.join("\n").replace(/^\n+/, "");
  return { callId, outputRaw };
}

export function summarizeCommand(cmd, maxLen = 96) {
  const lines = String(cmd ?? "").split("\n");
  const skip = (t) => {
    const s = String(t || "").trim();
    if (!s) return true;
    if (s.startsWith("#!")) return true;
    if (s.startsWith("#")) return true;
    if (s.startsWith("set -")) return true; // 常见 bash prologue（如 set -euo pipefail）
    return false;
  };
  let line = "";
  for (const ln of lines) {
    if (skip(ln)) continue;
    line = String(ln || "").trim();
    break;
  }
  if (!line) line = String(cmd ?? "").split("\n")[0].trim();
  if (!line) return "";
  if (line.length <= maxLen) return line;
  return line.slice(0, Math.max(0, maxLen - 1)) + "…";
}

export function commandPreview(cmd, maxLen = 220) {
  const lines = String(cmd ?? "").split("\n");
  const skip = (t) => {
    const s = String(t || "").trim();
    if (!s) return true;
    if (s.startsWith("#!")) return true;
    if (s.startsWith("#")) return true;
    if (s.startsWith("set -")) return true;
    return false;
  };
  const kept = [];
  for (const ln of lines) {
    if (skip(ln)) continue;
    kept.push(String(ln || "").trim());
  }
  if (kept.length === 0) return summarizeCommand(cmd, maxLen);
  let s = kept[0];
  if (kept.length > 1) s += ` (… +${kept.length - 1} 行)`;
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + "…";
}

export function wrapWords(text, width = 78) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const words = raw.split(/\s+/).filter(Boolean);
  const out = [];
  let line = "";
  const push = () => { if (line) out.push(line); line = ""; };
  for (const w of words) {
    if (w.length > width) {
      push();
      for (let i = 0; i < w.length; i += width) out.push(w.slice(i, i + width));
      continue;
    }
    if (!line) { line = w; continue; }
    if ((line + " " + w).length <= width) line += " " + w;
    else { push(); line = w; }
  }
  push();
  return out;
}

export function normalizeNonEmptyLines(s) {
  const lines = String(s ?? "").split("\n");
  // trim leading/trailing empties
  let a = 0;
  let b = lines.length;
  while (a < b && !String(lines[a] || "").trim()) a++;
  while (b > a && !String(lines[b - 1] || "").trim()) b--;
  const out = [];
  let blankRun = 0;
  for (const raw of lines.slice(a, b)) {
    const ln = String(raw ?? "").replace(/\s+$/g, "");
    if (!ln.trim()) {
      blankRun += 1;
      if (blankRun > 1) continue;
      out.push("");
      continue;
    }
    blankRun = 0;
    out.push(ln);
  }
  return out;
}

export function excerptLines(lines, maxLines = 6) {
  const xs = Array.isArray(lines) ? lines : [];
  if (xs.length <= maxLines) return { lines: xs, truncated: false };
  const head = xs.slice(0, 3);
  const tail = xs.slice(-3);
  return { lines: head.concat(["…（展开查看更多）"], tail), truncated: true };
}

export function wrapCommandForDisplay(cmdOne, width = 78) {
  const raw = String(cmdOne ?? "").trim();
  if (!raw) return [];
  const words = raw.split(/\s+/).filter(Boolean);
  const splitTokens = (xs, sep) => {
    const out = [];
    let cur = [];
    for (const w of xs) {
      if (w === sep) {
        if (cur.length) out.push(cur);
        cur = [w];
        continue;
      }
      cur.push(w);
    }
    if (cur.length) out.push(cur);
    return out;
  };

  // Prefer breaking at control operators/pipes for readability.
  let segs = [words];
  for (const sep of ["||", "&&", "|"]) {
    const next = [];
    for (const seg of segs) {
      if (seg.includes(sep)) next.push(...splitTokens(seg, sep));
      else next.push(seg);
    }
    segs = next;
  }

  const lines = [];
  for (const seg of segs) {
    const s = seg.join(" ").trim();
    if (!s) continue;
    const wrapped = wrapWords(s, width);
    for (const w of wrapped) lines.push(w);
  }
  if (lines.length) return lines;
  return wrapWords(raw, width);
}

export function wrapTreeContent(line, width = 74) {
  const raw = String(line ?? "");
  if (!raw) return [];
  if (raw.length <= width) return [raw];
  const out = [];
  let rest = raw;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut < 12) cut = width;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\s+/, "");
  }
  if (rest) out.push(rest);
  return out;
}

export function normalizeTreeLine(line) {
  const s = String(line ?? "");
  // Reduce ugly indentation for typical `nl -ba` / line-numbered outputs.
  if (/^\s+\d+(\s|$)/.test(s)) return s.replace(/^\s+/, "");
  return s;
}

function countEscapedNewlines(s) {
  try {
    const m = String(s ?? "").match(/\n/g);
    return m ? m.length : 0;
  } catch (_) {
    return 0;
  }
}

export function formatRgOutput(lines, maxHits = 1) {
  const xs = Array.isArray(lines) ? lines : [];
  const out = [];
  let used = 0;
  for (const ln of xs) {
    if (used >= maxHits) break;
    const m = String(ln ?? "").match(/^(.+?):(\d+):(.*)$/);
    if (m && m[1] && String(m[1]).includes("/")) {
      const path = String(m[1] || "");
      const rest = String(m[3] || "");
      const parts = path.split("/");
      const base = parts.pop() || path;
      const dir = (parts.join("/") + "/") || path;
      out.push(dir);
      out.push(`${base}:`);
      const n = countEscapedNewlines(rest);
      if (n > 0) out.push(`… +${n} lines`);
    } else {
      out.push(String(ln ?? ""));
    }
    used += 1;
  }
  const remaining = xs.length - used;
  if (remaining > 0) out.push(`… +${remaining} matches`);
  return out;
}

export function summarizeOutputLines(lines, maxLines = 6) {
  const xs = Array.isArray(lines) ? lines : [];
  const clipped = xs.map((ln) => {
    const s = String(ln ?? "");
    if (s.length <= 240) return s;
    return s.slice(0, 239) + "…";
  });
  if (clipped.length <= maxLines) return clipped;
  const head = clipped.slice(0, maxLines);
  const remaining = clipped.length - maxLines;
  return head.concat([`… +${remaining} lines`]);
}

export function formatShellRun(cmdFull, outputBody, exitCode) {
  const cmdOne = commandPreview(cmdFull, 400);
  const outAll = normalizeNonEmptyLines(outputBody);
  const cmdWrap = wrapCommandForDisplay(cmdOne, 78);
  const firstCmd = String(cmdOne ?? "").trim();
  const isRg = /^rg\b/.test(firstCmd);
  const pick = (outAll.length > 0)
    ? (isRg ? formatRgOutput(outAll, 1) : summarizeOutputLines(outAll, 6))
    : [];
  const lines = [];
  if (cmdWrap.length > 0) {
    lines.push(`• Ran ${cmdWrap[0]}`);
    for (let i = 1; i < cmdWrap.length; i++) lines.push(`  │ ${cmdWrap[i]}`);
  } else {
    lines.push("• Ran shell_command");
  }
  if (pick.length > 0) {
    const p0 = wrapTreeContent(normalizeTreeLine(pick[0]), 74);
    if (p0.length > 0) {
      lines.push(`  └ ${p0[0]}`);
      for (let j = 1; j < p0.length; j++) lines.push(`     ${p0[j]}`);
    } else {
      lines.push("  └ (no output)");
    }
    for (let i = 1; i < pick.length; i++) {
      const ps = wrapTreeContent(normalizeTreeLine(pick[i]), 74);
      for (const seg of ps) lines.push(`     ${seg}`);
    }
  } else if (exitCode !== null && exitCode !== 0) {
    lines.push("  └ (no output)");
  } else {
    lines.push("  └ (no output)");
  }
  return lines.join("\n");
}

export function formatShellRunExpanded(cmdFull, outputBody, exitCode) {
  const cmdOne = commandPreview(cmdFull, 400);
  const outAll = normalizeNonEmptyLines(outputBody);
  const cmdWrap = wrapCommandForDisplay(cmdOne, 78);
  const firstCmd = String(cmdOne ?? "").trim();
  const isRg = /^rg\b/.test(firstCmd);
  const pick = (outAll.length > 0)
    ? (isRg ? formatRgOutput(outAll, 12) : summarizeOutputLines(outAll, 120))
    : [];
  const lines = [];
  if (cmdWrap.length > 0) {
    lines.push(`• Ran ${cmdWrap[0]}`);
    for (let i = 1; i < cmdWrap.length; i++) lines.push(`  │ ${cmdWrap[i]}`);
  } else {
    lines.push("• Ran shell_command");
  }
  if (pick.length > 0) {
    const p0 = wrapTreeContent(normalizeTreeLine(pick[0]), 74);
    if (p0.length > 0) {
      lines.push(`  └ ${p0[0]}`);
      for (let j = 1; j < p0.length; j++) lines.push(`     ${p0[j]}`);
    } else {
      lines.push("  └ (no output)");
    }
    for (let i = 1; i < pick.length; i++) {
      const ps = wrapTreeContent(normalizeTreeLine(pick[i]), 74);
      for (const seg of ps) lines.push(`     ${seg}`);
    }
  } else if (exitCode !== null && exitCode !== 0) {
    lines.push("  └ (no output)");
  } else {
    lines.push("  └ (no output)");
  }
  return lines.join("\n");
}

export function summarizeApplyPatchFiles(argsRaw) {
  const lines = String(argsRaw ?? "").split("\n");
  const out = [];
  const rx = /^\*\*\*\s+(Add File|Update File|Delete File):\s+(.+)$/;
  for (const ln of lines) {
    const m = String(ln ?? "").match(rx);
    if (!m) continue;
    const path = String(m[2] ?? "").trim();
    if (!path) continue;
    out.push(path);
  }
  return Array.from(new Set(out));
}

export function extractApplyPatchOutputText(outputBody) {
  const raw = String(outputBody ?? "").trim();
  if (!raw) return "";
  const obj = safeJsonParse(raw);
  if (obj && typeof obj === "object" && typeof obj.output === "string") return String(obj.output || "");
  return raw;
}

export function formatOutputTree(headerLine, lines, maxLines = 12) {
  const xs = Array.isArray(lines) ? lines : normalizeNonEmptyLines(String(lines ?? ""));
  const pick = summarizeOutputLines(xs, maxLines);
  const out = [];
  out.push(headerLine || "• Output");
  if (pick.length === 0) {
    out.push("  └ (no output)");
    return out.join("\n");
  }
  const p0 = wrapTreeContent(normalizeTreeLine(pick[0]), 74);
  if (p0.length > 0) {
    out.push(`  └ ${p0[0]}`);
    for (let j = 1; j < p0.length; j++) out.push(`     ${p0[j]}`);
  } else {
    out.push("  └ (no output)");
  }
  for (let i = 1; i < pick.length; i++) {
    const ps = wrapTreeContent(normalizeTreeLine(pick[i]), 74);
    for (const seg of ps) out.push(`     ${seg}`);
  }
  return out.join("\n");
}

export function formatApplyPatchRun(argsRaw, outputBody, maxLines = 10) {
  const files = summarizeApplyPatchFiles(argsRaw);
  const fileNote = (files.length === 1) ? ` (${files[0]})` : (files.length > 1 ? ` (${files.length} files)` : "");
  const text = extractApplyPatchOutputText(outputBody);
  const lines = normalizeNonEmptyLines(text);
  return formatOutputTree(`• Applied patch${fileNote}`, lines, maxLines);
}

export function isCodexEditSummary(text) {
  const s = String(text ?? "");
  return /(^|\n)•\s+(Edited|Added|Deleted|Created|Updated|Removed)\s+/m.test(s);
}

export function joinWrappedExcerptLines(lines) {
  const xs = Array.isArray(lines) ? lines.map(x => String(x ?? "")) : [];
  const out = [];
  for (const ln of xs) {
    const t = String(ln ?? "");
    const isContinuation = /^\s{6,}\S/.test(t) && !/^\s*\d+\s/.test(t) && !/^\s*\(\+/.test(t) && !/^\s*•\s+/.test(t);
    if (isContinuation && out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]} ${t.trim()}`;
    } else {
      out.push(t);
    }
  }
  return out;
}

export function parseCodexEditSummary(text) {
  const lines = String(text ?? "").split("\n");
  const sections = [];
  let cur = null;
  const flush = () => { if (cur) sections.push(cur); cur = null; };
  for (const ln of lines) {
    const m = ln.match(/^•\s+(Edited|Added|Deleted|Created|Updated|Removed)\s+(.+?)\s*$/);
    if (m) {
      flush();
      cur = { action: m[1], path: m[2], stats: "", excerpt: [] };
      continue;
    }
    if (cur && !cur.stats && /^\(\+\d+\s+-\d+\)\s*$/.test(String(ln || "").trim())) {
      cur.stats = String(ln || "").trim();
      continue;
    }
    if (cur) cur.excerpt.push(ln);
  }
  flush();
  return sections;
}

export function actionZh(action) {
  const a = String(action || "");
  if (a === "Edited") return "修改";
  if (a === "Added" || a === "Created") return "新增";
  if (a === "Deleted" || a === "Removed") return "删除";
  if (a === "Updated") return "更新";
  return a;
}

export function diffClassForLine(ln) {
  const s = String(ln ?? "");
  // Unified diff / patches
  if (s.startsWith("@@")) return "diff-ellipsis";
  if (s.startsWith("+") && !s.startsWith("+++")) return "diff-add";
  if (s.startsWith("-") && !s.startsWith("---")) return "diff-del";
  const m = s.match(/^\s*\d+\s+([+-])\s/);
  if (m) return (m[1] === "+") ? "diff-add" : "diff-del";
  if (s.includes("⋮") || s.includes("…")) return "diff-ellipsis";
  return "";
}

export function renderDiffText(text) {
  const lines = String(text ?? "").split("\n");
  return renderDiffBlock(lines);
}

export function renderDiffBlock(lines) {
  const xs = Array.isArray(lines) ? lines : [];
  const html = [];
  for (const ln of xs) {
    const cls = diffClassForLine(ln);
    html.push(`<span class="diff-line ${cls}">${escapeHtml(ln)}</span>`);
  }
  // Each line is already a block; avoid inserting extra newlines that become blank lines.
  return html.join("");
}

export function renderCodexEditSummary(text) {
  const sections = parseCodexEditSummary(text);
  if (!sections.length) return "";
  const blocks = [];
  for (const sec of sections) {
    const exJoined = joinWrappedExcerptLines(sec.excerpt);
    const exLines = normalizeNonEmptyLines(exJoined.join("\n"));
    const shown = excerptLines(exLines, 14).lines;
    const actionLabel = actionZh(sec.action);
    blocks.push(`
      <div class="tool-card">
        <div class="change-head">
          <span class="pill">${escapeHtml(actionLabel)}</span>
          <code>${escapeHtml(sec.path)}</code>
          ${sec.stats ? `<span class="meta">${escapeHtml(sec.stats)}</span>` : ``}
        </div>
        <pre class="code">${renderDiffBlock(shown)}</pre>
      </div>
    `);
  }
  return blocks.join("\n");
}

export function extractExitCode(outputRaw) {
  const lines = String(outputRaw ?? "").split("\n");
  for (const ln of lines) {
    if (ln.startsWith("Exit code:")) {
      const v = ln.split(":", 2)[1] || "";
      const n = parseInt(v.trim(), 10);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export function extractWallTime(outputRaw) {
  const lines = String(outputRaw ?? "").split("\n");
  for (const ln of lines) {
    if (ln.startsWith("Wall time:")) {
      const v = ln.split(":", 2)[1] || "";
      return v.trim();
    }
  }
  return "";
}

export function extractOutputBody(outputRaw) {
  const lines = String(outputRaw ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] || "").trim() === "Output:") {
      const body = lines.slice(i + 1).join("\n");
      return body.replace(/^\n+/, "");
    }
  }
  return String(outputRaw ?? "");
}

export function firstMeaningfulLine(s) {
  const lines = String(s ?? "").split("\n");
  for (const ln of lines) {
    const t = ln.trim();
    if (!t) continue;
    if (t.startsWith("call_id=")) continue;
    return t;
  }
  return "";
}
