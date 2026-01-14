import { safeJsonParse } from "../utils.js";
import { normalizeNonEmptyLines, summarizeOutputLines, wrapTreeContent, normalizeTreeLine } from "./wrap.js";

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

