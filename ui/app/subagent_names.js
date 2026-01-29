import { rolloutStampFromFile, shortId } from "./utils.js";
import { getCustomLabel } from "./sidebar/labels.js";

function _parseStamp(stamp) {
  const s = String(stamp || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return { yyyy: m[1], mm: m[2], dd: m[3], HH: m[4], MM: m[5] };
}

function _stampShort(stamp) {
  const p = _parseStamp(stamp);
  if (p) return `${p.mm}-${p.dd} ${p.HH}:${p.MM}`;
  return String(stamp || "").trim();
}

function _baseName(p) {
  const s = String(p || "");
  if (!s) return "";
  const parts = s.replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] || s;
}

function _shortDefaultLabel(t) {
  try {
    const stampFull = rolloutStampFromFile((t && t.file) ? t.file : "");
    const stamp = _stampShort(stampFull);
    const idPart = (t && t.thread_id)
      ? shortId(String(t.thread_id || ""))
      : shortId(_baseName((t && t.file) ? t.file : "") || String((t && t.key) ? t.key : ""));
    if (stamp && idPart) return `${stamp} · ${idPart}`;
    return idPart || stamp || "unknown";
  } catch (_) {
    return "unknown";
  }
}

function _ensureCache(state) {
  const s = (state && typeof state === "object") ? state : null;
  if (!s || !s.threadIndex || typeof s.threadIndex.values !== "function") return null;

  const size = Number(s.threadIndex.size) || 0;
  const prev = s.__subagentNameCacheV1;
  if (prev && typeof prev === "object" && prev.size === size && prev.byChild instanceof Map) return prev;

  const kidsByParent = new Map(); // parentKey -> [{ key, stamp, file }]
  try {
    for (const t of s.threadIndex.values()) {
      if (!t || typeof t !== "object") continue;
      const k = String((t && t.key) ? t.key : "").trim();
      if (!k || k === "all") continue;
      const pid = String((t && t.parent_thread_id) ? t.parent_thread_id : "").trim();
      const sk = String((t && t.source_kind) ? t.source_kind : "").trim().toLowerCase();
      if (!pid || sk !== "subagent") continue;
      if (!kidsByParent.has(pid)) kidsByParent.set(pid, []);
      kidsByParent.get(pid).push({ key: k, stamp: rolloutStampFromFile((t && t.file) ? t.file : ""), file: String((t && t.file) ? t.file : "") });
    }
  } catch (_) {}

  const byChild = new Map(); // childKey -> { parentKey, idx }
  try {
    for (const [pk, kids] of kidsByParent.entries()) {
      const arr = Array.isArray(kids) ? kids : [];
      arr.sort((a, b) => {
        const sa = String(a && a.stamp ? a.stamp : "");
        const sb = String(b && b.stamp ? b.stamp : "");
        if (sa !== sb) return sa.localeCompare(sb);
        return String(a && a.key ? a.key : "").localeCompare(String(b && b.key ? b.key : ""));
      });
      for (let i = 0; i < arr.length; i++) {
        const ck = String(arr[i] && arr[i].key ? arr[i].key : "").trim();
        if (!ck) continue;
        byChild.set(ck, { parentKey: pk, idx: i + 1 });
      }
    }
  } catch (_) {}

  const next = { size, byChild };
  try { s.__subagentNameCacheV1 = next; } catch (_) {}
  return next;
}

export function subagentNames(state, childKey) {
  const k = String(childKey || "").trim();
  if (!k || k === "all") return null;
  const cache = _ensureCache(state);
  if (!cache || !(cache.byChild instanceof Map)) return null;
  const hit = cache.byChild.get(k);
  if (!hit || typeof hit !== "object") return null;
  const pk = String(hit.parentKey || "").trim();
  const idx = Math.max(1, Number(hit.idx) || 1);

  let parentBase = "";
  try { parentBase = String(getCustomLabel(pk) || "").trim(); } catch (_) { parentBase = ""; }
  if (!parentBase) {
    const pt = (state && state.threadIndex && typeof state.threadIndex.get === "function") ? state.threadIndex.get(pk) : null;
    parentBase = _shortDefaultLabel(pt || { key: pk, thread_id: pk, file: "" });
  }
  const short = `子${idx}`;
  const long = `${parentBase}-${short}`;
  return { parentKey: pk, idx, short, long, parentBase };
}

