import { activateView } from "../views.js";
import { refreshList } from "./refresh.js";
import { refreshThreads } from "./threads.js";

export async function bootstrap(dom, state, renderTabs, renderMessage, renderEmpty) {
  try {
    // 先加载 thread 列表（若为空也没关系），再加载消息列表。
    try { await refreshThreads(state, undefined); } catch (_) {}

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

