import { activateView } from "../views.js";
import { refreshList } from "./refresh.js";
import { refreshThreads } from "./threads.js";

export async function bootstrap(dom, state, renderTabs, renderMessage, renderEmpty) {
  try {
    // 先加载 thread 列表（若为空也没关系），再加载消息列表。
    try { await refreshThreads(state, undefined); } catch (_) {}

    // Sync UI selection with watcher follow mode (avoid “UI 显示全部，但实际上已锁定跟随某会话”).
    try {
      let pinOnSelect = false;
      try { pinOnSelect = localStorage.getItem("codex_sidecar_pin_on_select") !== "0"; } catch (_) { pinOnSelect = true; }
      const st = await fetch("/api/status", { cache: "no-store" }).then(r => r.json());
      const follow = (st && typeof st === "object") ? (st.follow || {}) : {};
      const mode = String((follow && follow.mode) ? follow.mode : "").trim().toLowerCase();
      const tid = String((follow && follow.thread_id) ? follow.thread_id : "").trim();
      const file = String((follow && follow.file) ? follow.file : "").trim();
      // If the UI preference disables pin-on-select, proactively release pin so new sessions can be discovered.
      if (mode === "pin" && (tid || file) && !pinOnSelect) {
        try {
          await fetch("/api/control/follow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "auto" }),
          });
        } catch (_) {}
      } else if (mode === "pin" && (tid || file)) {
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
    } catch (_) {}

    // 默认不再显示“全部”标签：若当前仍为 all，则自动选中最新会话，确保底部标签栏有明确当前项。
    try {
      const cur = String(state && state.currentKey ? state.currentKey : "all");
      const hidden = (state && state.hiddenThreads && typeof state.hiddenThreads.has === "function") ? state.hiddenThreads : new Set();
      const closed = (state && state.closedThreads && typeof state.closedThreads.has === "function") ? state.closedThreads : null;
      if (cur === "all" && state.threadIndex && typeof state.threadIndex.values === "function") {
        const arr = Array.from(state.threadIndex.values());
        arr.sort((a, b) => {
          const sa = Number(a && a.last_seq) || 0;
          const sb = Number(b && b.last_seq) || 0;
          if (sa !== sb) return sb - sa;
          return String(b && b.last_ts ? b.last_ts : "").localeCompare(String(a && a.last_ts ? a.last_ts : ""));
        });
        let pick = "";
        for (const t of arr) {
          const k = String((t && t.key) ? t.key : "");
          if (!k) continue;
          if (hidden && typeof hidden.has === "function" && hidden.has(k)) continue;
          if (closed && typeof closed.has === "function" && closed.has(k)) continue;
          pick = k;
          break;
        }
        if (pick) state.currentKey = pick;
      }
    } catch (_) {}

    // bootstrap 可能根据 follow 状态修改 currentKey：同步切换到对应视图容器。
    try {
      const k = String(state && state.currentKey ? state.currentKey : "all");
      if (k && state && typeof state === "object") activateView(dom, state, k);
    } catch (_) {}

    await refreshList(dom, state, renderTabs, renderMessage, renderEmpty);
  } catch (_) {
    if (dom.list) while (dom.list.firstChild) dom.list.removeChild(dom.list.firstChild);
    renderEmpty(dom);
  }
}
