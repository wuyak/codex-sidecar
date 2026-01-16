import { getDom } from "./dom.js";
import { connectEventStream, drainBufferedForKey } from "./events.js";
import { loadControl, maybeAutoStartOnce, setStatus, wireControlEvents } from "./control.js";
import { exportCurrentThreadMarkdown } from "./export.js";
import { bootstrap, refreshList } from "./list.js";
import { renderEmpty, renderMessage } from "./render.js";
import { createState } from "./state.js";
import { renderTabs, upsertThread } from "./sidebar.js";
import { loadHiddenThreads, loadShowHiddenFlag, saveHiddenThreads, saveShowHiddenFlag } from "./sidebar/hidden.js";
import { wireThinkingRowActions } from "./interactions/thinking_rows.js";
import { flashToastAt } from "./utils/toast.js";
import { initViewMode } from "./view_mode.js";
import { activateView, initViews } from "./views.js";

export async function initApp() {
  const dom = getDom();
  const state = createState();
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

  const syncSidebarHeadButtons = () => {
    const key = String(state.currentKey || "all");
    const isAll = (key === "all");
    const hidden = !!(key && key !== "all" && state.hiddenThreads && typeof state.hiddenThreads.has === "function" && state.hiddenThreads.has(key));
    try {
      if (dom.exportThreadBtn) dom.exportThreadBtn.disabled = isAll;
      if (dom.hideThreadBtn) dom.hideThreadBtn.disabled = isAll;
      if (dom.hideThreadBtn && dom.hideThreadBtn.classList) dom.hideThreadBtn.classList.toggle("active", hidden);
      if (dom.hideThreadBtn) dom.hideThreadBtn.title = hidden ? "取消隐藏当前会话" : "隐藏当前会话";
      if (dom.showHiddenBtn && dom.showHiddenBtn.classList) dom.showHiddenBtn.classList.toggle("active", !!state.showHiddenThreads);
      if (dom.showHiddenBtn) dom.showHiddenBtn.title = state.showHiddenThreads ? "已显示隐藏会话" : "显示隐藏会话";
    } catch (_) {}
  };
  syncSidebarHeadButtons();

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
    try { syncSidebarHeadButtons(); } catch (_) {}
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
  try {
    if (dom.showHiddenBtn) dom.showHiddenBtn.addEventListener("click", () => {
      state.showHiddenThreads = !state.showHiddenThreads;
      saveShowHiddenFlag(!!state.showHiddenThreads);
      syncSidebarHeadButtons();
      try { renderTabsWrapper(dom, state); } catch (_) {}
      toastBtn(dom.showHiddenBtn, state.showHiddenThreads ? "已显示隐藏会话" : "已隐藏隐藏会话");
    });
    if (dom.hideThreadBtn) dom.hideThreadBtn.addEventListener("click", async () => {
      const key = String(state.currentKey || "all");
      if (!key || key === "all") { toastBtn(dom.hideThreadBtn, "请先选择具体会话"); return; }
      if (!state.hiddenThreads || typeof state.hiddenThreads.add !== "function") state.hiddenThreads = new Set();
      const was = state.hiddenThreads.has(key);
      if (was) state.hiddenThreads.delete(key);
      else state.hiddenThreads.add(key);
      saveHiddenThreads(state.hiddenThreads);
      toastBtn(dom.hideThreadBtn, was ? "已取消隐藏" : "已隐藏会话");
      // If we just hid the current session and hidden items are not shown, jump to "all" to avoid “消失”困惑。
      if (!was && !state.showHiddenThreads) {
        await onSelectKey("all");
      } else {
        try { renderTabsWrapper(dom, state); } catch (_) {}
      }
      syncSidebarHeadButtons();
    });
    if (dom.exportThreadBtn) dom.exportThreadBtn.addEventListener("click", async () => {
      const key = String(state.currentKey || "all");
      if (!key || key === "all") { toastBtn(dom.exportThreadBtn, "请先选择具体会话"); return; }
      toastBtn(dom.exportThreadBtn, "正在导出…");
      const mode = (String(state.viewMode || "").toLowerCase() === "quick") ? "quick" : "full";
      const r = await exportCurrentThreadMarkdown(state, { mode });
      if (r && r.ok) toastBtn(dom.exportThreadBtn, "已导出（下载）");
      else toastBtn(dom.exportThreadBtn, "导出失败");
    });
  } catch (_) {}

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
