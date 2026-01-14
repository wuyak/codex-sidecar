import { api } from "./api.js";
import { clearView, restartProcess, startWatch, stopWatch } from "./actions.js";
import { recoverConfig, saveConfig } from "./config.js";
import { applyProfileToInputs, readHttpInputs, refreshHttpProfileSelect, upsertSelectedProfileFromInputs } from "./http_profiles.js";
import { closeDrawer, openDrawer, setStatus, showProviderBlocks } from "./ui.js";
import { showShutdownScreen } from "../shutdown.js";

export function wireControlEvents(dom, state, helpers) {
  const { refreshList } = helpers;

  if (dom.translatorSel) dom.translatorSel.addEventListener("change", () => {
    showProviderBlocks(dom, (dom.translatorSel.value || ""));
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

  if (dom.displayMode) dom.displayMode.addEventListener("change", async () => {
    try { localStorage.setItem("codex_sidecar_display_mode", dom.displayMode.value || "both"); } catch (_) {}
    await refreshList();
  });

  if (dom.saveBtn) dom.saveBtn.addEventListener("click", async () => { await saveConfig(dom, state); });
  if (dom.recoverBtn) dom.recoverBtn.addEventListener("click", async () => { await recoverConfig(dom, state); });
  if (dom.startBtn) dom.startBtn.addEventListener("click", async () => { await startWatch(dom, state); });
  if (dom.stopBtn) dom.stopBtn.addEventListener("click", async () => { await stopWatch(dom, state); });
  if (dom.restartBtn) dom.restartBtn.addEventListener("click", async () => { await restartProcess(dom, state); });
  if (dom.clearBtn) dom.clearBtn.addEventListener("click", async () => { await clearView(dom, state, refreshList); });

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
  if (dom.scrollBottomBtn) dom.scrollBottomBtn.addEventListener("click", () => { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); });

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

