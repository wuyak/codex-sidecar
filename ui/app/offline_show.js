import { offlineKeyFromRel, offlineRelFromKey, isOfflineKey } from "./offline.js";

const _LS_OFFLINE_SHOW = "offlineShow:1";
const _MAX_SHOW = 80;

function _normRel(rel) {
  const r0 = String(rel || "").trim().replaceAll("\\", "/");
  const r = r0.startsWith("/") ? r0.slice(1) : r0;
  return r;
}

function _coerceEntry(it) {
  // Accept { rel, file?, thread_id? } or an offline key (legacy-ish).
  if (!it) return null;
  if (typeof it === "string") {
    const s = String(it || "").trim();
    if (!s) return null;
    if (isOfflineKey(s)) {
      const rel = offlineRelFromKey(s);
      if (!rel) return null;
      return { rel, key: offlineKeyFromRel(rel), file: "", thread_id: "" };
    }
    return { rel: _normRel(s), key: offlineKeyFromRel(s), file: "", thread_id: "" };
  }
  if (typeof it !== "object") return null;
  const rel = _normRel(it.rel || "");
  if (!rel) return null;
  const file = String(it.file || "").trim();
  const thread_id = String(it.thread_id || it.threadId || "").trim();
  return { rel, key: offlineKeyFromRel(rel), file, thread_id };
}

export function loadOfflineShowList() {
  if (typeof localStorage === "undefined") return [];
  let raw = "";
  try { raw = String(localStorage.getItem(_LS_OFFLINE_SHOW) || "").trim(); } catch (_) { raw = ""; }
  if (!raw) return [];
  let obj = null;
  try { obj = JSON.parse(raw); } catch (_) { obj = null; }

  let arr = [];
  if (Array.isArray(obj)) arr = obj;
  else if (obj && typeof obj === "object" && Array.isArray(obj.items)) arr = obj.items;
  else return [];

  const out = [];
  const seen = new Set();
  for (const it of arr) {
    const e = _coerceEntry(it);
    if (!e) continue;
    if (!e.rel || seen.has(e.rel)) continue;
    seen.add(e.rel);
    out.push(e);
    if (out.length >= _MAX_SHOW) break;
  }
  return out;
}

export function saveOfflineShowList(list) {
  if (typeof localStorage === "undefined") return false;
  const arr = Array.isArray(list) ? list : [];
  const payload = arr
    .map((it) => _coerceEntry(it))
    .filter(Boolean)
    .map((it) => ({ rel: it.rel, file: it.file || "", thread_id: it.thread_id || "" }))
    .slice(0, _MAX_SHOW);
  try {
    localStorage.setItem(_LS_OFFLINE_SHOW, JSON.stringify(payload));
    try { window.dispatchEvent(new CustomEvent("offline-show-changed")); } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

export function upsertOfflineShow(list, entry) {
  const cur = Array.isArray(list) ? list : [];
  const e = _coerceEntry(entry);
  if (!e) return cur.slice(0);
  const out = [];
  let placed = false;
  for (const it of cur) {
    const x = _coerceEntry(it);
    if (!x) continue;
    if (x.rel === e.rel) {
      // Prefer newer meta when available.
      out.push({
        rel: e.rel,
        key: e.key,
        file: e.file || x.file || "",
        thread_id: e.thread_id || x.thread_id || "",
      });
      placed = true;
      continue;
    }
    out.push(x);
  }
  if (!placed) out.unshift(e);
  return out.slice(0, _MAX_SHOW);
}

export function removeOfflineShowByKey(list, key) {
  const cur = Array.isArray(list) ? list : [];
  const k = String(key || "").trim();
  if (!k) return cur.slice(0);
  const out = [];
  for (const it of cur) {
    const x = _coerceEntry(it);
    if (!x) continue;
    if (x.key === k) continue;
    out.push(x);
  }
  return out.slice(0, _MAX_SHOW);
}

export function removeOfflineShowByRel(list, rel) {
  const cur = Array.isArray(list) ? list : [];
  const r = _normRel(rel);
  if (!r) return cur.slice(0);
  const out = [];
  for (const it of cur) {
    const x = _coerceEntry(it);
    if (!x) continue;
    if (x.rel === r) continue;
    out.push(x);
  }
  return out.slice(0, _MAX_SHOW);
}
