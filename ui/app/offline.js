export const OFFLINE_KEY_PREFIX = "offline:";

export function isOfflineKey(key) {
  const k = String(key || "");
  return k.startsWith(OFFLINE_KEY_PREFIX);
}

export function offlineKeyFromRel(rel) {
  const r0 = String(rel || "").trim().replaceAll("\\", "/");
  const r = r0.startsWith("/") ? r0.slice(1) : r0;
  if (!r) return OFFLINE_KEY_PREFIX;
  try {
    // Match backend + JS encodeURIComponent behavior (slashes become %2F).
    return `${OFFLINE_KEY_PREFIX}${encodeURIComponent(r)}`;
  } catch (_) {
    return `${OFFLINE_KEY_PREFIX}${r}`;
  }
}

export function offlineRelFromKey(key) {
  const k = String(key || "");
  if (!k.startsWith(OFFLINE_KEY_PREFIX)) return "";
  const enc = k.slice(OFFLINE_KEY_PREFIX.length);
  try {
    // Back-compat: older versions might have stored raw rel (with slashes).
    const rel = decodeURIComponent(enc);
    return String(rel || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  } catch (_) {
    return String(enc || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  }
}
