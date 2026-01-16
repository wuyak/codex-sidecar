import { getDom } from "./dom.js";
import { connectEventStream, drainBufferedForKey } from "./events.js";
import { loadControl, maybeAutoStartOnce, setStatus, wireControlEvents } from "./control.js";
import { bootstrap, refreshList } from "./list.js";
import { renderEmpty, renderMessage } from "./render.js";
import { createState } from "./state.js";
import { renderTabs, upsertThread } from "./sidebar.js";
import { loadHiddenThreads, loadShowHiddenFlag } from "./sidebar/hidden.js";
import { wireThinkingRowActions } from "./interactions/thinking_rows.js";
import { syncSidebarHeadButtons, wireSidebarHeadActions } from "./interactions/sidebar_head.js";
import { flashToastAt } from "./utils/toast.js";
import { initViewMode } from "./view_mode.js";
import { activateView, initViews } from "./views.js";
import { initSound } from "./sound.js";

export async function initApp() {
  const dom = getDom();
  const state = createState();
  initSound(dom, state);
  initViews(dom, state);
  initViewMode(dom, state);
  try { state.hiddenThreads = loadHiddenThreads(); } catch (_) { state.hiddenThreads = new Set(); }
  try { state.showHiddenThreads = loadShowHiddenFlag(); } catch (_) { state.showHiddenThreads = false; }

  const toastBtn = (btn, text) => {
    if (!btn || !btn.getBoundingClientRect) return;
    try {
      const r = btn.getBoundingClientRect();
      flashToastAt(r.left + r.width / 2, r.top + r.height / 2, text, { isLight: true, durationMs: 1200 });
    } catch (_) {}
  };

  const syncButtons = () => syncSidebarHeadButtons(dom, state);
  syncButtons();

  // UI preference: whether selecting a session tab should pin the watcher.
  try {
    const v = localStorage.getItem("codex_sidecar_pin_on_select");
    if (dom.pinOnSelect) dom.pinOnSelect.checked = (v === "1");
  } catch (_) {}

  const applyFollowPolicy = async (key) => {
    try {
      const pinOnSelect = !!(dom.pinOnSelect && dom.pinOnSelect.checked);
      if (key === "all") {
        await fetch("/api/control/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "auto" }),
        });
        return;
      }
      if (!pinOnSelect) return;
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

  try {
    if (dom.pinOnSelect) dom.pinOnSelect.addEventListener("change", () => {
      try { localStorage.setItem("codex_sidecar_pin_on_select", dom.pinOnSelect.checked ? "1" : "0"); } catch (_) {}
      // If user turns pin off, release watcher so new sessions can be discovered.
      // If user turns pin on while viewing a session, pin immediately.
      try {
        if (!dom.pinOnSelect.checked) {
          Promise.resolve(fetch("/api/control/follow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "auto" }),
          })).catch(() => {});
        } else {
          Promise.resolve(applyFollowPolicy(state.currentKey || "all")).catch(() => {});
        }
      } catch (_) {}
    });
  } catch (_) {}

  wireThinkingRowActions(dom, state);

  const onSelectKey = async (key) => {
    state.currentKey = key;
    const { needsRefresh } = activateView(dom, state, key);
    // 快速 UI 反馈：先更新选中态，再异步拉取/重绘消息列表。
    try { renderTabsWrapper(dom, state); } catch (_) {}
    try { syncButtons(); } catch (_) {}
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

  // Sidebar head actions: export / hide / show hidden
  wireSidebarHeadActions(dom, state, {
    toastBtn,
    onSelectKey,
    renderTabs: () => renderTabsWrapper(dom, state),
    syncButtons,
  });

  wireControlEvents(dom, state, {
    refreshList: refreshListWrapper,
    renderTabs: () => renderTabsWrapper(dom, state),
  });

  await loadControl(dom, state);
  await maybeAutoStartOnce(dom, state);
  await loadControl(dom, state);

  await bootstrap(dom, state, renderTabsWrapper, renderMessage, renderEmpty);
  connectEventStream(dom, state, upsertThread, renderTabsWrapper, renderMessage, setStatus, refreshListWrapper);
}
