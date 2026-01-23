import { keyOf, safeDomId } from "../utils.js";
import { applyMsgToList } from "./timeline.js";
import { bufferForKey, pushPending, shouldBufferKey } from "./buffer.js";
import { dismissCorner, notifyCorner } from "../utils/notify.js";
import { flashToastAt } from "../utils/toast.js";
import { markUnread, updateUnreadButton } from "../unread.js";
import { maybePlayNotifySound } from "../sound.js";
import { cleanThinkingText } from "../markdown.js";

function _toolGateWaiting(text) {
  const s = String(text || "");
  return s.includes("等待确认") || s.toLowerCase().includes("waiting for tool gate");
}

function _toolGateReleased(text) {
  const s = String(text || "");
  return s.includes("已确认") || s.toLowerCase().includes("tool gate released");
}

function _toolGateHint(text) {
  const s = String(text || "");
  const sl = s.toLowerCase();
  // Non-blocking hints ("可能需要终端确认") are intentionally ignored by UI notifications.
  return s.includes("终端确认") || s.includes("权限升级") || sl.includes("terminal approval");
}

function _isReplay(msg) {
  try {
    if (!msg || typeof msg !== "object") return false;
    if (msg.replay === true) return true;
    // Back-compat: tolerate alternative field names if any.
    if (msg.is_replay === true) return true;
    if (msg.isReplay === true) return true;
  } catch (_) {}
  return false;
}

function _isAtBottom(pad = 80) {
  try {
    const p = Number.isFinite(Number(pad)) ? Number(pad) : 80;
    return (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - p);
  } catch (_) {
    return false;
  }
}

function _isUserActive(state) {
  try {
    const s = (state && typeof state === "object") ? state : {};
    const had = !!s.userHasInteracted;
    const last = Number(s.userLastActiveMs) || 0;
    if (!had || !last) return false;
    const visible = (typeof document !== "undefined") ? (document.visibilityState === "visible") : true;
    const focused = (typeof document !== "undefined" && typeof document.hasFocus === "function") ? document.hasFocus() : true;
    if (!visible || !focused) return false;
    const now = Date.now();
    const IDLE_MS = 5_000;
    return (now - last) <= IDLE_MS;
  } catch (_) {
    return false;
  }
}

function _ensureNotifyDedup(state) {
  if (!state || typeof state !== "object") return { set: null, order: null };
  if (!(state.notifySeenIds instanceof Set)) state.notifySeenIds = new Set();
  if (!Array.isArray(state.notifySeenOrder)) state.notifySeenOrder = [];
  return { set: state.notifySeenIds, order: state.notifySeenOrder };
}

function _shouldRingForId(state, msgId) {
  const mid = String(msgId || "").trim();
  if (!mid) return true;
  const { set, order } = _ensureNotifyDedup(state);
  if (!set || !order) return true;
  if (set.has(mid)) return false;
  set.add(mid);
  order.push(mid);
  const MAX = 2400;
  if (order.length > MAX) {
    const drop = order.splice(0, order.length - MAX);
    for (const x of drop) {
      try { if (x) set.delete(x); } catch (_) {}
    }
  }
  return true;
}

function _ensureToolGateToastLayout(state) {
  if (!state || typeof state !== "object") return;
  if (state.toolGateToastLayoutWired) return;
  state.toolGateToastLayoutWired = true;

  const schedule = () => _scheduleToolGateToastLayout(state);
  try { window.addEventListener("resize", schedule, { passive: true }); } catch (_) {}
  try {
    const railLive = document.querySelector ? document.querySelector("#bookmarks .bm-rail") : null;
    if (railLive) railLive.addEventListener("scroll", schedule, { passive: true });
  } catch (_) {}
  try {
    const railOff = document.querySelector ? document.querySelector("#offlineBookmarks .bm-rail") : null;
    if (railOff) railOff.addEventListener("scroll", schedule, { passive: true });
  } catch (_) {}
}

function _scheduleToolGateToastLayout(state) {
  if (!state || typeof state !== "object") return;
  if (state.toolGateToastLayoutRaf) return;
  try {
    state.toolGateToastLayoutRaf = requestAnimationFrame(() => {
      state.toolGateToastLayoutRaf = 0;
      _relayoutToolGateToasts();
    });
  } catch (_) {}
}

function _findBookmarkButton(key) {
  const k = String(key || "").trim();
  if (!k) return null;
  const rails = [];
  try {
    const live = document.querySelector ? document.querySelector("#bookmarks .bm-rail") : null;
    if (live) rails.push(live);
  } catch (_) {}
  try {
    const off = document.querySelector ? document.querySelector("#offlineBookmarks .bm-rail") : null;
    if (off) rails.push(off);
  } catch (_) {}
  for (const rail of rails) {
    try {
      const btns = rail.querySelectorAll ? rail.querySelectorAll("button.bookmark") : [];
      for (const b of btns) {
        const bk = b && b.dataset ? String(b.dataset.key || "") : "";
        if (bk === k) return b;
      }
    } catch (_) {}
  }
  return null;
}

function _placeToolGateToastAboveTab(el, key, yOffset = 0) {
  const toast = el && el.nodeType === 1 ? el : null;
  if (!toast) return false;
  const k = String(key || "").trim();
  if (!k) return false;
  const extraY = Number.isFinite(Number(yOffset)) ? Number(yOffset) : 0;

  const btn0 = _findBookmarkButton(k);
  const anchorKey = btn0 ? k : (k !== "all" ? "all" : "");
  const btn = btn0 || (anchorKey ? _findBookmarkButton(anchorKey) : null);
  try { toast.classList.add("tool-gate-toast"); } catch (_) {}
  try { toast.dataset.tgKey = k; } catch (_) {}
  try { toast.dataset.tgAnchor = anchorKey || k; } catch (_) {}
  if (!btn) return false;

  let tr = null;
  try { tr = btn.getBoundingClientRect ? btn.getBoundingClientRect() : null; } catch (_) { tr = null; }
  if (!tr) return false;

  // Width: stay close to the tab width (but keep a reasonable min/max so it doesn't look broken).
  const pad = 10;
  const minW = 96;
  const maxW = Math.max(minW, Math.min(420, window.innerWidth - pad * 2));
  const targetW = Math.max(minW, Math.min(maxW, Number(tr.width) || minW));

  try { toast.style.position = "fixed"; } catch (_) {}
  try { toast.style.right = "auto"; toast.style.bottom = "auto"; } catch (_) {}
  try { toast.style.width = `${targetW}px`; toast.style.minWidth = `${targetW}px`; toast.style.maxWidth = `${targetW}px`; } catch (_) {}

  // Measure after width is applied.
  let rr = null;
  try { rr = toast.getBoundingClientRect ? toast.getBoundingClientRect() : null; } catch (_) { rr = null; }
  if (!rr) return false;

  let left = (Number(tr.left) || 0) + (Number(tr.width) || 0) / 2 - (Number(rr.width) || targetW) / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - (Number(rr.width) || targetW) - pad));

  // Place just above the tab.
  const gap = 10;
  let top = (Number(tr.top) || 0) - (Number(rr.height) || 0) - gap - Math.max(0, extraY);
  top = Math.max(pad, Math.min(top, window.innerHeight - (Number(rr.height) || 0) - pad));

  try { toast.style.left = `${left}px`; toast.style.top = `${top}px`; } catch (_) {}
  return true;
}

function _relayoutToolGateToasts() {
  const els = document.querySelectorAll ? document.querySelectorAll(".corner-toast.tool-gate-toast") : [];
  const groups = new Map(); // anchor -> [el...]
  for (const el of els) {
    try {
      const dk = el && el.dataset ? String(el.dataset.tgKey || "") : "";
      if (!dk) continue;
      const anchor = el && el.dataset ? String(el.dataset.tgAnchor || dk || "") : dk;
      const k = anchor || dk;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(el);
    } catch (_) {}
  }
  for (const [, list] of groups) {
    let offsetY = 0;
    for (const el of list) {
      try {
        const dk = el && el.dataset ? String(el.dataset.tgKey || "") : "";
        if (!dk) continue;
        _placeToolGateToastAboveTab(el, dk, offsetY);
        let rr = null;
        try { rr = el.getBoundingClientRect ? el.getBoundingClientRect() : null; } catch (_) { rr = null; }
        const h = rr ? Math.max(0, Number(rr.height) || 0) : 0;
        offsetY += (h > 0 ? (h + 10) : 64);
      } catch (_) {}
    }
  }
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

function _findRow(state, mid) {
  const id = String(mid || "").trim();
  if (!id) return null;
  let row = null;
  try { row = state && state.rowIndex && typeof state.rowIndex.get === "function" ? state.rowIndex.get(id) : null; } catch (_) { row = null; }
  if (row && row.nodeType === 1) {
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

function _consumeUnreadId(state, key, mid) {
  const k = String(key || "").trim();
  const id = String(mid || "").trim();
  if (!state || typeof state !== "object") return false;
  if (!k || k === "all" || !id) return false;

  let hadId = false;
  let removedFromQueue = false;
  try {
    const q0 = state.unreadQueueByKey && typeof state.unreadQueueByKey.get === "function" ? state.unreadQueueByKey.get(k) : null;
    const q = Array.isArray(q0) ? q0 : null;
    if (q && q.length) {
      for (let i = q.length - 1; i >= 0; i--) {
        const it = q[i];
        if (it && typeof it === "object" && String(it.id || "") === id) {
          q.splice(i, 1);
          removedFromQueue = true;
          hadId = true;
          break;
        }
      }
    }
  } catch (_) {}
  try {
    const set = state.unreadIdSetByKey && typeof state.unreadIdSetByKey.get === "function" ? state.unreadIdSetByKey.get(k) : null;
    if (set instanceof Set) {
      if (set.has(id)) hadId = true;
      set.delete(id);
    }
  } catch (_) {}

  // Decrement counters (best-effort).
  try {
    if (!hadId) return false;
    const cur = state.unreadByKey && typeof state.unreadByKey.get === "function" ? state.unreadByKey.get(k) : null;
    const before = Math.max(0, Number(cur && cur.count) || 0);
    if (before > 0) {
      const after = before - 1;
      if (after <= 0) state.unreadByKey.delete(k);
      else state.unreadByKey.set(k, { ...cur, count: after });
      state.unreadTotal = Math.max(0, (Number(state.unreadTotal) || 0) - 1);
      return true;
    }
  } catch (_) {}

  return removedFromQueue;
}

function _wireToolGateToastJump(dom, state, el, msg, refreshList, notifyKey) {
  const toast = el && el.nodeType === 1 ? el : null;
  if (!toast) return;

  const mid = String((msg && msg.id) ? msg.id : "").trim();
  const k = keyOf(msg);
  const nk = String(notifyKey || "").trim();
  if (!mid || !k || k === "unknown") return;

  // Avoid duplicate handlers if the same element is reused.
  try {
    const sig = `${mid}:${nk || "tool_gate"}`;
    if (toast.__toolGateJumpSig === sig) return; // eslint-disable-line no-underscore-dangle
    toast.__toolGateJumpSig = sig; // eslint-disable-line no-underscore-dangle
  } catch (_) {}

  try { toast.classList.add("clickable"); } catch (_) {}
  try { toast.setAttribute("role", "button"); } catch (_) {}
  try { toast.setAttribute("tabindex", "0"); } catch (_) {}
  try { toast.setAttribute("aria-label", "点击跳转到对应会话位置"); } catch (_) {}

  const jump = async () => {
    // Switch to the owning session view first.
    try {
      const onSelectKey = state && typeof state.onSelectKey === "function" ? state.onSelectKey : null;
      if (onSelectKey && k && k !== "all" && String(state.currentKey || "all") !== k) {
        await onSelectKey(k);
      }
    } catch (_) {}

    // Ensure the message exists in DOM; if not, do one resync.
    let row = _findRow(state, mid);
    if (!row) {
      try { await Promise.resolve(refreshList()).catch(() => {}); } catch (_) {}
      row = _findRow(state, mid);
    }
    if (row && _isConnected(row)) {
      try {
        const r = row.getBoundingClientRect();
        const top = window.scrollY + (Number(r.top) || 0) - 72;
        window.scrollTo({ top: Math.max(0, top), behavior: _scrollBehavior() });
      } catch (_) {
        try { row.scrollIntoView({ behavior: _scrollBehavior(), block: "center" }); } catch (_) {}
      }
      try { _flashRow(row); } catch (_) {}
    }

    // Consume this unread item so it won't keep pinging the user after they've jumped.
    try { _consumeUnreadId(state, k, mid); } catch (_) {}
    try { updateUnreadButton(dom, state); } catch (_) {}
  };

  const onClick = (ev) => {
    try { ev.preventDefault(); } catch (_) {}
    try { ev.stopPropagation(); } catch (_) {}
    Promise.resolve(jump()).finally(() => {
      try { dismissCorner(nk || "tool_gate"); } catch (_) {}
    });
  };

  toast.addEventListener("click", onClick);
  toast.addEventListener("keydown", (ev) => {
    const key = String(ev && ev.key ? ev.key : "");
    if (key === "Enter" || key === " ") onClick(ev);
  });
}

function _summarizeToolGate(text) {
  function _truncate(s, max = 180) {
    const t = String(s || "").trim();
    const m = Number.isFinite(Number(max)) ? Number(max) : 180;
    if (!t) return "";
    if (t.length <= m) return t;
    return t.slice(0, Math.max(0, m - 1)) + "…";
  }

  function _cleanValue(s) {
    let out = String(s || "").trim();
    if (!out) return "";
    // Drop common markdown bullets / duplicated labels that sometimes leak into values.
    out = out.replace(/^[-–—•·]+\s*/g, "");
    out = out.replace(/^(原因|理由)\s*(?:\([^)]*\)|（[^）]*）)?\s*[:：·]\s*/i, "");
    out = out.replace(/^[-–—•·]+\s*/g, "");
    return out.trim();
  }

  const lines = String(text || "").split("\n");
  let tool = "";
  let just = "";
  let cmd = "";
  let maybeStale = false;
  let inCode = false;
  for (const raw of lines) {
    const ln = String(raw || "").trim();
    if (!ln) continue;
    if (ln.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode && !cmd) { cmd = ln; continue; }
    if (ln.includes("尾部扫描") || ln.includes("历史残留")) maybeStale = true;
    if (!tool && ln.startsWith("- 工具")) tool = _cleanValue(ln.replace(/^\-\s*工具\s*[:：]\s*/g, "").replaceAll("`", "").trim());
    if (!just && (ln.startsWith("- 原因") || ln.startsWith("- 理由"))) just = _cleanValue(ln.replace(/^\-\s*(原因|理由)[^:：·]*[:：·]\s*/g, "").trim());
  }
  const parts = [];
  if (maybeStale) parts.push("注：可能是历史残留");
  if (tool) parts.push(`工具：${_truncate(tool, 120)}`);
  if (just) parts.push(`原因：${_truncate(just, 220)}`);
  // 命令行往往很长，会让 toast 看起来“很乱”；只展示短命令，长命令留在时间线原文里看。
  if (cmd && String(cmd || "").trim().length <= 120) parts.push(`命令：${_truncate(cmd, 140)}`);
  return parts.join("\n");
}

function _summarizeToolGateMsg(msg) {
  const m = (msg && typeof msg === "object") ? msg : {};
  try {
    const tool = String(m.gate_tool || m.gateTool || "").trim();
    const just = String(m.gate_justification || m.gateJustification || "").trim();
    const cmd = String(m.gate_command || m.gateCommand || "").trim();
    if (!tool && !just && !cmd) return "";
    const parts = [];
    if (tool) parts.push(`工具：${tool}`);
    if (just) parts.push(`原因：${just.length <= 220 ? just : (just.slice(0, 219) + "…")}`);
    if (cmd && cmd.length <= 120) parts.push(`命令：${cmd}`);
    return parts.join("\n");
  } catch (_) {}
  return "";
}

export function connectEventStream(dom, state, upsertThread, renderTabs, renderMessage, setStatus, refreshList) {
  state.uiEventSource = new EventSource("/events");

  let _tabsTimer = 0;
  let _tabsDirty = false;
  function _scheduleTabs(delayMs = 80) {
    if (!state || typeof state !== "object") return;
    _tabsDirty = true;
    const delay = (state.isRefreshing && Number.isFinite(Number(delayMs)))
      ? Math.max(Number(delayMs) || 0, 160)
      : (Number(delayMs) || 0);
    if (_tabsTimer) return;
    _tabsTimer = setTimeout(() => {
      _tabsTimer = 0;
      if (!_tabsDirty) return;
      _tabsDirty = false;
      try { renderTabs(dom, state); } catch (_) {}
      // Tabs may have reflowed; keep tool_gate toasts anchored above their tabs.
      try { _scheduleToolGateToastLayout(state); } catch (_) {}
    }, delay);
  }

  function _scheduleFlush(delayMs = 0) {
    if (!state || typeof state !== "object") return;
    if (state.sseFlushTimer) return;
    state.sseFlushTimer = setTimeout(() => {
      state.sseFlushTimer = 0;
      _flushPending();
    }, delayMs);
  }

  function _flushPending() {
    if (!state || typeof state !== "object") return;
    if (state.isRefreshing) {
      _scheduleFlush(50);
      return;
    }
    if (state.ssePendingOverflow) {
      state.ssePendingOverflow = false;
      try { if (Array.isArray(state.ssePending)) state.ssePending.length = 0; } catch (_) {}
      try { Promise.resolve(refreshList()).catch(() => {}); } catch (_) {}
      return;
    }
    const pending = Array.isArray(state.ssePending) ? state.ssePending.splice(0) : [];
    if (!pending.length) return;
    for (const msg of pending) _handleMsg(msg);
    if (state.ssePending && state.ssePending.length) _scheduleFlush(0);
  }

  function _handleMsg(msg) {
    try {
      const op = String((msg && msg.op) ? msg.op : "").trim().toLowerCase();
      // Clear manual translate in-flight state as soon as ZH arrives, so render can flip status immediately.
      try {
        if (op === "update" && msg && typeof msg.id === "string" && state && state.translateInFlight && typeof state.translateInFlight.delete === "function") {
          const hasZh = (typeof msg.zh === "string") && String(msg.zh || "").trim();
          const hasErr = (typeof msg.translate_error === "string") && String(msg.translate_error || "").trim();
          if (hasZh || hasErr) state.translateInFlight.delete(msg.id);
        }
      } catch (_) {}

      // "重译完成" 提示：仅在用户点击过“重译”且译文确实发生替换时触发（避免重复 toast）。
      try {
        if (op === "update" && msg && typeof msg.id === "string" && state && state.retranslatePending && typeof state.retranslatePending.get === "function") {
          const pend = state.retranslatePending.get(msg.id);
          if (pend && typeof pend === "object") {
            const x = Number(pend.x) || 0;
            const y = Number(pend.y) || 0;
            const oldZh = String(pend.oldZh || "");
            const err = (typeof msg.translate_error === "string") ? String(msg.translate_error || "").trim() : "";
            const zh = (typeof msg.zh === "string") ? String(msg.zh || "") : "";

            if (err) {
              flashToastAt(x, y, `重译失败：${err}`, { isLight: true, durationMs: 1400 });
              try { state.retranslatePending.delete(msg.id); } catch (_) {}
            } else if (zh.trim()) {
              const next = cleanThinkingText(zh);
              const prev = cleanThinkingText(String(oldZh || ""));
              const prevTrim = String(prev || "").trim();
              const nextTrim = String(next || "").trim();
              const label = !prevTrim ? "已完成重译" : (nextTrim === prevTrim ? "已完成重译（内容无变化）" : "已完成重译");
              flashToastAt(x, y, label, { isLight: true, durationMs: 1200 });
              try { state.retranslatePending.delete(msg.id); } catch (_) {}
            }
          }
        }
      } catch (_) {}

      const k = keyOf(msg);
      const isHidden = !!(state && state.hiddenThreads && typeof state.hiddenThreads.has === "function" && state.hiddenThreads.has(k));
      // Updates should not bump thread counts.
      if (op !== "update") upsertThread(state, msg);

      // “all” 视图仅代表“当前在监听的会话汇总”，不应被“关闭监听”的会话污染。
      const shouldRender = (!isHidden) && (state.currentKey === "all" || state.currentKey === k);
      const isReplay = _isReplay(msg);
      const atBottom = shouldRender ? _isAtBottom(80) : false;

      // 右下角提醒（不依赖当前会话可见性：tool_gate 走通知条；回答走未读角标，避免错过多会话输出）
      try {
        const kind = String((msg && msg.kind) ? msg.kind : "").trim();
        if (kind === "tool_gate") {
          const txt = String(msg.text || "");
          const mid = String((msg && msg.id) ? msg.id : "").trim();
          const summary = _summarizeToolGateMsg(msg) || _summarizeToolGate(txt) || "请回到终端完成确认/授权后继续。";
          const threadKey0 = keyOf(msg);
          const threadKey = (threadKey0 && threadKey0 !== "unknown") ? String(threadKey0) : "all";
          // Support multiple concurrent approvals:
          // - Prefer a stable gate_id (call_id) if provided by backend.
          // - Fall back to per-thread key (single toast per thread).
          let gateId = "";
          try {
            gateId = String((msg && (msg.gate_id || msg.gateId || msg.gate)) ? (msg.gate_id || msg.gateId || msg.gate) : "").trim();
          } catch (_) { gateId = ""; }
          const notifyKey = gateId ? `tool_gate:${threadKey}:${gateId}` : `tool_gate:${threadKey}`;
          try { _ensureToolGateToastLayout(state); } catch (_) {}

          let gateStatus = "";
          try { gateStatus = String((msg && (msg.gate_status || msg.gateStatus)) ? (msg.gate_status || msg.gateStatus) : "").trim().toLowerCase(); } catch (_) { gateStatus = ""; }
          if (!gateStatus) {
            if (_toolGateReleased(txt)) gateStatus = "released";
            else if (_toolGateWaiting(txt)) gateStatus = "waiting";
            else if (_toolGateHint(txt)) gateStatus = "hint";
          }

          if (gateStatus === "released") {
            let gateResult = "";
            try { gateResult = String((msg && (msg.gate_result || msg.gateResult)) ? (msg.gate_result || msg.gateResult) : "").trim().toLowerCase(); } catch (_) { gateResult = ""; }
            let title = "终端已确认";
            let level = "success";
            if (gateResult === "rejected") { title = "终端已拒绝"; level = "warn"; }
            else if (gateResult === "aborted") { title = "终端已取消"; level = "warn"; }
            const el = notifyCorner(notifyKey, title, summary || "tool gate 已解除。", { level, ttlMs: 8000 });
            _wireToolGateToastJump(dom, state, el, msg, refreshList, notifyKey);
            try { if (el) _placeToolGateToastAboveTab(el, threadKey); } catch (_) {}
            try { _scheduleToolGateToastLayout(state); } catch (_) {}
          } else if (gateStatus === "waiting") {
            const el = notifyCorner(notifyKey, "终端等待确认", summary, { level: "warn", sticky: true });
            _wireToolGateToastJump(dom, state, el, msg, refreshList, notifyKey);
            try { if (el) _placeToolGateToastAboveTab(el, threadKey); } catch (_) {}
            try { _scheduleToolGateToastLayout(state); } catch (_) {}
            // tool_gate 属于“强提醒”：提示音去重即可，不进入“未读角标”（避免污染会话未读计数）。
            if (_shouldRingForId(state, mid)) {
              try { maybePlayNotifySound(dom, state, { kind: "tool_gate" }); } catch (_) {}
            }
          } else if (gateStatus === "hint") {
            // Non-blocking hints (e.g. "可能需要终端确认") are intentionally NOT notified.
            // Only definitive "waiting for tool gate" should surface as a toast/sound.
          } else {
            // Unknown tool_gate variants: still surface as attention-worthy.
            const el = notifyCorner(notifyKey, "终端提示", summary, { level: "warn", sticky: true });
            _wireToolGateToastJump(dom, state, el, msg, refreshList, notifyKey);
            try { if (el) _placeToolGateToastAboveTab(el, threadKey); } catch (_) {}
            try { _scheduleToolGateToastLayout(state); } catch (_) {}
            if (_shouldRingForId(state, mid)) {
              try { maybePlayNotifySound(dom, state, { kind: "tool_gate" }); } catch (_) {}
            }
          }
        }
        // “未读”仅对用户关心的类型：回答输出。
        // tool_gate 走“贴着对应会话标签上方”的通知条（不占未读角标，避免污染计数）。
        // tool_call/tool_output（如 apply_patch）噪音较高，不计入未读/不响铃。
        if (!isHidden && op !== "update" && kind === "assistant_message") {
          // 只有“新通知”才响铃：历史回放/补齐不算。
          // 当前视图在底部也不一定“已读”（可能挂机）；仅当用户在近 5s 有明确交互且页面可见/聚焦时，才视为已看到。
          const userActive = _isUserActive(state);
          const shouldNotify = (!isReplay) && (!shouldRender || !atBottom || !userActive);
          if (shouldNotify) {
            const mid = String((msg && msg.id) ? msg.id : "").trim();
            // “响铃/未读”都以“新通知”去重：重复事件不重复计数，也不重复响铃。
            if (_shouldRingForId(state, mid)) {
              const r = markUnread(state, msg, { queue: true });
              if (r && r.added) {
                updateUnreadButton(dom, state);
                try { maybePlayNotifySound(dom, state, { kind: "assistant" }); } catch (_) {}
              }
            }
          }
        }
      } catch (_) {}

      if (shouldRender) {
        applyMsgToList(dom, state, msg, renderMessage);
        // 当前在 all 视图时，其他已缓存会话的视图仍需要“慢慢跟上”，否则切回会显示旧内容。
        if (state.currentKey === "all" && shouldBufferKey(state, k)) {
          bufferForKey(state, k, msg);
        }
      } else {
        // 仅为“已缓存的会话视图”缓冲，避免长时间挂着时对大量冷门 key 无限占用内存。
        if (!isHidden && shouldBufferKey(state, k)) bufferForKey(state, k, msg);
      }
      // 译文回填（op=update）不影响会话计数/排序，避免每条 update 都重绘侧栏。
      if (!isHidden && op !== "update") _scheduleTabs(80);
    } catch (e) {}
  }

  state.uiEventSource.addEventListener("open", () => {
    try {
      const ever = !!(state && state.sseEverOpen);
      state.sseEverOpen = true;
      const hadError = !!(state && state.sseHadError);
      state.sseHadError = false;

      // Only resync after a real disconnect/reconnect (avoid double-refresh on initial connect).
      if (ever && hadError) {
        try { setStatus(dom, "连接已恢复，正在同步…"); } catch (_) {}
        try {
          state.threadsDirty = true;
          state.threadsLastSyncMs = 0;
        } catch (_) {}

        // Mark cached views as overflow so switching will refresh from source.
        try {
          if (state.viewCache && typeof state.viewCache.keys === "function") {
            if (!state.sseOverflow || typeof state.sseOverflow.add !== "function") state.sseOverflow = new Set();
            for (const k of state.viewCache.keys()) {
              if (k && k !== "all") state.sseOverflow.add(k);
            }
          }
        } catch (_) {}
        // Drop buffered SSE during reconnect; we'll resync from source.
        try { if (state.sseByKey && typeof state.sseByKey.clear === "function") state.sseByKey.clear(); } catch (_) {}

        try { Promise.resolve(refreshList()).catch(() => {}); } catch (_) {}
      }
    } catch (_) {}
  });

  state.uiEventSource.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (state && typeof state === "object" && state.isRefreshing) {
        pushPending(state, msg);
        _scheduleFlush(50);
        return;
      }
      _handleMsg(msg);
    } catch (e) {}
  });
  state.uiEventSource.addEventListener("error", () => {
    try {
      if (state && typeof state === "object") {
        if (state.sseHadError) return;
        state.sseHadError = true;
      }
      try { setStatus(dom, "连接已断开，等待自动重连…"); } catch (_) {}
    } catch (_) {}
  });
}
