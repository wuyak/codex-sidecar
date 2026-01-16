import { api } from "./api.js";
import { clearView, restartProcess, startWatch, stopWatch } from "./actions.js";
import { recoverConfig, saveConfig } from "./config.js";
import { applyProfileToInputs, readHttpInputs, refreshHttpProfileSelect, upsertSelectedProfileFromInputs } from "./http_profiles.js";
import { closeDrawer, openDrawer, setStatus, showProviderBlocks } from "./ui.js";
import { showShutdownScreen } from "../shutdown.js";
import { toggleViewMode } from "../view_mode.js";
import { clearAllUnread, clearUnreadForKey, getUnreadCount, getUnreadTotal, pickMostRecentUnreadKey, updateUnreadButton } from "../unread.js";
import { flashToastAt } from "../utils/toast.js";
import { buildThinkingMetaRight } from "../thinking/meta.js";
import { preloadNotifySound } from "../sound.js";

export function wireControlEvents(dom, state, helpers) {
  const { refreshList, onSelectKey } = helpers;

  const syncTranslateToggle = () => {
    const btn = dom && dom.translateToggleBtn ? dom.translateToggleBtn : null;
    if (!btn || !btn.classList) return;
    const isAuto = (String(state && state.translateMode ? state.translateMode : "").toLowerCase() !== "manual");
    try {
      btn.classList.toggle("active", isAuto);
      btn.title = isAuto ? "自动翻译：已开启" : "自动翻译：已关闭（手动）";
    } catch (_) {}
  };

  const refreshThinkingMetaRight = () => {
    const list = (state && state.activeList) ? state.activeList : (dom && dom.list ? dom.list : null);
    if (!list || !list.querySelectorAll) return;
    const nodes = list.querySelectorAll(".row.kind-reasoning_summary, .row.kind-agent_reasoning");
    for (const row of nodes) {
      try {
        const mid = String(row && row.dataset ? (row.dataset.msgId || "") : "").trim();
        if (!mid) continue;
        const metaRight = row.querySelector ? row.querySelector(".meta-right") : null;
        if (!metaRight) continue;
        const zhEl = row.querySelector ? row.querySelector(".think-zh") : null;
        const hasZh = !!(zhEl && String(zhEl.textContent || "").trim());
        const err = String((row.dataset && row.dataset.translateError) ? row.dataset.translateError : "").trim();
        const inFlight = !!(state && state.translateInFlight && typeof state.translateInFlight.has === "function" && state.translateInFlight.has(mid));
        const isAgent = !!(row && row.classList && row.classList.contains("kind-agent_reasoning"));
        const translateMode = isAgent
          ? "manual"
          : ((String(state && state.translateMode ? state.translateMode : "").toLowerCase() === "manual") ? "manual" : "auto");
        const provider = String(state && state.translatorProvider ? state.translatorProvider : "").trim().toLowerCase();
        metaRight.innerHTML = buildThinkingMetaRight({ mid, provider, hasZh, err, translateMode, inFlight });
      } catch (_) {}
    }
  };

  if (dom.translatorSel) dom.translatorSel.addEventListener("change", () => {
    showProviderBlocks(dom, (dom.translatorSel.value || ""));
  });
  if (dom.notifySound) dom.notifySound.addEventListener("change", async () => {
    const v = String(dom.notifySound.value || "none").trim().toLowerCase() || "none";
    try { state.notifySound = v; } catch (_) {}
    try { preloadNotifySound(state); } catch (_) {}
    try {
      await api("POST", "/api/config", { notify_sound: v });
    } catch (_) {}
    try {
      const r = dom.notifySound.getBoundingClientRect();
      flashToastAt(r.left + r.width / 2, r.top + r.height / 2, v === "none" ? "提示音：已关闭" : "提示音：已开启", { isLight: true, durationMs: 1100 });
    } catch (_) {}
  });

  if (dom.configToggleBtn) dom.configToggleBtn.addEventListener("click", () => {
    try {
      if (dom.drawer && !dom.drawer.classList.contains("hidden")) closeDrawer(dom);
      else openDrawer(dom);
    } catch (_) { openDrawer(dom); }
  });
  if (dom.drawerOverlay) dom.drawerOverlay.addEventListener("click", () => { closeDrawer(dom); });
  if (dom.drawerCloseBtn) dom.drawerCloseBtn.addEventListener("click", () => { closeDrawer(dom); });
  window.addEventListener("keydown", (e) => {
    try {
      if (e && e.key === "Escape") closeDrawer(dom);
    } catch (_) {}
  });

  if (dom.saveBtn) dom.saveBtn.addEventListener("click", async () => { await saveConfig(dom, state); });
  if (dom.recoverBtn) dom.recoverBtn.addEventListener("click", async () => { await recoverConfig(dom, state); });
  if (dom.startBtn) dom.startBtn.addEventListener("click", async () => { await startWatch(dom, state); });
  if (dom.stopBtn) dom.stopBtn.addEventListener("click", async () => { await stopWatch(dom, state); });
  if (dom.restartBtn) dom.restartBtn.addEventListener("click", async () => { await restartProcess(dom, state); });
  if (dom.clearBtn) dom.clearBtn.addEventListener("click", async () => { await clearView(dom, state, refreshList); });
  if (dom.quickViewBtn) dom.quickViewBtn.addEventListener("click", () => { toggleViewMode(dom, state); });
  if (dom.translateToggleBtn) dom.translateToggleBtn.addEventListener("click", async () => {
    const btn = dom.translateToggleBtn;
    const cur = (String(state && state.translateMode ? state.translateMode : "").toLowerCase() === "manual") ? "manual" : "auto";
    const next = (cur === "manual") ? "auto" : "manual";

    // Optimistic local update (UI).
    try { state.translateMode = next; } catch (_) {}
    try { if (dom.translateMode) dom.translateMode.value = next; } catch (_) {}
    syncTranslateToggle();
    refreshThinkingMetaRight();
    try {
      const r = btn.getBoundingClientRect();
      flashToastAt(r.left + r.width / 2, r.top + r.height / 2, next === "auto" ? "自动翻译：已开启" : "自动翻译：已关闭", { isLight: true, durationMs: 1100 });
    } catch (_) {}

    // Persist + apply runtime on server.
    try {
      const resp = await api("POST", "/api/config", { translate_mode: next });
      if (resp && resp.ok === false) throw new Error(String(resp.error || "config_update_failed"));
      const real = (resp && resp.translate_mode === "manual") ? "manual" : "auto";
      try { state.translateMode = real; } catch (_) {}
      try { if (dom.translateMode) dom.translateMode.value = real; } catch (_) {}
      syncTranslateToggle();
      refreshThinkingMetaRight();
    } catch (_) {
      // Revert on failure.
      try { state.translateMode = cur; } catch (_) {}
      try { if (dom.translateMode) dom.translateMode.value = cur; } catch (_) {}
      syncTranslateToggle();
      refreshThinkingMetaRight();
      try {
        const r = btn.getBoundingClientRect();
        flashToastAt(r.left + r.width / 2, r.top + r.height / 2, "切换失败", { isLight: true, durationMs: 1200 });
      } catch (_) {}
    }
  });

  if (dom.shutdownBtn) dom.shutdownBtn.addEventListener("click", async () => {
    if (!confirm("确定要退出 sidecar 进程？（将停止监听并关闭服务）")) return;
    setStatus(dom, "正在退出 sidecar…");
    try { if (state.uiEventSource) state.uiEventSource.close(); } catch (_) {}
    try { await api("POST", "/api/control/shutdown", {}); } catch (e) {}
    closeDrawer(dom);
    setTimeout(() => {
      try { window.close(); } catch (_) {}
      showShutdownScreen();
    }, 80);
  });

  if (dom.scrollTopBtn) dom.scrollTopBtn.addEventListener("click", () => { window.scrollTo({ top: 0, behavior: "smooth" }); });
  if (dom.scrollBottomBtn) dom.scrollBottomBtn.addEventListener("click", async () => {
    const total = getUnreadTotal(state);
    const atBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 80);
    const curKey = String(state && state.currentKey ? state.currentKey : "all");
    const curUnread = (curKey === "all") ? total : getUnreadCount(state, curKey);

    // 关闭通知：到达底部后再次点击 🔔 才清除未读（避免误清理/误判）。
    if (total > 0 && atBottom && (curKey === "all" || curUnread > 0)) {
      if (curKey === "all") clearAllUnread(state);
      else clearUnreadForKey(state, curKey);
      updateUnreadButton(dom, state);
      return;
    }

    // 有未读时：优先跳到“最近未读”的会话，再滚动到底部（多会话下更符合直觉）。
    if (total > 0) {
      const target = pickMostRecentUnreadKey(state);
      if (target && target !== curKey && typeof onSelectKey === "function") {
        try { await onSelectKey(target); } catch (_) {}
      }
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  });

  if (dom.httpProfile) dom.httpProfile.addEventListener("change", () => {
    upsertSelectedProfileFromInputs(dom, state);
    state.httpSelected = dom.httpProfile.value || "";
    if (state.httpSelected) applyProfileToInputs(dom, state, state.httpSelected);
  });

  if (dom.httpProfileAddBtn) dom.httpProfileAddBtn.addEventListener("click", () => {
    upsertSelectedProfileFromInputs(dom, state);
    const name = (prompt("新建 Profile 名称：", "默认") || "").trim();
    if (!name) return;
    if (state.httpProfiles.some(p => p && p.name === name)) {
      alert("该名称已存在");
      return;
    }
    state.httpProfiles.push({ name, ...readHttpInputs(dom) });
    state.httpSelected = name;
    refreshHttpProfileSelect(dom, state);
    if (dom.httpProfile) dom.httpProfile.value = state.httpSelected;
  });

  if (dom.httpProfileRenameBtn) dom.httpProfileRenameBtn.addEventListener("click", () => {
    upsertSelectedProfileFromInputs(dom, state);
    if (!state.httpSelected) return;
    const name = (prompt("将当前 Profile 重命名为：", state.httpSelected) || "").trim();
    if (!name || name === state.httpSelected) return;
    if (state.httpProfiles.some(p => p && p.name === name)) {
      alert("该名称已存在");
      return;
    }
    state.httpProfiles = state.httpProfiles.map(p => (p && p.name === state.httpSelected) ? { ...p, name } : p);
    state.httpSelected = name;
    refreshHttpProfileSelect(dom, state);
    if (dom.httpProfile) dom.httpProfile.value = state.httpSelected;
  });

  if (dom.httpProfileDelBtn) dom.httpProfileDelBtn.addEventListener("click", () => {
    if (!state.httpSelected) return;
    if (!confirm(`删除 Profile：${state.httpSelected} ?`)) return;
    state.httpProfiles = state.httpProfiles.filter(p => !(p && p.name === state.httpSelected));
    state.httpSelected = state.httpProfiles.length > 0 ? (state.httpProfiles[0].name || "") : "";
    refreshHttpProfileSelect(dom, state);
    if (state.httpSelected) applyProfileToInputs(dom, state, state.httpSelected);
    else {
      if (dom.httpUrl) dom.httpUrl.value = "";
      if (dom.httpTimeout) dom.httpTimeout.value = 3;
      if (dom.httpAuthEnv) dom.httpAuthEnv.value = "";
    }
  });
}
