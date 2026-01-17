import { inferToolName, parseToolCallText } from "../format.js";
import { keyOf, safeJsonParse, tsToMs } from "../utils.js";
import { refreshThreads } from "./threads.js";

export async function refreshList(dom, state, renderTabs, renderMessage, renderEmpty) {
  const token = (state && typeof state === "object")
    ? (state.refreshToken = (Number(state.refreshToken) || 0) + 1)
    : 0;
  const wasAtBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 80);
  if (state && typeof state === "object") state.isRefreshing = true;
  // 全量回源会覆盖当前视图：清理该 key 的 SSE 缓冲，避免回放重复插入。
  try {
    const k = String(state && state.currentKey ? state.currentKey : "");
    if (k && state.sseByKey && typeof state.sseByKey.delete === "function") state.sseByKey.delete(k);
    if (k && state.sseOverflow && typeof state.sseOverflow.delete === "function") state.sseOverflow.delete(k);
  } catch (_) {}
  let ac = null;
  try {
    try { if (state && state.refreshAbort) state.refreshAbort.abort(); } catch (_) {}
    ac = new AbortController();
    if (state && typeof state === "object") state.refreshAbort = ac;

    let url = "/api/messages";
    // 当前 key 为 thread_id 时，走服务端过滤；否则退化为前端过滤（例如 key=file/unknown）
    if (state.currentKey !== "all") {
      const t = state.threadIndex.get(state.currentKey);
      if (t && t.thread_id) {
        url = `/api/messages?thread_id=${encodeURIComponent(t.thread_id)}`;
      }
    }
    const resp = await fetch(url, ac ? { signal: ac.signal } : undefined);
    if (token && state && state.refreshToken !== token) return;
    const data = await resp.json();
    const msgs = (data.messages || []);
    state.callIndex.clear();
    if (state.rowIndex) state.rowIndex.clear();
    if (state.timeline && Array.isArray(state.timeline)) state.timeline.length = 0;
    if (dom.list) while (dom.list.firstChild) dom.list.removeChild(dom.list.firstChild);
    const filtered0 = state.currentKey === "all" ? msgs : msgs.filter(m => keyOf(m) === state.currentKey);

    // Sort by (timestamp, seq) to keep a stable timeline even when upstream is slightly out-of-order.
    const filtered = filtered0
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const ta = tsToMs(a.m && a.m.ts);
        const tb = tsToMs(b.m && b.m.ts);
        const fa = Number.isFinite(ta);
        const fb = Number.isFinite(tb);
        if (fa && fb) {
          if (ta !== tb) return ta - tb;
        } else if (fa) return -1;
        else if (fb) return 1;
        const sa = Number.isFinite(Number(a.m && a.m.seq)) ? Number(a.m.seq) : NaN;
        const sb = Number.isFinite(Number(b.m && b.m.seq)) ? Number(b.m.seq) : NaN;
        const fsa = Number.isFinite(sa);
        const fsb = Number.isFinite(sb);
        if (fsa && fsb) {
          if (sa !== sb) return sa - sb;
        } else if (fsa) return -1;
        else if (fsb) return 1;
        return a.i - b.i;
      })
      .map(x => x.m);

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

    state.lastRenderedMs = NaN;
    if (filtered.length === 0) renderEmpty(dom);
    else {
      const frag = document.createDocumentFragment();
      const tailImmediate = 80;
      for (let i = 0; i < filtered.length; i++) {
        const m = filtered[i];
        const deferDecorate = (filtered.length - i) > tailImmediate;
        renderMessage(dom, state, m, { list: frag, autoscroll: false, deferDecorate });
        const ms = tsToMs(m && m.ts);
        if (Number.isFinite(ms)) state.lastRenderedMs = ms;
        const mid = (m && typeof m.id === "string") ? m.id : "";
        if (mid && state.rowIndex && state.rowIndex.has(mid) && state.timeline && Array.isArray(state.timeline)) {
          const seq = Number.isFinite(Number(m && m.seq)) ? Number(m.seq) : NaN;
          state.timeline.push({ id: mid, ms, seq });
        }
      }
      if (dom.list) dom.list.appendChild(frag);
      if (wasAtBottom) window.scrollTo(0, document.body.scrollHeight);
    }

    // Keep thread list in sync after reconnect or occasional long-running use.
    try {
      const now = Date.now();
      const last = Number(state.threadsLastSyncMs) || 0;
      const needs = !!state.threadsDirty
        || (state.threadIndex && typeof state.threadIndex.size === "number" && state.threadIndex.size === 0)
        || (state.currentKey === "all" && (now - last) > 60000);
      if (needs) await refreshThreads(state, ac ? ac.signal : undefined);
    } catch (_) {}
  } catch (e) {
    if (token && state && state.refreshToken !== token) return;
    if (e && e.name === "AbortError") return;
    if (dom.list) while (dom.list.firstChild) dom.list.removeChild(dom.list.firstChild);
    renderEmpty(dom);
  } finally {
    if (token && state && state.refreshToken === token) {
      state.isRefreshing = false;
      if (state.refreshAbort === ac) state.refreshAbort = null;
    }
  }
  renderTabs(dom, state);
}

