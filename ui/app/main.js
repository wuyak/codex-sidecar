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
import { clearUnreadForKey } from "./unread.js";
import { initSkin } from "./skin.js";
import { loadClosedThreads, saveClosedThreads } from "./closed_threads.js";

export async function initApp() {
  const dom = getDom();
  const state = createState();
  initSound(dom, state);
  initViews(dom, state);
  initViewMode(dom, state);
  initSkin(dom, { setStatus });
  try { state.hiddenThreads = loadHiddenThreads(); } catch (_) { state.hiddenThreads = new Set(); }
  try { state.showHiddenThreads = loadShowHiddenFlag(); } catch (_) { state.showHiddenThreads = false; }
  try { state.closedThreads = loadClosedThreads(); } catch (_) { state.closedThreads = new Map(); }

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
    // Selecting a session implies "read it": clear unread badge on that bookmark.
    try { if (key && key !== "all") clearUnreadForKey(state, key); } catch (_) {}
    try {
      if (key && key !== "all" && state.closedThreads && typeof state.closedThreads.delete === "function") {
        const had = state.closedThreads.delete(key);
        if (had) saveClosedThreads(state.closedThreads);
      }
    } catch (_) {}
    state.currentKey = key;
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
