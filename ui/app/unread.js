import { keyOf, rolloutStampFromFile, safeDomId, shortId } from "./utils.js";

function _ensure(state) {
  if (!state || typeof state !== "object") return;
  if (!state.unreadByKey || typeof state.unreadByKey.get !== "function") state.unreadByKey = new Map();
  if (!state.unreadQueueByKey || typeof state.unreadQueueByKey.get !== "function") state.unreadQueueByKey = new Map(); // key -> [{ id, kind }]
  if (!state.unreadIdSetByKey || typeof state.unreadIdSetByKey.get !== "function") state.unreadIdSetByKey = new Map(); // key -> Set(id)
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

function _decUnread(state, key, n = 1) {
  _ensure(state);
  const k = String(key || "");
  if (!k || k === "all") return;
  const delta = Math.max(0, Number(n) || 0);
  if (!delta) return;
  try {
    const cur = state.unreadByKey.get(k);
    if (!cur) return;
    const before = Math.max(0, Number(cur.count) || 0);
    const after = Math.max(0, before - delta);
    const dec = before - after;
    if (after <= 0) state.unreadByKey.delete(k);
    else state.unreadByKey.set(k, { ...cur, count: after });
    state.unreadTotal = Math.max(0, (Number(state.unreadTotal) || 0) - dec);
  } catch (_) {}
}

function _ensureQueue(state, key) {
  _ensure(state);
  const k = String(key || "");
  if (!k || k === "all") return { q: [], set: null };
  let q = state.unreadQueueByKey.get(k);
  if (!Array.isArray(q)) { q = []; state.unreadQueueByKey.set(k, q); }
  let s = state.unreadIdSetByKey.get(k);
  if (!(s instanceof Set)) { s = new Set(); state.unreadIdSetByKey.set(k, s); }
  return { q, set: s };
}

export function markUnread(state, msg, opts = {}) {
  _ensure(state);
  const k = keyOf(msg);
  if (!k || k === "unknown") return { key: k, total: getUnreadTotal(state), added: false };

  const o = (opts && typeof opts === "object") ? opts : {};
  const kind0 = String((msg && msg.kind) ? msg.kind : "");
  const wantQueue = ("queue" in o) ? !!o.queue : (kind0 === "assistant_message");
  const mid0 = String((msg && msg.id) ? msg.id : "").trim();

  // Dedupe: if this message id is already in the unread queue, do not double-count.
  let qInfo = null;
  if (wantQueue && mid0) {
    qInfo = _ensureQueue(state, k);
    const s0 = qInfo && qInfo.set ? qInfo.set : null;
    if (s0 && s0.has(mid0)) return { key: k, total: getUnreadTotal(state), added: false };
  }

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

  // 仅把“可跳转的通知”加入队列（默认：回答输出）。
  try {
    if (wantQueue) {
      const mid = mid0;
      if (mid) {
        const kind = kind0.trim() || "unknown";
        const qd = qInfo || _ensureQueue(state, k);
        const q = qd && Array.isArray(qd.q) ? qd.q : [];
        const set = qd && qd.set ? qd.set : null;
        if (set && !set.has(mid)) set.add(mid);
        q.push({ id: mid, kind });
        const MAX = 240;
        if (q.length > MAX) {
          const drop = q.splice(0, q.length - MAX);
          for (const it of drop) {
            try { if (it && it.id && set) set.delete(it.id); } catch (_) {}
          }
          // 丢弃超出的最旧通知（防止挂机积累过大）
          _decUnread(state, k, drop.length);
        }
      }
    }
  } catch (_) {}

  return { key: k, total: getUnreadTotal(state), added: true };
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
  try { state.unreadQueueByKey.delete(k); } catch (_) {}
  try { state.unreadIdSetByKey.delete(k); } catch (_) {}
  return getUnreadTotal(state);
}

export function clearAllUnread(state) {
  _ensure(state);
  try { state.unreadByKey.clear(); } catch (_) {}
  try { state.unreadQueueByKey.clear(); } catch (_) {}
  try { state.unreadIdSetByKey.clear(); } catch (_) {}
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
  parts.push("未读会显示在右侧会话书签上；点击对应书签即可查看。");
  return parts.join("\n");
}

export function updateUnreadButton(dom, state) {
  const btn = dom && dom.scrollBottomBtn ? dom.scrollBottomBtn : null;
  if (!btn) return;
  try {
    // ↓ 按钮保持“滚动到底部”的单一职责；未读提示/跳转由会话书签（标签）承载。
    try { delete btn.dataset.unread; } catch (_) { btn.dataset.unread = ""; }
    if (btn.classList) btn.classList.remove("has-unread");
    try { btn.setAttribute("aria-label", "回到页面底部"); } catch (_) {}
  } catch (_) {}
}

function _scrollBehavior() {
  try {
    const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    if (mq && mq.matches) return "auto";
  } catch (_) {}
  return "smooth";
}

function _flashRow(row) {
  const el = row && row.nodeType === 1 ? row : null;
  if (!el || !el.classList) return;
  try { el.classList.remove("notify-jump"); } catch (_) {}
  // Force reflow so the class applies reliably even for consecutive jumps.
  try { void el.offsetWidth; } catch (_) {}
  try { el.classList.add("notify-jump"); } catch (_) {}
  setTimeout(() => { try { el.classList.remove("notify-jump"); } catch (_) {} }, 450);
}

function _isConnected(el) {
  const node = el && el.nodeType === 1 ? el : null;
  if (!node) return false;
  try {
    if ("isConnected" in node) return !!node.isConnected;
  } catch (_) {}
  try {
    return !!(document && document.body && document.body.contains && document.body.contains(node));
  } catch (_) {
    return false;
  }
}

function _findRow(dom, state, mid) {
  const id = String(mid || "").trim();
  if (!id) return null;
  let row = null;
  try { row = state && state.rowIndex && typeof state.rowIndex.get === "function" ? state.rowIndex.get(id) : null; } catch (_) { row = null; }
  if (row && row.nodeType === 1) {
    // If view-cached maps leak detached nodes, fall back to DOM query.
    if (_isConnected(row)) return row;
  }
  try {
    const byId = document.getElementById ? document.getElementById(`msg_${safeDomId(id)}`) : null;
    if (byId && byId.nodeType === 1) return byId;
  } catch (_) {}
  try {
    const byAttr = document.querySelector ? document.querySelector(`.row[data-msg-id="${id}"]`) : null;
    if (byAttr && byAttr.nodeType === 1) return byAttr;
  } catch (_) {}
  return null;
}

export function jumpToNextUnread(dom, state, opts = {}) {
  _ensure(state);
  const key = String((opts && opts.key) ? opts.key : (state && state.currentKey) ? state.currentKey : "all");
  if (!key || key === "all") return { ok: false, reason: "all_view" };

  const q0 = state.unreadQueueByKey.get(key);
  const q = Array.isArray(q0) ? q0 : [];
  const set = state.unreadIdSetByKey.get(key) instanceof Set ? state.unreadIdSetByKey.get(key) : null;
  if (!q.length) return { ok: false, reason: "empty" };

  let tried = 0;
  while (q.length && tried < 12) {
    tried += 1;
    const it = q[0];
    const mid = String(it && it.id ? it.id : "").trim();
    if (!mid) { q.shift(); _decUnread(state, key, 1); continue; }

    const row = _findRow(dom, state, mid);
    if (!row || row.nodeType !== 1 || !_isConnected(row)) {
      // Stale item (not in current view DOM). Drop it to avoid blocking navigation.
      q.shift();
      try { if (set) set.delete(mid); } catch (_) {}
      _decUnread(state, key, 1);
      continue;
    }

    // Consume before scrolling (so UI badge updates immediately).
    q.shift();
    try { if (set) set.delete(mid); } catch (_) {}
    _decUnread(state, key, 1);

    try {
      const r = row.getBoundingClientRect();
      const top = window.scrollY + (Number(r.top) || 0) - 72;
      window.scrollTo({ top: Math.max(0, top), behavior: _scrollBehavior() });
    } catch (_) {
      try { row.scrollIntoView({ behavior: _scrollBehavior(), block: "center" }); } catch (_) {}
    }
    try { _flashRow(row); } catch (_) {}

    try { updateUnreadButton(dom, state); } catch (_) {}
    return { ok: true, key, id: mid };
  }

  try { updateUnreadButton(dom, state); } catch (_) {}
  return { ok: false, reason: "stale" };
}
