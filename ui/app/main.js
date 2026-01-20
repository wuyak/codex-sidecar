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
      // 离线会话：仅展示/导出，不影响实时监听的 follow 选择。
      if (isOfflineKey(key)) return;
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
    state.currentKey = key;
    try { updateUnreadButton(dom, state); } catch (_) {}
    const { needsRefresh } = activateView(dom, state, key);
    // 快速 UI 反馈：先更新选中态，再异步拉取/重绘消息列表。
    try { renderTabsWrapper(dom, state); } catch (_) {}
    await applyFollowPolicy(key);
    // 优先回放后台缓冲的 SSE（避免频繁切换时每次都全量 refreshList）。
    let overflow = false;
    try {
      if (!needsRefresh && key !== "all") {
        const r = drainBufferedForKey(dom, state, key, renderMessage, renderTabsWrapper);
        overflow = !!(r && r.overflow);
      }
    } catch (_) {}
    if (key === "all" || needsRefresh || overflow) {
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
