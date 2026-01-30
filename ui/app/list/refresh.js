import { inferToolName, parseToolCallText } from "../format.js";
import { keyOf, safeJsonParse, tsToMs } from "../utils.js";
import { refreshThreads } from "./threads.js";
import { isOfflineKey, offlineRelFromKey } from "../offline.js";
import { saveOfflineShowList, upsertOfflineShow } from "../offline_show.js";
import { loadOfflineZhMap } from "../offline_zh.js";

function _yieldToBrowser(timeoutMs = 120) {
  const t = Number.isFinite(Number(timeoutMs)) ? Number(timeoutMs) : 120;
  return new Promise((resolve) => {
    try {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(() => resolve(), { timeout: Math.max(0, t) });
        return;
      }
    } catch (_) {}
    setTimeout(() => resolve(), 0);
  });
}

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
      if (isOfflineKey(state.currentKey)) {
        const rel = offlineRelFromKey(state.currentKey);
        const tail = Math.max(0, Number(state.replayLastLines) || 0) || 200;
        url = `/api/offline/messages?rel=${encodeURIComponent(rel)}&tail_lines=${encodeURIComponent(tail)}`;
      } else {
      const t = state.threadIndex.get(state.currentKey);
      if (t && t.thread_id) {
        url = `/api/messages?thread_id=${encodeURIComponent(t.thread_id)}`;
      }
      }
    }
    const resp = await fetch(url, ac ? { signal: ac.signal } : undefined);
    if (token && state && state.refreshToken !== token) return;
    const data = await resp.json();
    const msgs = (data.messages || []);
    // 离线会话：回填“展示中”元信息（file/thread_id），便于标签与导出（不污染 threadIndex）。
    try {
      if (isOfflineKey(state.currentKey)) {
        const k = String(state.currentKey || "");
        const rel = offlineRelFromKey(k);
        const fp = String(data && data.file ? data.file : "").trim();
        let tid = "";
        try { tid = String(msgs && msgs[0] && msgs[0].thread_id ? msgs[0].thread_id : "").trim(); } catch (_) { tid = ""; }
        if (rel && (fp || tid)) {
          let same = false;
          try {
            const cur = Array.isArray(state && state.offlineShow) ? state.offlineShow : [];
            for (const it of cur) {
              if (!it || typeof it !== "object") continue;
              if (String(it.rel || "") !== rel) continue;
              const f0 = String(it.file || "").trim();
              const t0 = String(it.thread_id || "").trim();
              const f1 = String(fp || "").trim();
              const t1 = String(tid || "").trim();
              same = (f0 === f1) && (t0 === t1);
              break;
            }
          } catch (_) {}
          if (!same) {
            const next = upsertOfflineShow(state.offlineShow, { rel, file: fp, thread_id: tid });
            state.offlineShow = next;
            saveOfflineShowList(next);
          }
        }
      }
    } catch (_) {}
    // 离线会话：回填本地译文缓存（localStorage offlineZh:${rel} + 内存 Map），不依赖后端 SidecarState。
    try {
      if (isOfflineKey(state.currentKey)) {
        const rel = offlineRelFromKey(state.currentKey);
        const fromLs = rel ? loadOfflineZhMap(rel) : {};
        if (!state.offlineZhById || typeof state.offlineZhById.get !== "function") state.offlineZhById = new Map();
        for (const m of msgs) {
          if (!m || typeof m !== "object") continue;
          if (String(m.kind || "") !== "reasoning_summary") continue;
          const mid = String(m.id || "").trim();
          if (!mid) continue;
          const curZh = String(m.zh || "").trim();
          if (curZh) continue;

          let zh = "";
          try { zh = String(fromLs && fromLs[mid] ? fromLs[mid] : "").trim(); } catch (_) { zh = ""; }
          if (!zh) {
            const cached = state.offlineZhById.get(mid);
            if (cached && typeof cached === "object") {
              zh = String(cached.zh || "").trim();
              const err = String(cached.err || "").trim();
              if (err) m.translate_error = err;
            }
          }
          if (zh) {
            m.zh = zh;
            try { state.offlineZhById.set(mid, { zh, err: "" }); } catch (_) {}
          }
        }
      }
    } catch (_) {}
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
      const tailImmediate = 80;
      // Render in chunks to keep the page responsive for large histories.
      const CHUNK = 36;
      let frag = document.createDocumentFragment();
      for (let i = 0; i < filtered.length; i++) {
        if (token && state && state.refreshToken !== token) return;
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
        if (((i + 1) % CHUNK) === 0) {
          if (dom.list) dom.list.appendChild(frag);
          frag = document.createDocumentFragment();
          await _yieldToBrowser();
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
