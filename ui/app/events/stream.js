import { keyOf } from "../utils.js";
import { applyMsgToList } from "./timeline.js";
import { bufferForKey, pushPending, shouldBufferKey } from "./buffer.js";
import { notifyCorner } from "../utils/notify.js";
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

function _summarizeToolGate(text) {
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
    if (!tool && ln.startsWith("- 工具")) tool = ln.replace(/^-\\s*工具\\s*[:：]\\s*/g, "").replaceAll("`", "").trim();
    if (!just && (ln.startsWith("- 原因") || ln.startsWith("- 理由"))) just = ln.replace(/^-\\s*(原因|理由)[^:：]*[:：]\\s*/g, "").trim();
  }
  const parts = [];
  if (maybeStale) parts.push("注：可能是历史残留");
  if (tool) parts.push(`工具：${tool}`);
  if (just) parts.push(`原因：${just}`);
  if (cmd) parts.push(`命令：${cmd}`);
  return parts.join("\n");
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

      // 右下角提醒（不依赖当前会话可见性：通过“未读”汇总，避免错过多会话输出）
      try {
        const kind = String((msg && msg.kind) ? msg.kind : "").trim();
        if (!isHidden && kind === "tool_gate") {
          const txt = String(msg.text || "");
          if (_toolGateWaiting(txt)) {
            notifyCorner("tool_gate", "终端等待确认", _summarizeToolGate(txt) || "请回到终端完成确认/授权后继续。", { level: "warn", sticky: true });
            // tool_gate 属于“显式通知”：无论当前是否在对应会话，都应提示；但回放/历史补齐不应响铃。
            if (!isReplay) {
              const mid = String((msg && msg.id) ? msg.id : "").trim();
              if (_shouldRingForId(state, mid)) {
                try { maybePlayNotifySound(dom, state, { kind: "tool_gate" }); } catch (_) {}
              }
            }
          } else if (_toolGateReleased(txt)) {
            notifyCorner("tool_gate", "终端已确认", _summarizeToolGate(txt) || "tool gate 已解除。", { level: "success", ttlMs: 1600 });
          }
        }
        // “未读”仅对用户关心的类型：回答输出 / 审批提示。
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
