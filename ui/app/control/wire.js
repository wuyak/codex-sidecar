import { api } from "./api.js";
import { clearView, restartProcess, startWatch, stopWatch } from "./actions.js";
import { saveConfig, saveTranslateConfig } from "./config.js";
import { applyProfileToInputs, readHttpInputs, refreshHttpProfileSelect, upsertSelectedProfileFromInputs } from "./http_profiles.js";
import { closeBookmarkDrawer, closeDrawer, closeTranslateDrawer, confirmDialog, openDrawer, openTranslatorSettings, setStatus, setTopStatusSummary, showProviderBlocks } from "./ui.js";
import { showShutdownScreen } from "../shutdown.js";
import { toggleViewMode } from "../view_mode.js";
import { buildThinkingMetaRight } from "../thinking/meta.js";
import { openPopupNearEl, toastFromEl } from "./wire/ui_hints.js";
import { wireSecretToggles } from "./wire/secrets.js";
import { wireSfxSelects } from "./wire/sfx.js";
import { createExportPrefsPanel } from "./wire/export_prefs_panel.js";
import { wireBookmarkDrawer } from "./wire/bookmark_drawer.js";
import { LS_UI_BTN, LS_UI_FONT, applyUiButtonSize, applyUiFontSize } from "./ui_prefs.js";

export function wireControlEvents(dom, state, helpers) {
  const h = (helpers && typeof helpers === "object") ? helpers : {};
  const refreshList = typeof h.refreshList === "function" ? h.refreshList : (async () => {});
  const onSelectKey = typeof h.onSelectKey === "function" ? h.onSelectKey : (async () => {});
  const renderTabs = typeof h.renderTabs === "function" ? h.renderTabs : (() => {});
  let _bookmarkDrawer = null;
  const _renderBookmarkDrawerList = () => {
    try {
      if (_bookmarkDrawer && typeof _bookmarkDrawer.renderBookmarkDrawerList === "function") {
        _bookmarkDrawer.renderBookmarkDrawerList();
      }
    } catch (_) {}
  };

  const syncTranslateToggle = () => {
    const btn = dom && dom.translateToggleBtn ? dom.translateToggleBtn : null;
    if (!btn || !btn.classList) return;
    const isAuto = (String(state && state.translateMode ? state.translateMode : "").toLowerCase() !== "manual");
    try {
      btn.classList.toggle("active", isAuto);
    } catch (_) {}
    try {
      const hint = "（长按打开翻译设置）";
      btn.setAttribute("aria-label", isAuto ? `自动翻译：已开启${hint}` : `自动翻译：已关闭${hint}`);
    } catch (_) {}
    try { btn.dataset.mode = isAuto ? "A" : "手"; } catch (_) {}
  };

  const refreshThinkingMetaRight = () => {
    const list = (state && state.activeList) ? state.activeList : (dom && dom.list ? dom.list : null);
    if (!list || !list.querySelectorAll) return;
    const nodes = list.querySelectorAll(".row.kind-reasoning_summary");
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
        const translateMode = (String(state && state.translateMode ? state.translateMode : "").toLowerCase() === "manual") ? "manual" : "auto";
        const provider = String(state && state.translatorProvider ? state.translatorProvider : "").trim().toLowerCase();
        metaRight.innerHTML = buildThinkingMetaRight({ mid, provider, hasZh, err, translateMode, inFlight });
      } catch (_) {}
    }
  };

  const _sanitizeTranslateMode = (mode) => (String(mode || "").trim().toLowerCase() === "manual") ? "manual" : "auto";

  const _toastFromEl = (el, text, opts = {}) => { toastFromEl(el, text, opts); };

  const _clamp = (n, a, b) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return a;
    return Math.min(b, Math.max(a, x));
  };

  const _openPopupNearEl = openPopupNearEl;

  const _applyTranslateModeLocal = (mode) => {
    const m = _sanitizeTranslateMode(mode);
    try { state.translateMode = m; } catch (_) {}
    try { if (dom.translateMode) dom.translateMode.value = m; } catch (_) {}
    syncTranslateToggle();
    refreshThinkingMetaRight();
    try { setTopStatusSummary(dom, state); } catch (_) {}
    return m;
  };

  const _setTranslateMode = async (next, sourceEl) => {
    const cur = _sanitizeTranslateMode(state && state.translateMode);
    const want = _sanitizeTranslateMode(next);
    if (want === cur) {
      _applyTranslateModeLocal(cur);
      return { ok: true, mode: cur };
    }

    // Optimistic local update (UI).
    _applyTranslateModeLocal(want);
    _toastFromEl(sourceEl || (dom && dom.translateToggleBtn), want === "auto" ? "自动翻译：已开启" : "自动翻译：已关闭");

    // Persist + apply runtime on server.
    try {
      const resp = await api("POST", "/api/config", { translate_mode: want });
      if (resp && resp.ok === false) throw new Error(String(resp.error || "config_update_failed"));
      const real = (resp && resp.translate_mode === "manual") ? "manual" : "auto";
      _applyTranslateModeLocal(real);
      return { ok: true, mode: real };
    } catch (_) {
      // Revert on failure.
      _applyTranslateModeLocal(cur);
      _toastFromEl(sourceEl || (dom && dom.translateToggleBtn), "切换失败", { durationMs: 1200 });
      return { ok: false, mode: cur };
    }
  };

  if (dom.translatorSel) dom.translatorSel.addEventListener("change", () => {
    showProviderBlocks(dom, (dom.translatorSel.value || ""));
  });

  try { wireSecretToggles(dom, state); } catch (_) {}
  try { wireSfxSelects(dom, state); } catch (_) {}

  const _readSavedInt = (lsKey, fallback) => {
    try {
      const v = Number(localStorage.getItem(lsKey) || "");
      return Number.isFinite(v) ? v : fallback;
    } catch (_) {
      return fallback;
    }
  };

  const _parseIntStrict = (raw) => {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    if (!/^\d+$/.test(s)) return null;
    const n = Number.parseInt(s, 10);
    return Number.isFinite(n) ? n : null;
  };

  const _setInvalid = (el, bad) => {
    if (!el || !el.classList) return;
    try { el.classList.toggle("field-invalid", !!bad); } catch (_) {}
  };

  const _applyUiFontInput = (silent = false) => {
    const el = dom && dom.uiFontSize ? dom.uiFontSize : null;
    if (!el) return;
    const prev = _readSavedInt(LS_UI_FONT, 14);
    const n = _parseIntStrict(el.value);
    if (n == null || n < 12 || n > 24) {
      _setInvalid(el, true);
      try { el.value = String(prev); } catch (_) {}
      return;
    }
    _setInvalid(el, false);
    const v = applyUiFontSize(n);
    try { localStorage.setItem(LS_UI_FONT, String(v)); } catch (_) {}
  };

  const _applyUiFontDraft = () => {
    const el = dom && dom.uiFontSize ? dom.uiFontSize : null;
    if (!el) return;
    const s = String(el.value ?? "").trim();
    if (!s) { _setInvalid(el, false); return; }
    if (!/^\d+$/.test(s)) { _setInvalid(el, true); return; }
    const n = Number.parseInt(s, 10);
    if (!Number.isFinite(n) || n < 12 || n > 24) { _setInvalid(el, true); return; }
    _setInvalid(el, false);
    applyUiFontSize(n);
  };

  const _applyUiBtnInput = (silent = false) => {
    const el = dom && dom.uiBtnSize ? dom.uiBtnSize : null;
    if (!el) return;
    const prev = _readSavedInt(LS_UI_BTN, 38);
    const n = _parseIntStrict(el.value);
    if (n == null || n < 32 || n > 72) {
      _setInvalid(el, true);
      try { el.value = String(prev); } catch (_) {}
      return;
    }
    _setInvalid(el, false);
    const v = applyUiButtonSize(n);
    try { localStorage.setItem(LS_UI_BTN, String(v)); } catch (_) {}
  };

  const _applyUiBtnDraft = () => {
    const el = dom && dom.uiBtnSize ? dom.uiBtnSize : null;
    if (!el) return;
    const s = String(el.value ?? "").trim();
    if (!s) { _setInvalid(el, false); return; }
    if (!/^\d+$/.test(s)) { _setInvalid(el, true); return; }
    const n = Number.parseInt(s, 10);
    if (!Number.isFinite(n) || n < 32 || n > 72) { _setInvalid(el, true); return; }
    _setInvalid(el, false);
    applyUiButtonSize(n);
  };

  if (dom.uiFontSize) {
    dom.uiFontSize.addEventListener("input", () => _applyUiFontDraft());
    dom.uiFontSize.addEventListener("change", () => _applyUiFontInput(false));
    dom.uiFontSize.addEventListener("keydown", (e) => {
      if (e && String(e.key || "") === "Enter") { try { e.preventDefault(); } catch (_) {} try { dom.uiFontSize.blur(); } catch (_) {} }
    });
  }
  if (dom.uiBtnSize) {
    dom.uiBtnSize.addEventListener("input", () => _applyUiBtnDraft());
    dom.uiBtnSize.addEventListener("change", () => _applyUiBtnInput(false));
    dom.uiBtnSize.addEventListener("keydown", (e) => {
      if (e && String(e.key || "") === "Enter") { try { e.preventDefault(); } catch (_) {} try { dom.uiBtnSize.blur(); } catch (_) {} }
    });
  }

	  // 导出偏好：会话级（每个会话可单独设置 精简/全量、译文/原文）。
	  const _exportPrefs = createExportPrefsPanel(dom, state, {
	    toastFromEl: _toastFromEl,
	    openPopupNearEl: _openPopupNearEl,
	    clamp: _clamp,
	    renderBookmarkDrawerList: () => { try { _renderBookmarkDrawerList(); } catch (_) {} },
	  });
	  const _openExportPrefsPanel = _exportPrefs ? _exportPrefs.openExportPrefsPanel : (() => null);

  try {
    _bookmarkDrawer = wireBookmarkDrawer(dom, state, { onSelectKey, renderTabs, openExportPrefsPanel: _openExportPrefsPanel });
  } catch (_) {
    _bookmarkDrawer = null;
  }

  if (dom.configToggleBtn) dom.configToggleBtn.addEventListener("click", () => {
    try {
      if (dom.drawer && !dom.drawer.classList.contains("hidden")) closeDrawer(dom);
      else openDrawer(dom);
    } catch (_) { openDrawer(dom); }
  });

  if (dom.drawerOverlay) dom.drawerOverlay.addEventListener("click", () => { closeDrawer(dom); });
  if (dom.drawerCloseBtn) dom.drawerCloseBtn.addEventListener("click", () => { closeDrawer(dom); });
  if (dom.translateDrawerOverlay) dom.translateDrawerOverlay.addEventListener("click", () => { closeTranslateDrawer(dom); });
  if (dom.translateDrawerCloseBtn) dom.translateDrawerCloseBtn.addEventListener("click", () => { closeTranslateDrawer(dom); });
  if (dom.exportPrefsDialogCloseBtn) dom.exportPrefsDialogCloseBtn.addEventListener("click", () => { try { if (dom.exportPrefsDialog) dom.exportPrefsDialog.close(); } catch (_) {} });
  if (dom.quickViewDialogCloseBtn) dom.quickViewDialogCloseBtn.addEventListener("click", () => { try { if (dom.quickViewDialog) dom.quickViewDialog.close(); } catch (_) {} });
  window.addEventListener("keydown", (e) => {
    try {
      if (e && e.key === "Escape") {
        if (dom.exportPrefsDialog && dom.exportPrefsDialog.open) { try { e.preventDefault(); } catch (_) {} try { dom.exportPrefsDialog.close(); } catch (_) {} return; }
        if (dom.quickViewDialog && dom.quickViewDialog.open) { try { e.preventDefault(); } catch (_) {} try { dom.quickViewDialog.close(); } catch (_) {} return; }
        if (dom.confirmDialog && dom.confirmDialog.open) return;
        closeBookmarkDrawer(dom);
        closeTranslateDrawer(dom);
        closeDrawer(dom);
      }
    } catch (_) {}
  });

  if (dom.openTranslateFromSettingsBtn) dom.openTranslateFromSettingsBtn.addEventListener("click", () => { openTranslatorSettings(dom); });
  if (dom.saveBtn) dom.saveBtn.addEventListener("click", async () => {
    // 允许用户直接点“保存”而不先 blur 输入框：这里强制校验并落盘 UI 字体/按钮大小。
    try { _applyUiFontInput(false); } catch (_) {}
    try { _applyUiBtnInput(false); } catch (_) {}
    await saveConfig(dom, state);
  });
  if (dom.saveTranslateBtn) dom.saveTranslateBtn.addEventListener("click", async () => { await saveTranslateConfig(dom, state); });
  if (dom.watchToggleBtn) dom.watchToggleBtn.addEventListener("click", async () => {
    const btn = dom.watchToggleBtn;
    try { btn.disabled = true; } catch (_) {}
    try {
      let running = (state && typeof state.running === "boolean") ? state.running : null;
      if (running == null) {
        try {
          const st = await fetch(`/api/status?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json());
          running = !!(st && st.running);
          try { if (state) state.running = running; } catch (_) {}
        } catch (_) {}
      }
      if (running) await stopWatch(dom, state);
      else await startWatch(dom, state);
    } finally {
      try { btn.disabled = false; } catch (_) {}
    }
  });
  if (dom.clearBtn) dom.clearBtn.addEventListener("click", async () => { await clearView(dom, state, refreshList); });
  if (dom.quickViewBtn) {
    const btn = dom.quickViewBtn;
    let pressT = 0;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let pressed = false;
    let longFired = false;
    const LONG_MS = 520;
    const MOVE_PX = 8;

    const clearPress = () => {
      pressed = false;
      if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
      pressT = 0;
    };

    const openQuickViewSettings = () => {
      const dlg = dom && dom.quickViewDialog ? dom.quickViewDialog : null;
      const canPopup = !!(dlg && typeof dlg.show === "function");
      if (!canPopup) return;
      try { if (dlg.open) { dlg.close(); return; } } catch (_) {}

      // Keep UI clean: quick-view settings popover is exclusive with drawers.
      try { closeDrawer(dom); } catch (_) {}
      try { closeTranslateDrawer(dom); } catch (_) {}
      try { closeBookmarkDrawer(dom); } catch (_) {}

      const ok = _openPopupNearEl(dlg, btn, { prefer: "left", align: "start", gap: 10, pad: 12 });
      if (!ok) return;
      try {
        setTimeout(() => {
          try { if (dom.quickBlockList && dom.quickBlockList.querySelector) dom.quickBlockList.querySelector("input[type=checkbox]")?.focus?.(); } catch (_) {}
        }, 0);
      } catch (_) {}
    };

    const onDown = (e) => {
      try {
        if (e && typeof e.button === "number" && e.button !== 0) return;
      } catch (_) {}
      moved = false;
      pressed = true;
      longFired = false;
      startX = Number(e && e.clientX) || 0;
      startY = Number(e && e.clientY) || 0;
      if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
      pressT = window.setTimeout(() => {
        if (!pressed || moved) return;
        longFired = true;
        openQuickViewSettings();
      }, LONG_MS);
    };

    const onMove = (e) => {
      if (!pressed) return;
      const x = Number(e && e.clientX) || 0;
      const y = Number(e && e.clientY) || 0;
      const dx = x - startX;
      const dy = y - startY;
      if ((dx * dx + dy * dy) > (MOVE_PX * MOVE_PX)) {
        moved = true;
        if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
        pressT = 0;
      }
    };

    btn.addEventListener("pointerdown", onDown);
    btn.addEventListener("pointermove", onMove);
    btn.addEventListener("pointerup", clearPress);
    btn.addEventListener("pointercancel", clearPress);
    btn.addEventListener("pointerleave", clearPress);

    btn.addEventListener("click", (e) => {
      if (longFired) {
        longFired = false;
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        return;
      }
      toggleViewMode(dom, state);
      try { setTopStatusSummary(dom, state); } catch (_) {}
    });
  }
  if (dom.translateMode) dom.translateMode.addEventListener("change", async () => {
    const next = _sanitizeTranslateMode(dom.translateMode.value);
    await _setTranslateMode(next, dom.translateMode);
  });
  if (dom.translateToggleBtn) {
    const btn = dom.translateToggleBtn;
    let pressT = 0;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let pressed = false;
    let longFired = false;
    const LONG_MS = 520;
    const MOVE_PX = 8;

    const clearPress = () => {
      pressed = false;
      if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
      pressT = 0;
    };

    const onDown = (e) => {
      try {
        if (e && typeof e.button === "number" && e.button !== 0) return;
      } catch (_) {}
      moved = false;
      pressed = true;
      longFired = false;
      startX = Number(e && e.clientX) || 0;
      startY = Number(e && e.clientY) || 0;
      if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
      pressT = window.setTimeout(() => {
        if (!pressed || moved) return;
        longFired = true;
        openTranslatorSettings(dom);
      }, LONG_MS);
    };

    const onMove = (e) => {
      if (!pressed) return;
      const x = Number(e && e.clientX) || 0;
      const y = Number(e && e.clientY) || 0;
      const dx = x - startX;
      const dy = y - startY;
      if ((dx * dx + dy * dy) > (MOVE_PX * MOVE_PX)) {
        moved = true;
        if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
        pressT = 0;
      }
    };

    btn.addEventListener("pointerdown", onDown);
    btn.addEventListener("pointermove", onMove);
    btn.addEventListener("pointerup", clearPress);
    btn.addEventListener("pointercancel", clearPress);
    btn.addEventListener("pointerleave", clearPress);

    btn.addEventListener("click", async (e) => {
      if (longFired) { longFired = false; try { e.preventDefault(); e.stopPropagation(); } catch (_) {} return; }
      const cur = _sanitizeTranslateMode(state && state.translateMode);
      const next = (cur === "manual") ? "auto" : "manual";
      await _setTranslateMode(next, btn);
    });
  }

  if (dom.powerBtn) {
    const btn = dom.powerBtn;
    let pressT = 0;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let pressed = false;
    let longFired = false;
    const LONG_MS = 520;
    const MOVE_PX = 8;

    const clearPress = () => {
      pressed = false;
      if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
      pressT = 0;
    };

    const onDown = (e) => {
      try {
        if (e && typeof e.button === "number" && e.button !== 0) return;
      } catch (_) {}
      moved = false;
      pressed = true;
      longFired = false;
      startX = Number(e && e.clientX) || 0;
      startY = Number(e && e.clientY) || 0;
      if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
      pressT = window.setTimeout(async () => {
        if (!pressed || moved) return;
        longFired = true;
        try { btn.disabled = true; } catch (_) {}
        try {
          await restartProcess(dom, state, { skipConfirm: true });
        } finally {
          try { btn.disabled = false; } catch (_) {}
        }
      }, LONG_MS);
    };

    const onMove = (e) => {
      if (!pressed) return;
      const x = Number(e && e.clientX) || 0;
      const y = Number(e && e.clientY) || 0;
      const dx = x - startX;
      const dy = y - startY;
      if ((dx * dx + dy * dy) > (MOVE_PX * MOVE_PX)) {
        moved = true;
        if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
        pressT = 0;
      }
    };

    btn.addEventListener("pointerdown", onDown);
    btn.addEventListener("pointermove", onMove);
    btn.addEventListener("pointerup", clearPress);
    btn.addEventListener("pointercancel", clearPress);
    btn.addEventListener("pointerleave", clearPress);

    btn.addEventListener("click", async (e) => {
      if (longFired) { longFired = false; try { e.preventDefault(); e.stopPropagation(); } catch (_) {} return; }
      const ok = await confirmDialog(dom, {
        title: "退出 Sidecar？",
        desc: "将停止监听并关闭服务。",
        confirmText: "退出",
        cancelText: "取消",
        danger: true,
      });
      if (!ok) return;
      setStatus(dom, "正在退出 sidecar…");
      try { if (state.uiEventSource) state.uiEventSource.close(); } catch (_) {}
      try { await api("POST", "/api/control/shutdown", {}); } catch (e) {}
      closeDrawer(dom);
      setTimeout(() => {
        try { window.close(); } catch (_) {}
        showShutdownScreen();
      }, 80);
    });
  }

  const _scrollBehavior = () => {
    try {
      const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
      if (mq && mq.matches) return "auto";
    } catch (_) {}
    return "smooth";
  };

  if (dom.scrollTopBtn) dom.scrollTopBtn.addEventListener("click", () => { window.scrollTo({ top: 0, behavior: _scrollBehavior() }); });
  if (dom.scrollBottomBtn) dom.scrollBottomBtn.addEventListener("click", async () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: _scrollBehavior() });
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

  if (dom.httpProfileDelBtn) dom.httpProfileDelBtn.addEventListener("click", async () => {
    if (!state.httpSelected) return;
    const ok = await confirmDialog(dom, {
      title: "删除翻译 Profile？",
      desc: `将删除：${state.httpSelected}`,
      confirmText: "删除",
      cancelText: "取消",
      danger: true,
    });
    if (!ok) return;
    state.httpProfiles = state.httpProfiles.filter(p => !(p && p.name === state.httpSelected));
    state.httpSelected = state.httpProfiles.length > 0 ? (state.httpProfiles[0].name || "") : "";
    refreshHttpProfileSelect(dom, state);
    if (state.httpSelected) applyProfileToInputs(dom, state, state.httpSelected);
    else {
      if (dom.httpUrl) dom.httpUrl.value = "";
      if (dom.httpTimeout) dom.httpTimeout.value = 3;
    }
  });
}
