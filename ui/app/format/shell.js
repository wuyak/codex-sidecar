import { commandPreview, formatRgOutput, normalizeNonEmptyLines, normalizeTreeLine, summarizeOutputLines, wrapCommandForDisplay, wrapTreeContent } from "./wrap.js";

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

