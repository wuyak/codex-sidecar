export function safeJsonParse(s) {
  let raw = String(s ?? "").trim();
  if (!raw) return null;

  const stripFences = (txt) => {
    const t = String(txt ?? "").trim();
    if (!t.startsWith("```")) return t;
    const lines = t.split("\n");
    if (lines.length < 3) return t;
    let end = -1;
    for (let i = lines.length - 1; i >= 1; i--) {
      if (String(lines[i] ?? "").trim().startsWith("```")) { end = i; break; }
    }
    if (end > 1) return lines.slice(1, end).join("\n").trim();
    return t;
  };

  const extractFirstFencedBlock = (txt) => {
    const lines = String(txt ?? "").split("\n");
    let start = -1;
    let end = -1;
    for (let i = 0; i < lines.length; i++) {
      if (String(lines[i] ?? "").trim().startsWith("```")) { start = i; break; }
    }
    if (start < 0) return "";
    for (let i = start + 1; i < lines.length; i++) {
      if (String(lines[i] ?? "").trim().startsWith("```")) { end = i; break; }
    }
    if (end > start + 1) return lines.slice(start + 1, end).join("\n").trim();
    return "";
  };

  raw = stripFences(raw);

  // 兼容：某些 tool_call 会把 JSON 包在 ```json ... ``` 里，或在前面加一行标签（例如 "args:"）。
  if (!(raw.startsWith("{") || raw.startsWith("["))) {
    const fenced = extractFirstFencedBlock(raw);
    if (fenced) raw = stripFences(fenced);
  }
  if (!(raw.startsWith("{") || raw.startsWith("["))) {
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const t = String(lines[i] ?? "").trimStart();
      if (!t) continue;
      if (t.startsWith("{") || t.startsWith("[")) {
        raw = lines.slice(i).join("\n").trim();
        break;
      }
    }
  }

  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try { return JSON.parse(raw); } catch (_e) { return null; }
}

export function extractJsonOutputString(s) {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  const obj = safeJsonParse(raw);
  if (obj && typeof obj === "object") {
    if (typeof obj.output === "string") return String(obj.output || "");
    if (typeof obj.stdout === "string") return String(obj.stdout || "");
    if (typeof obj.message === "string") return String(obj.message || "");
  }
  return "";
}
