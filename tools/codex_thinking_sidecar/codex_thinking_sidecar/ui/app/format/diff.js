import { escapeHtml } from "../utils.js";

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

