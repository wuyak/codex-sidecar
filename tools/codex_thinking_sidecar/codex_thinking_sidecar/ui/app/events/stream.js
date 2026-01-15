import { keyOf } from "../utils.js";
import { applyMsgToList } from "./timeline.js";
import { bufferForKey, pushPending, shouldBufferKey } from "./buffer.js";
import { dismissCorner, notifyCorner } from "../utils/notify.js";

function _toolGateWaiting(text) {
  const s = String(text || "");
  return s.includes("等待确认") || s.toLowerCase().includes("waiting for tool gate");
}

function _toolGateReleased(text) {
  const s = String(text || "");
  return s.includes("已确认") || s.toLowerCase().includes("tool gate released");
}

function _summarizeToolGate(text) {
  const lines = String(text || "").split("\n");
  let tool = "";
  let just = "";
  let cmd = "";
  let inCode = false;
  for (const raw of lines) {
    const ln = String(raw || "").trim();
    if (!ln) continue;
    if (ln.startsWith("```")) { inCode = !inCode; continue; }
    if (inCode && !cmd) { cmd = ln; continue; }
    if (!tool && ln.startsWith("- 工具")) tool = ln.replace(/^-\\s*工具\\s*[:：]\\s*/g, "").replaceAll("`", "").trim();
    if (!just && (ln.startsWith("- 原因") || ln.startsWith("- 理由"))) just = ln.replace(/^-\\s*(原因|理由)[^:：]*[:：]\\s*/g, "").trim();
  }
  const parts = [];
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
      // 右下角提醒（不依赖当前会话/是否可见，避免错过关键状态）
      try {
        const kind = String((msg && msg.kind) ? msg.kind : "").trim();
        if (kind === "tool_gate") {
          const txt = String(msg.text || "");
          if (_toolGateWaiting(txt)) {
            notifyCorner("tool_gate", "终端等待确认", _summarizeToolGate(txt) || "请回到终端完成确认/授权后继续。", { level: "warn", sticky: true });
          } else if (_toolGateReleased(txt)) {
            // 已确认：提示一下并自动消退
            notifyCorner("tool_gate", "终端已确认", _summarizeToolGate(txt) || "tool gate 已解除。", { level: "success", ttlMs: 1600 });
          }
        } else if (kind === "assistant_message") {
          // 可选提醒：用户不在底部且当前视图会渲染到该输出时提示“有新输出”
          const atBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 80);
          if (!atBottom) {
            const k = keyOf(msg);
            const shouldNotify = (state.currentKey === "all" || state.currentKey === k);
            if (shouldNotify && op !== "update") {
              notifyCorner("new_output", "有新输出", "你不在页面底部，可点击 ↓ 跳转。", { level: "info", ttlMs: 2200 });
            }
          } else {
            // 在底部时不需要提醒，且可清理旧提示
            dismissCorner("new_output");
          }
        }
      } catch (_) {}
      // Clear manual translate in-flight state as soon as ZH arrives, so render can flip status immediately.
      try {
        if (op === "update" && msg && typeof msg.id === "string" && state && state.translateInFlight && typeof state.translateInFlight.delete === "function") {
          const hasZh = (typeof msg.zh === "string") && String(msg.zh || "").trim();
          const hasErr = (typeof msg.translate_error === "string") && String(msg.translate_error || "").trim();
          if (hasZh || hasErr) state.translateInFlight.delete(msg.id);
        }
      } catch (_) {}

      // Updates should not bump thread counts.
      if (op !== "update") upsertThread(state, msg);

      const k = keyOf(msg);
      const shouldRender = (state.currentKey === "all" || state.currentKey === k);
      if (shouldRender) {
        applyMsgToList(dom, state, msg, renderMessage);
        // 当前在 all 视图时，其他已缓存会话的视图仍需要“慢慢跟上”，否则切回会显示旧内容。
        if (state.currentKey === "all" && shouldBufferKey(state, k)) {
          bufferForKey(state, k, msg);
        }
      } else {
        // 仅为“已缓存的会话视图”缓冲，避免长时间挂着时对大量冷门 key 无限占用内存。
        if (shouldBufferKey(state, k)) bufferForKey(state, k, msg);
      }
      // 译文回填（op=update）不影响会话计数/排序，避免每条 update 都重绘侧栏。
      if (op !== "update") _scheduleTabs(80);
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
