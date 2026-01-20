export const OFFLINE_KEY_PREFIX = "offline:";

export function isOfflineKey(key) {
  const k = String(key || "");
  return k.startsWith(OFFLINE_KEY_PREFIX);
}

export function offlineKeyFromRel(rel) {
  const r0 = String(rel || "").trim().replaceAll("\\", "/");
  const r = r0.startsWith("/") ? r0.slice(1) : r0;
  return `${OFFLINE_KEY_PREFIX}${r}`;
}

export function offlineRelFromKey(key) {
  const k = String(key || "");
  if (!k.startsWith(OFFLINE_KEY_PREFIX)) return "";
  return k.slice(OFFLINE_KEY_PREFIX.length);
}

