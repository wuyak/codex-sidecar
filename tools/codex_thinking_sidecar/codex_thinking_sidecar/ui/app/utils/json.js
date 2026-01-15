export function safeJsonParse(s) {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
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

