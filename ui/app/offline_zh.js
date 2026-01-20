function _normRel(rel) {
  const r0 = String(rel || "").trim().replaceAll("\\", "/");
  const r = r0.startsWith("/") ? r0.slice(1) : r0;
  return r;
}

export function offlineZhStorageKey(rel) {
  return `offlineZh:${_normRel(rel)}`;
}

export function loadOfflineZhMap(rel) {
  if (typeof localStorage === "undefined") return {};
  const k = offlineZhStorageKey(rel);
  let raw = "";
  try { raw = String(localStorage.getItem(k) || "").trim(); } catch (_) { raw = ""; }
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
  } catch (_) {
    return {};
  }
}

export function saveOfflineZhMap(rel, map) {
  if (typeof localStorage === "undefined") return false;
  const k = offlineZhStorageKey(rel);
  const obj = (map && typeof map === "object" && !Array.isArray(map)) ? map : {};
  try {
    localStorage.setItem(k, JSON.stringify(obj));
    return true;
  } catch (_) {
    return false;
  }
}

export function upsertOfflineZh(rel, mid, zh) {
  const r = _normRel(rel);
  const id = String(mid || "").trim();
  const text = String(zh || "").trimEnd();
  if (!r || !id || !text) return false;
  const map = loadOfflineZhMap(r);
  map[id] = text;
  return saveOfflineZhMap(r, map);
}

export function upsertOfflineZhBatch(rel, zhById) {
  const r = _normRel(rel);
  if (!r) return false;
  const obj = (zhById && typeof zhById === "object" && !Array.isArray(zhById)) ? zhById : {};
  const keys = Object.keys(obj);
  if (!keys.length) return false;
  const map = loadOfflineZhMap(r);
  for (const id of keys) {
    const zh = String(obj[id] || "").trimEnd();
    if (!id || !zh) continue;
    map[id] = zh;
  }
  return saveOfflineZhMap(r, map);
}

