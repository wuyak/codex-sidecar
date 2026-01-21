import { getDom } from "./dom.js";
import { connectEventStream, drainBufferedForKey } from "./events.js";
import { loadControl, maybeAutoStartOnce, setStatus, wireControlEvents } from "./control.js";
import { bootstrap, refreshList } from "./list.js";
import { renderEmpty, renderMessage } from "./render.js";
import { createState } from "./state.js";
import { renderTabs, upsertThread } from "./sidebar.js";
import { loadHiddenThreads, loadShowHiddenFlag } from "./sidebar/hidden.js";
import { wireThinkingRowActions } from "./interactions/thinking_rows.js";
import { initViewMode } from "./view_mode.js";
import { activateView, initViews } from "./views.js";
import { initSound } from "./sound.js";
import { updateUnreadButton } from "./unread.js";
import { initTheme } from "./theme.js";
import { loadClosedThreads, saveClosedThreads } from "./closed_threads.js";
import { initQuickViewSettings } from "./quick_view_settings.js";
import { isOfflineKey } from "./offline.js";
import { loadOfflineShowList } from "./offline_show.js";

export async function initApp() {
  const dom = getDom();
  const state = createState();
  initSound(dom, state);
  initViews(dom, state);
  initViewMode(dom, state);
  try { initQuickViewSettings(dom, state); } catch (_) {}
  await initTheme(dom, { setStatus });
  try { state.hiddenThreads = loadHiddenThreads(); } catch (_) { state.hiddenThreads = new Set(); }
  try { state.showHiddenThreads = loadShowHiddenFlag(); } catch (_) { state.showHiddenThreads = false; }
  try { state.closedThreads = loadClosedThreads(); } catch (_) { state.closedThreads = new Map(); }
  try { state.offlineShow = loadOfflineShowList(); } catch (_) { state.offlineShow = []; }

  // 将“关闭监听”（本机 localStorage）同步到后端 watcher：真正停止轮询/读取，避免提示音与资源开销。
  const _syncFollowExcludes = async () => {
    try {
      const set = (state && state.hiddenThreads && typeof state.hiddenThreads.values === "function") ? state.hiddenThreads : new Set();
      const keys = Array.from(set.values());
      await fetch("/api/control/follow_excludes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys }),
      });
    } catch (_) {}
  };
  try { await _syncFollowExcludes(); } catch (_) {}
  try {
    let t = 0;
    window.addEventListener("hidden-threads-changed", () => {
      if (t) { try { clearTimeout(t); } catch (_) {} }
      t = setTimeout(() => {
        t = 0;
        try { state.hiddenThreads = loadHiddenThreads(); } catch (_) { state.hiddenThreads = new Set(); }
        try { _syncFollowExcludes(); } catch (_) {}
      }, 80);
    });
  } catch (_) {}

  // 用户活跃度：仅把“明确交互”（按键/滚轮/点击）记为活跃，避免程序化滚动误判。
  try {
    const touch = () => {
      try { state.userHasInteracted = true; } catch (_) {}
      try { state.userLastActiveMs = Date.now(); } catch (_) {}
    };
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch, { passive: true });
    window.addEventListener("wheel", touch, { passive: true });
  } catch (_) {}

  const applyFollowPolicy = async (key) => {
    try {
      let pinOnSelect = true;
      try { pinOnSelect = localStorage.getItem("codex_sidecar_pin_on_select") !== "0"; } catch (_) { pinOnSelect = true; }

      if (key === "all") {
        await fetch("/api/control/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "auto" }),
        });
        return;
      }
      if (!pinOnSelect) {
        await fetch("/api/control/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "auto" }),
        });
        return;
      }
      const t = state.threadIndex.get(key) || {};
      const threadId = (t.thread_id || key || "").toString();
      const file = (t.file || "").toString();
      await fetch("/api/control/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "pin", thread_id: threadId, file }),
      });
    } catch (_) {}
  };

  wireThinkingRowActions(dom, state);

  const onSelectKey = async (key) => {
    // 切换会话不等于“已读”：保留未读队列，交由“未读跳转”逐条消化。
    try {
      if (key && key !== "all" && state.closedThreads && typeof state.closedThreads.delete === "function") {
        const had = state.closedThreads.delete(key);
        if (had) saveClosedThreads(state.closedThreads);
      }
    } catch (_) {}
    const offline = isOfflineKey(key);
    state.currentKey = key;
    try { updateUnreadButton(dom, state); } catch (_) {}
    const { needsRefresh } = activateView(dom, state, key);
    // 快速 UI 反馈：先更新选中态，再异步拉取/重绘消息列表。
    try { renderTabsWrapper(dom, state); } catch (_) {}
    if (!offline) await applyFollowPolicy(key);
    // 优先回放后台缓冲的 SSE（避免频繁切换时每次都全量 refreshList；离线视图不回放 SSE）。
    let overflow = false;
    try {
      if (!offline && !needsRefresh && key !== "all") {
        const r = drainBufferedForKey(dom, state, key, renderMessage, renderTabsWrapper);
        overflow = !!(r && r.overflow);
      }
    } catch (_) {}
    // 离线视图：每次切换都回源一次，保证“展示中”可追上最新写入（仍由 tail_lines 控制开销）。
    if (key === "all" || needsRefresh || overflow || offline) {
      await refreshList(dom, state, renderTabsWrapper, renderMessage, renderEmpty);
    }
  };

  const renderTabsWrapper = (d, s) => renderTabs(d, s, onSelectKey);
  const refreshListWrapper = async () => await refreshList(dom, state, renderTabsWrapper, renderMessage, renderEmpty);

  wireControlEvents(dom, state, {
    refreshList: refreshListWrapper,
    onSelectKey,
    renderTabs: () => renderTabsWrapper(dom, state),
  });

  await loadControl(dom, state);
  await maybeAutoStartOnce(dom, state);
  await loadControl(dom, state);

  await bootstrap(dom, state, renderTabsWrapper, renderMessage, renderEmpty);
  connectEventStream(dom, state, upsertThread, renderTabsWrapper, renderMessage, setStatus, refreshListWrapper);
}
