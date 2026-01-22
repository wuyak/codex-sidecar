import { getCustomLabel } from "../sidebar/labels.js";

export function extractUuid(s) {
  const raw = String(s || "");
  if (!raw) return "";
  const m = raw.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
  return m ? String(m[0] || "") : "";
}

export function sanitizeFileName(s) {
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

export function baseName(p) {
  const raw = String(p || "").trim();
  if (!raw) return "";
  const parts = raw.replaceAll("\\", "/").split("/");
  return String(parts[parts.length - 1] || "").trim();
}

export function pickCustomLabel(key, threadId, filePath) {
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
  const fromFile = extractUuid(f || k);
  if (fromFile && fromFile !== k && fromFile !== tid) {
    try { v = String(getCustomLabel(fromFile) || "").trim(); } catch (_) { v = ""; }
    if (v) return v;
  }
  return "";
}

