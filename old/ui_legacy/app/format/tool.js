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
  // Normalize tool names that may be recorded with namespace prefixes (Codex CLI variants),
  // e.g. "functions.update_plan" / "functions.shell_command".
  toolName = String(toolName || "").replace(/^functions\./, "").replace(/^multi_tool_use\./, "");

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
  let t = String(toolName || "").trim();
  // Normalize namespace prefixes (keep behavior stable across Codex CLI variants).
  t = t.replace(/^functions\./, "").replace(/^multi_tool_use\./, "");
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
