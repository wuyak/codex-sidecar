import { keyOf, rolloutStampFromFile, shortId } from "./utils.js";

function _ensure(state) {
  if (!state || typeof state !== "object") return;
  if (!state.unreadByKey || typeof state.unreadByKey.get !== "function") state.unreadByKey = new Map();
  if (!Number.isFinite(Number(state.unreadTotal))) state.unreadTotal = 0;
}

export function getUnreadTotal(state) {
  try {
    _ensure(state);
    return Math.max(0, Number(state.unreadTotal) || 0);
  } catch (_) {
    return 0;
  }
}

export function getUnreadCount(state, key) {
  const k = String(key || "");
  if (!k || k === "all") return 0;
  try {
    _ensure(state);
    const cur = state.unreadByKey.get(k);
    return Math.max(0, Number(cur && cur.count) || 0);
  } catch (_) {
    return 0;
  }
}

export function markUnread(state, msg) {
  _ensure(state);
  const k = keyOf(msg);
  if (!k || k === "unknown") return { key: k, total: getUnreadTotal(state) };
  const prev = state.unreadByKey.get(k) || { count: 0, last_seq: 0, last_ts: "" };
  const next = {
    count: (Number(prev.count) || 0) + 1,
    last_seq: Number(prev.last_seq) || 0,
    last_ts: String(prev.last_ts || ""),
  };
  try {
    const seq = Number(msg && msg.seq) || 0;
    if (seq > next.last_seq) next.last_seq = seq;
  } catch (_) {}
  try {
    const ts = String(msg && msg.ts ? msg.ts : "");
    if (ts && (!next.last_ts || ts > next.last_ts)) next.last_ts = ts;
  } catch (_) {}

  state.unreadByKey.set(k, next);
  try { state.unreadTotal = (Number(state.unreadTotal) || 0) + 1; } catch (_) {}
  return { key: k, total: getUnreadTotal(state) };
}

export function clearUnreadForKey(state, key) {
  _ensure(state);
  const k = String(key || "");
  if (!k || k === "all") return getUnreadTotal(state);
  try {
    const cur = state.unreadByKey.get(k);
    const n = Math.max(0, Number(cur && cur.count) || 0);
    state.unreadByKey.delete(k);
    state.unreadTotal = Math.max(0, (Number(state.unreadTotal) || 0) - n);
  } catch (_) {}
  return getUnreadTotal(state);
}

export function clearAllUnread(state) {
  _ensure(state);
  try { state.unreadByKey.clear(); } catch (_) {}
  try { state.unreadTotal = 0; } catch (_) {}
  return 0;
}

export function pickMostRecentUnreadKey(state) {
  _ensure(state);
  let bestKey = "";
  let bestSeq = -1;
  let bestTs = "";

  try {
    for (const [k, info] of state.unreadByKey.entries()) {
      const cnt = Math.max(0, Number(info && info.count) || 0);
      if (!cnt) continue;

      let seq = 0;
      let ts = "";
      try {
        const t = state.threadIndex && typeof state.threadIndex.get === "function" ? state.threadIndex.get(k) : null;
        seq = Math.max(0, Number(t && t.last_seq) || 0);
        ts = String(t && t.last_ts ? t.last_ts : "");
      } catch (_) {}
      if (!seq) seq = Math.max(0, Number(info && info.last_seq) || 0);
      if (!ts) ts = String(info && info.last_ts ? info.last_ts : "");

      if (seq > bestSeq || (seq === bestSeq && ts > bestTs)) {
        bestSeq = seq;
        bestTs = ts;
        bestKey = k;
      }
    }
  } catch (_) {}

  return bestKey;
}

export function formatKeyLabel(state, key) {
  const k = String(key || "");
  if (!k || k === "unknown") return "unknown";
  try {
    const t = state && state.threadIndex && typeof state.threadIndex.get === "function" ? (state.threadIndex.get(k) || {}) : {};
    const tid = String(t.thread_id || "");
    const file = String(t.file || "");
    const stamp = rolloutStampFromFile(file);
    const idPart = tid ? shortId(tid) : shortId((file.split("/").slice(-1)[0]) || k);
    const label = (stamp && idPart) ? `${stamp} · ${idPart}` : (idPart || stamp || k);
    return label || k;
  } catch (_) {
    return k;
  }
}

export function formatUnreadToastDetail(state, opts = {}) {
  _ensure(state);
  const total = getUnreadTotal(state);
  let threads = 0;
  try {
    for (const [_k, info] of state.unreadByKey.entries()) {
      if (Math.max(0, Number(info && info.count) || 0) > 0) threads += 1;
    }
  } catch (_) {}
  const lastKey = (opts && opts.lastKey) ? String(opts.lastKey || "") : pickMostRecentUnreadKey(state);
  const lastLabel = lastKey ? formatKeyLabel(state, lastKey) : "";

  const parts = [];
  parts.push(`未读：${total} 条 / ${threads} 会话`);
  if (lastLabel) parts.push(`最近：${lastLabel}`);
  parts.push("点击右下角 🔔 跳到底部；到达底部后再点一次 🔔 可停止通知（清除未读）");
  return parts.join("\n");
}

export function updateUnreadButton(dom, state) {
  const btn = dom && dom.scrollBottomBtn ? dom.scrollBottomBtn : null;
  if (!btn) return;
  const total = getUnreadTotal(state);
  try {
    if (total > 0) {
      const badge = total > 99 ? "99+" : String(total);
      btn.textContent = "🔔";
      btn.title = `有 ${total} 条新输出（点击跳到底部；底部再点一次停止通知）`;
      btn.dataset.unread = badge;
      if (btn.classList) btn.classList.add("has-unread");
    } else {
      btn.textContent = "↓";
      btn.title = "回到页面底部";
      try { delete btn.dataset.unread; } catch (_) { btn.dataset.unread = ""; }
      if (btn.classList) btn.classList.remove("has-unread");
    }
  } catch (_) {}
}
