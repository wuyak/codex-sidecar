import { inferToolName, parseToolCallText } from "./format.js";
import { keyOf, safeJsonParse } from "./utils.js";

export async function refreshList(dom, state, renderTabs, renderMessage, renderEmpty) {
  try {
    let url = "/api/messages";
    // 当前 key 为 thread_id 时，走服务端过滤；否则退化为前端过滤（例如 key=file/unknown）
    if (state.currentKey !== "all") {
      const t = state.threadIndex.get(state.currentKey);
      if (t && t.thread_id) {
        url = `/api/messages?thread_id=${encodeURIComponent(t.thread_id)}`;
      }
    }
    const resp = await fetch(url);
    const data = await resp.json();
    const msgs = (data.messages || []);
    state.callIndex.clear();
    if (dom.list) while (dom.list.firstChild) dom.list.removeChild(dom.list.firstChild);
    const filtered = state.currentKey === "all" ? msgs : msgs.filter(m => keyOf(m) === state.currentKey);

    // Pre-index tool_call so tool_output can always resolve tool_name even if order is odd.
    for (const m of filtered) {
      try {
        if (!m || m.kind !== "tool_call") continue;
        const parsed = parseToolCallText(m.text || "");
        let toolName = parsed.toolName || "";
        const callId = parsed.callId || "";
        const argsRaw = parsed.argsRaw || "";
        const argsObj = safeJsonParse(argsRaw);
        toolName = inferToolName(toolName, argsRaw, argsObj);
        if (callId) state.callIndex.set(callId, { tool_name: toolName, args_raw: argsRaw, args_obj: argsObj });
      } catch (_) {}
    }

    if (filtered.length === 0) renderEmpty(dom);
    else for (const m of filtered) renderMessage(dom, state, m);
  } catch (e) {
    if (dom.list) while (dom.list.firstChild) dom.list.removeChild(dom.list.firstChild);
    renderEmpty(dom);
  }
  renderTabs(dom, state);
}

export async function bootstrap(dom, state, renderTabs, renderMessage, renderEmpty) {
  try {
    // 先加载 thread 列表（若为空也没关系），再加载消息列表。
    try {
      const tr = await fetch("/api/threads");
      const td = await tr.json();
      const threads = td.threads || [];
      for (const t of threads) state.threadIndex.set(t.key, t);
    } catch (e) {}

    // Sync UI selection with watcher follow mode (avoid “UI 显示全部，但实际上已锁定跟随某会话”).
    try {
      const st = await fetch("/api/status", { cache: "no-store" }).then(r => r.json());
      const follow = (st && typeof st === "object") ? (st.follow || {}) : {};
      const mode = String((follow && follow.mode) ? follow.mode : "").trim().toLowerCase();
      const tid = String((follow && follow.thread_id) ? follow.thread_id : "").trim();
      const file = String((follow && follow.file) ? follow.file : "").trim();
      if (mode === "pin" && (tid || file)) {
        let key = "";
        if (tid && state.threadIndex.has(tid)) key = tid;
        if (!key && file) {
          for (const t of state.threadIndex.values()) {
            if (t && String(t.file || "") === file) { key = String(t.key || ""); break; }
          }
        }
        // Only apply when we can map it to an existing tab; otherwise keep "all".
        if (key) state.currentKey = key;
      }
    } catch (e) {}

    await refreshList(dom, state, renderTabs, renderMessage, renderEmpty);
  } catch (e) {
    if (dom.list) while (dom.list.firstChild) dom.list.removeChild(dom.list.firstChild);
    renderEmpty(dom);
  }
}
