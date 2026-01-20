export function keyOf(msg) {
  try {
    const k = (msg && typeof msg.key === "string") ? msg.key : "";
    if (k) return k;
  } catch (_) {}
  return (msg && (msg.thread_id || msg.file)) || "unknown";
}

export function shortId(s) {
  if (!s) return "";
  if (s.length <= 10) return s;
  return s.slice(0, 6) + "…" + s.slice(-4);
}

export function safeDomId(s) {
  const raw = String(s ?? "");
  if (!raw) return "";
  return raw.replace(/[^a-z0-9_-]/gi, "_");
}
