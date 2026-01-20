import { api } from "./api.js";
import { clearView, restartProcess, startWatch, stopWatch } from "./actions.js";
import { saveConfig, saveTranslateConfig } from "./config.js";
import { applyProfileToInputs, readHttpInputs, refreshHttpProfileSelect, upsertSelectedProfileFromInputs } from "./http_profiles.js";
import { closeBookmarkDrawer, closeDrawer, closeTranslateDrawer, confirmDialog, openBookmarkDrawer, openDrawer, openTranslatorSettings, setStatus, setTopStatusSummary, showProviderBlocks } from "./ui.js";
import { showShutdownScreen } from "../shutdown.js";
import { setViewMode, toggleViewMode } from "../view_mode.js";
import { flashToastAt } from "../utils/toast.js";
import { copyToClipboard } from "../utils/clipboard.js";
import { buildThinkingMetaRight } from "../thinking/meta.js";
import { maybePlayNotifySound, preloadNotifySound } from "../sound.js";
import { colorForKey, rolloutStampFromFile, shortId } from "../utils.js";
import { exportThreadMarkdown } from "../export.js";
import { getExportPrefsForKey, setExportPrefsForKey } from "../export_prefs.js";
import { getCustomLabel, setCustomLabel } from "../sidebar/labels.js";
import { saveClosedThreads } from "../closed_threads.js";
import { saveHiddenThreads } from "../sidebar/hidden.js";
import { getUnreadCount } from "../unread.js";

export function wireControlEvents(dom, state, helpers) {
  const h = (helpers && typeof helpers === "object") ? helpers : {};
  const refreshList = typeof h.refreshList === "function" ? h.refreshList : (async () => {});
  const onSelectKey = typeof h.onSelectKey === "function" ? h.onSelectKey : (async () => {});
  const renderTabs = typeof h.renderTabs === "function" ? h.renderTabs : (() => {});
  const MASK = "********";
  const _LS_UI_FONT = "codex_sidecar_ui_font_size";
  const _LS_UI_BTN = "codex_sidecar_ui_btn_size";
  const _LS_TABS_COLLAPSED = "codex_sidecar_tabs_collapsed_v1";

  const _applyUiFontSize = (px) => {
    const n = Number(px);
    const v = Number.isFinite(n) && n >= 12 && n <= 24 ? n : 14;
    try { document.documentElement.style.setProperty("--ui-font-size", `${v}px`); } catch (_) {}
    return v;
  };

  const _applyUiButtonSize = (px) => {
    const n = Number(px);
    const v = Number.isFinite(n) && n >= 32 && n <= 72 ? n : 38;
    try { document.documentElement.style.setProperty("--rightbar-w", `${v}px`); } catch (_) {}
    try {
      const ico = v >= 56 ? 24 : v >= 48 ? 22 : v >= 42 ? 20 : 18;
      document.documentElement.style.setProperty("--ui-ico-size", `${ico}px`);
    } catch (_) {}
    return v;
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

  const _toastFromEl = (el, text, opts = {}) => {
    const isLight = ("isLight" in opts) ? !!opts.isLight : true;
    const durationMs = Number.isFinite(Number(opts.durationMs)) ? Number(opts.durationMs) : 1100;
    try {
      const node = el && el.getBoundingClientRect ? el : null;
      const r = node ? node.getBoundingClientRect() : null;
      const x = r ? (r.left + r.width / 2) : (window.innerWidth / 2);
      const y = r ? (r.top + r.height / 2) : 24;
      flashToastAt(x, y, text, { isLight, durationMs });
    } catch (_) {}
  };

  let _uiHoverTipEl = null;
  const _ensureUiHoverTipEl = () => {
    try {
      if (_uiHoverTipEl && document.body && document.body.contains(_uiHoverTipEl)) return _uiHoverTipEl;
    } catch (_) {}
    try {
      const el = document.createElement("div");
      el.className = "ui-hover-tip";
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
      _uiHoverTipEl = el;
      return el;
    } catch (_) {
      _uiHoverTipEl = null;
      return null;
    }
  };

  const _hideUiHoverTip = () => {
    const el = _ensureUiHoverTipEl();
    if (!el) return;
    try { el.classList.remove("show"); } catch (_) {}
  };

  const _placeUiHoverTip = (el, anchorEl, opts = {}) => {
    const anchor = anchorEl && typeof anchorEl.getBoundingClientRect === "function" ? anchorEl : null;
    if (!el || !anchor) return;
    const pad = Number.isFinite(Number(opts.pad)) ? Number(opts.pad) : 10;
    const gap = Number.isFinite(Number(opts.gap)) ? Number(opts.gap) : 6;
    const insetX = Number.isFinite(Number(opts.insetX)) ? Number(opts.insetX) : 12;
    const prefer = String(opts.prefer || "below").trim().toLowerCase(); // below|above

    const r = anchor.getBoundingClientRect();
    const tr = el.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;

    let left = r.left + insetX;
    left = _clamp(left, pad, Math.max(pad, vw - pad - tr.width));

    const below = r.bottom + gap;
    const above = r.top - gap - tr.height;
    let top = below;
    if (prefer === "above" || (below + tr.height) > (vh - pad)) top = above;
    top = _clamp(top, pad, Math.max(pad, vh - pad - tr.height));

    try { el.style.left = `${left}px`; } catch (_) {}
    try { el.style.top = `${top}px`; } catch (_) {}
  };

  const _showUiHoverTip = (anchorEl, text, opts = {}) => {
    const msg = String(text || "").trim();
    if (!msg) return;
    const el = _ensureUiHoverTipEl();
    if (!el) return;
    try { el.textContent = msg; } catch (_) {}
    try { el.style.left = "0px"; el.style.top = "0px"; el.style.visibility = "hidden"; } catch (_) {}
    try { el.classList.add("show"); } catch (_) {}
    try { _placeUiHoverTip(el, anchorEl, opts); } catch (_) {}
    try { el.style.visibility = ""; } catch (_) {}
    try { el.classList.add("show"); } catch (_) {}
  };

  const _clamp = (n, a, b) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return a;
    return Math.min(b, Math.max(a, x));
  };

  const _openPopupNearEl = (dlg, anchorEl, opts = {}) => {
    const dialog = dlg && typeof dlg.show === "function" ? dlg : null;
    const anchor = anchorEl && typeof anchorEl.getBoundingClientRect === "function" ? anchorEl : null;
    if (!dialog || !anchor) return false;

    const pad = Number.isFinite(Number(opts.pad)) ? Number(opts.pad) : 12;
    const gap = Number.isFinite(Number(opts.gap)) ? Number(opts.gap) : 10;
    const prefer = String(opts.prefer || "left").trim().toLowerCase(); // left|right
    const align = String(opts.align || "start").trim().toLowerCase(); // start|center|end

    // Avoid flicker: show hidden first, then position.
    let prevVis = "";
    try { prevVis = String(dialog.style.visibility || ""); } catch (_) {}
    try { dialog.style.visibility = "hidden"; } catch (_) {}
    try { dialog.style.left = "0px"; dialog.style.top = "0px"; } catch (_) {}
    try { if (dialog.open) dialog.close(); } catch (_) {}
    try { dialog.show(); } catch (_) { return false; }

    let cleanup = null;
    try {
      const ar = anchor.getBoundingClientRect();
      const dr = dialog.getBoundingClientRect();
      const vw = window.innerWidth || 0;
      const vh = window.innerHeight || 0;

      let left = 0;
      if (prefer === "right") left = ar.right + gap;
      else left = ar.left - dr.width - gap;

      let top = 0;
      if (align === "end") top = ar.bottom - dr.height;
      else if (align === "center") top = ar.top + (ar.height - dr.height) / 2;
      else top = ar.top;

      // If our first choice is off-screen, try the other side.
      if (left < pad && prefer !== "right") left = ar.right + gap;
      if ((left + dr.width + pad) > vw && prefer === "right") left = ar.left - dr.width - gap;

      left = _clamp(left, pad, Math.max(pad, vw - dr.width - pad));
      top = _clamp(top, pad, Math.max(pad, vh - dr.height - pad));

      try { dialog.style.left = `${left}px`; } catch (_) {}
      try { dialog.style.top = `${top}px`; } catch (_) {}
    } catch (_) {}

    try { dialog.style.visibility = prevVis || "visible"; } catch (_) {}

    // Close when clicking outside (popover-like).
    try {
      const onDown = (e) => {
        try {
          if (!dialog.open) return;
          const t = e && e.target ? e.target : null;
          if (!t) return;
          if (dialog.contains && dialog.contains(t)) return;
          if (anchor.contains && anchor.contains(t)) return;
          try { dialog.close(); } catch (_) {}
        } catch (_) {}
      };
      const onClose = () => {
        try { document.removeEventListener("pointerdown", onDown, true); } catch (_) {}
      };
      cleanup = onClose;
      try { document.addEventListener("pointerdown", onDown, true); } catch (_) {}
      try { dialog.addEventListener("close", onClose, { once: true }); } catch (_) {}
    } catch (_) {}

    // Safety: if dialog is removed or throws, ensure listeners don't linger.
    void cleanup;
    return true;
  };

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

  const _setEyeBtnState = (btn, shown, label) => {
    if (!btn) return;
    const isShown = !!shown;
    try { btn.classList.toggle("active", isShown); } catch (_) {}
    try {
      const use = btn.querySelector ? btn.querySelector("use") : null;
      // 语义：开眼=当前可见；斜杠眼=当前隐藏
      if (use && use.setAttribute) use.setAttribute("href", isShown ? "#i-eye" : "#i-eye-off");
    } catch (_) {}
    try { btn.setAttribute("aria-label", `${isShown ? "隐藏" : "显示"} ${label}`); } catch (_) {}
  };

  const _toggleSecretField = async ({ btn, input, provider, field, label, getProfile }) => {
    if (!btn || !input) return;
    const curType = String(input.type || "text").toLowerCase();
    const shown = curType !== "password";
    if (shown) {
      try { input.type = "password"; } catch (_) {}
      _setEyeBtnState(btn, false, label);
      return;
    }

    const curVal = String(input.value || "").trim();
    if (curVal === MASK) {
      let prof = "";
      try { prof = typeof getProfile === "function" ? String(getProfile() || "") : ""; } catch (_) { prof = ""; }
      try {
        const r = await api("POST", "/api/control/reveal_secret", { provider, field, profile: prof });
        const v = (r && r.ok) ? String(r.value || "") : "";
        if (!v) {
          _toastFromEl(btn, "获取原文失败", { isLight: true, durationMs: 1800 });
          return;
        }
        input.value = v;
      } catch (_) {
        _toastFromEl(btn, "获取原文失败", { isLight: true, durationMs: 1800 });
        return;
      }
    }

    try { input.type = "text"; } catch (_) {}
    _setEyeBtnState(btn, true, label);
    try { input.focus(); } catch (_) {}
  };

  if (dom.translatorSel) dom.translatorSel.addEventListener("change", () => {
    showProviderBlocks(dom, (dom.translatorSel.value || ""));
  });

  // Secret toggles (show/hide with on-demand reveal).
  try {
    _setEyeBtnState(dom && dom.openaiBaseUrlEyeBtn, false, "Base URL");
    _setEyeBtnState(dom && dom.openaiApiKeyEyeBtn, false, "API Key");
    _setEyeBtnState(dom && dom.nvidiaApiKeyEyeBtn, false, "API Key");
    _setEyeBtnState(dom && dom.httpTokenEyeBtn, false, "Token");
  } catch (_) {}
  if (dom.openaiBaseUrlEyeBtn) dom.openaiBaseUrlEyeBtn.addEventListener("click", async () => {
    await _toggleSecretField({ btn: dom.openaiBaseUrlEyeBtn, input: dom.openaiBaseUrl, provider: "openai", field: "base_url", label: "Base URL" });
  });
  if (dom.openaiApiKeyEyeBtn) dom.openaiApiKeyEyeBtn.addEventListener("click", async () => {
    await _toggleSecretField({ btn: dom.openaiApiKeyEyeBtn, input: dom.openaiApiKey, provider: "openai", field: "api_key", label: "API Key" });
  });
  if (dom.nvidiaApiKeyEyeBtn) dom.nvidiaApiKeyEyeBtn.addEventListener("click", async () => {
    await _toggleSecretField({ btn: dom.nvidiaApiKeyEyeBtn, input: dom.nvidiaApiKey, provider: "nvidia", field: "api_key", label: "API Key" });
  });
  if (dom.httpTokenEyeBtn) dom.httpTokenEyeBtn.addEventListener("click", async () => {
    await _toggleSecretField({
      btn: dom.httpTokenEyeBtn,
      input: dom.httpToken,
      provider: "http",
      field: "token",
      label: "Token",
      getProfile: () => (dom.httpProfile && dom.httpProfile.value) ? dom.httpProfile.value : (state && state.httpSelected ? state.httpSelected : ""),
    });
  });

  const _wireSfxSelect = (sel, { field, kind }) => {
    if (!sel) return;
    sel.addEventListener("change", async () => {
      const v = String(sel.value || "none").trim() || "none";
      try {
        if (kind === "tool_gate") state.notifySoundToolGate = v;
        else state.notifySoundAssistant = v;
      } catch (_) {}
      try { preloadNotifySound(state); } catch (_) {}
      try { await api("POST", "/api/config", { [field]: v }); } catch (_) {}
      try { if (v !== "none") maybePlayNotifySound(dom, state, { kind, force: true }); } catch (_) {}
    });
  };

  _wireSfxSelect(dom.notifySoundAssistant, { field: "notify_sound_assistant", kind: "assistant" });
  _wireSfxSelect(dom.notifySoundToolGate, { field: "notify_sound_tool_gate", kind: "tool_gate" });

  const _readSavedInt = (lsKey, fallback) => {
    try {
      const v = Number(localStorage.getItem(lsKey) || "");
      return Number.isFinite(v) ? v : fallback;
    } catch (_) {
      return fallback;
    }
  };

  const _readSavedBool = (lsKey, fallback) => {
    try {
      const v = localStorage.getItem(lsKey);
      if (v == null || v === "") return fallback;
      const s = String(v).trim().toLowerCase();
      if (s === "0" || s === "false" || s === "no" || s === "off") return false;
      if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
      return fallback;
    } catch (_) {
      return fallback;
    }
  };

  const _applyTabsCollapsedLocal = (collapsed) => {
    const on = !!collapsed;
    try {
      if (on) document.body.dataset.tabsCollapsed = "1";
      else delete document.body.dataset.tabsCollapsed;
    } catch (_) {}
    return on;
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
    const prev = _readSavedInt(_LS_UI_FONT, 14);
    const n = _parseIntStrict(el.value);
    if (n == null || n < 12 || n > 24) {
      _setInvalid(el, true);
      try { el.value = String(prev); } catch (_) {}
      return;
    }
    _setInvalid(el, false);
    const v = _applyUiFontSize(n);
    try { localStorage.setItem(_LS_UI_FONT, String(v)); } catch (_) {}
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
    _applyUiFontSize(n);
  };

  const _applyUiBtnInput = (silent = false) => {
    const el = dom && dom.uiBtnSize ? dom.uiBtnSize : null;
    if (!el) return;
    const prev = _readSavedInt(_LS_UI_BTN, 38);
    const n = _parseIntStrict(el.value);
    if (n == null || n < 32 || n > 72) {
      _setInvalid(el, true);
      try { el.value = String(prev); } catch (_) {}
      return;
    }
    _setInvalid(el, false);
    const v = _applyUiButtonSize(n);
    try { localStorage.setItem(_LS_UI_BTN, String(v)); } catch (_) {}
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
    _applyUiButtonSize(n);
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

  const _syncBookmarkTabsToggle = () => {
    const btn = dom && dom.bookmarkTabsToggleBtn ? dom.bookmarkTabsToggleBtn : null;
    if (!btn) return;
    const collapsed = _readSavedBool(_LS_TABS_COLLAPSED, false);
    const expanded = !collapsed;
    try { btn.setAttribute("aria-checked", expanded ? "true" : "false"); } catch (_) {}
  };

	  // 标签页栏收起状态（由会话管理内开关切换）
	  _applyTabsCollapsedLocal(_readSavedBool(_LS_TABS_COLLAPSED, false));
	  _syncBookmarkTabsToggle();

	  // 导出偏好：会话级（每个会话可单独设置 精简/全量、译文/原文）。
	  let _exportPrefsKey = "";
	  const _sanitizeExportPrefsKey = (v) => {
	    const s = String(v || "").trim();
	    return (!s || s === "all") ? "" : s;
	  };
	  const _exportPrefsText = (p) => `${p && p.quick ? "精简" : "全量"} · ${p && p.translate ? "译文" : "原文"}`;

	  const _syncExportPrefsPanel = (key, silent = true) => {
	    const k = _sanitizeExportPrefsKey(key) || _sanitizeExportPrefsKey(_exportPrefsKey) || _sanitizeExportPrefsKey(state.currentKey);
	    const dlg = dom && dom.exportPrefsDialog ? dom.exportPrefsDialog : null;
	    if (!dlg) return null;
	    if (!k) return null;
	    _exportPrefsKey = k;
	    const p = getExportPrefsForKey(k);
	    try {
	      if (dom.exportPrefsQuickBtn) {
	        dom.exportPrefsQuickBtn.setAttribute("aria-pressed", p.quick ? "true" : "false");
	        dom.exportPrefsQuickBtn.classList.toggle("is-on-a", !!p.quick);
	        dom.exportPrefsQuickBtn.classList.toggle("is-on-b", !p.quick);
	      }
	    } catch (_) {}
	    try {
	      if (dom.exportPrefsTranslateBtn) {
	        dom.exportPrefsTranslateBtn.setAttribute("aria-pressed", p.translate ? "true" : "false");
	        dom.exportPrefsTranslateBtn.classList.toggle("is-on-a", !!p.translate);
	        dom.exportPrefsTranslateBtn.classList.toggle("is-on-b", !p.translate);
	      }
	    } catch (_) {}
	    if (!silent) {
	      try { _toastFromEl(dlg, `导出：${_exportPrefsText(p)}`, { durationMs: 1400 }); } catch (_) {}
	    }
	    return p;
	  };

		  const _openExportPrefsPanel = (key, anchorEl = null) => {
		    const p = _syncExportPrefsPanel(key, true);
		    const dlg = dom && dom.exportPrefsDialog ? dom.exportPrefsDialog : null;
		    const ok = _openPopupNearEl(dlg, anchorEl, { prefer: "left", align: "end", gap: 10, pad: 12 });
		    if (ok) {
		      // 让“导出设置”弹层的左边框与“会话管理”抽屉左边框对齐，避免视觉别扭。
		      try {
		        const drawer = dom && dom.bookmarkDrawer ? dom.bookmarkDrawer : null;
		        if (drawer && drawer.getBoundingClientRect && drawer.classList && !drawer.classList.contains("hidden")) {
		          const dr = drawer.getBoundingClientRect();
		          const pr = dlg.getBoundingClientRect();
		          const vw = window.innerWidth || 0;
		          const pad = 12;
		          const left = _clamp(dr.left, pad, Math.max(pad, vw - pr.width - pad));
		          try { dlg.style.left = `${left}px`; } catch (_) {}
		        }
		      } catch (_) {}
		      try {
		        setTimeout(() => {
		          try { if (dom.exportPrefsQuickBtn && typeof dom.exportPrefsQuickBtn.focus === "function") dom.exportPrefsQuickBtn.focus(); } catch (_) {}
		        }, 0);
		      } catch (_) {}
		    }
		    return p;
		  };

	  const _wireExportPrefsPanel = () => {
	    const quickBtn = dom && dom.exportPrefsQuickBtn ? dom.exportPrefsQuickBtn : null;
	    const trBtn = dom && dom.exportPrefsTranslateBtn ? dom.exportPrefsTranslateBtn : null;
	    if (!quickBtn && !trBtn) return;
		    const apply = (next) => {
		      const k = _sanitizeExportPrefsKey(_exportPrefsKey) || _sanitizeExportPrefsKey(state.currentKey);
		      if (!k) return;
		      setExportPrefsForKey(k, next);
		      _syncExportPrefsPanel(k, true);
		      try { _renderBookmarkDrawerList(); } catch (_) {}
		    };
		    try {
		      if (quickBtn) quickBtn.addEventListener("click", () => {
		        const k = _sanitizeExportPrefsKey(_exportPrefsKey) || _sanitizeExportPrefsKey(state.currentKey);
		        const cur = getExportPrefsForKey(k);
		        apply({ quick: !cur.quick, translate: !!cur.translate });
		      });
		    } catch (_) {}
		    try {
		      if (trBtn) trBtn.addEventListener("click", () => {
		        const k = _sanitizeExportPrefsKey(_exportPrefsKey) || _sanitizeExportPrefsKey(state.currentKey);
		        const cur = getExportPrefsForKey(k);
		        apply({ quick: !!cur.quick, translate: !cur.translate });
		      });
		    } catch (_) {}

	    try { _syncExportPrefsPanel(state.currentKey, true); } catch (_) {}
	  };

	  _wireExportPrefsPanel();

  if (dom.configToggleBtn) dom.configToggleBtn.addEventListener("click", () => {
    try {
      if (dom.drawer && !dom.drawer.classList.contains("hidden")) closeDrawer(dom);
      else openDrawer(dom);
    } catch (_) { openDrawer(dom); }
  });

  const _isBookmarkDrawerOpen = () => {
    try {
      return !!(dom.bookmarkDrawer && dom.bookmarkDrawer.classList && !dom.bookmarkDrawer.classList.contains("hidden"));
    } catch (_) {
      return false;
    }
  };

  const _threadDefaultLabel = (t) => {
    try {
      const stamp = rolloutStampFromFile((t && t.file) ? t.file : "");
      const idPart = (t && t.thread_id)
        ? shortId(String(t.thread_id || ""))
        : shortId(String(((t && t.file) ? t.file : "").split("/").slice(-1)[0] || (t && t.key) || ""));
      if (stamp && idPart) return `${stamp} · ${idPart}`;
      return idPart || stamp || "unknown";
    } catch (_) {
      return "unknown";
    }
  };

	  const _threadLabel = (t) => {
	    const k = String((t && t.key) ? t.key : "");
	    const custom = getCustomLabel(k);
	    return custom || _threadDefaultLabel(t);
	  };

	  let _bookmarkDrawerEditingKey = "";
	  const _isBookmarkDrawerEditing = () => !!_bookmarkDrawerEditingKey;
	  const _ensureHiddenSet = () => {
	    if (!state.hiddenThreads || typeof state.hiddenThreads.add !== "function") state.hiddenThreads = new Set();
	    return state.hiddenThreads;
	  };
  const _sortThreads = (arr) => {
    arr.sort((a, b) => {
      const sa = Number(a && a.last_seq) || 0;
      const sb = Number(b && b.last_seq) || 0;
      if (sa !== sb) return sb - sa;
      return String(b && b.last_ts ? b.last_ts : "").localeCompare(String(a && a.last_ts ? a.last_ts : ""));
    });
  };

  const _pickFallbackKey = (excludeKey = "") => {
    const ex = String(excludeKey || "");
    const hidden = _ensureHiddenSet();
    const closed = (state && state.closedThreads && typeof state.closedThreads.has === "function")
      ? state.closedThreads
      : null;
    const arr = Array.from(state.threadIndex.values());
    _sortThreads(arr);
    for (const t of arr) {
      const k = String((t && t.key) ? t.key : "");
      if (!k) continue;
      if (k === ex) continue;
      if (hidden && typeof hidden.has === "function" && hidden.has(k)) continue;
      if (closed && typeof closed.has === "function" && closed.has(k)) continue;
      return k;
    }
    return "all";
  };

  const _renderBookmarkDrawerList = () => {
    const host = dom.bookmarkList;
    const hiddenHost = dom.bookmarkHiddenList;
    if (!host || !hiddenHost) return;
    // 仅在抽屉打开时渲染，避免 SSE 高频刷新带来额外负担。
    if (!_isBookmarkDrawerOpen()) return;
    // 正在重命名时不重绘，避免输入焦点丢失。
    if (_isBookmarkDrawerEditing()) return;

	    const items = [];
	    const hiddenItems = [];

	    try {
      const followFiles = (state && Array.isArray(state.statusFollowFiles)) ? state.statusFollowFiles : [];
	      const arr = Array.from(state.threadIndex.values());
	      _sortThreads(arr);
	      const hidden = _ensureHiddenSet();
	      const closed = (state && state.closedThreads && typeof state.closedThreads.has === "function") ? state.closedThreads : new Map();

	      for (const t of arr) {
	        const key = String((t && t.key) ? t.key : "");
	        if (!key) continue;
	        if (closed && typeof closed.has === "function" && closed.has(key)) continue;
	        const label = _threadLabel(t);
	        const file = String((t && t.file) ? t.file : "");
        const fileBase = file ? (String(file).split("/").slice(-1)[0] || file) : "";
        const followed = !!(file && followFiles && followFiles.includes(file));
	        const tid = String((t && t.thread_id) ? t.thread_id : "");
	        const isHidden = !!(hidden && typeof hidden.has === "function" && hidden.has(key));
	        const unread = getUnreadCount(state, key);
	        const clr = colorForKey(key);
	        const entry = {
	          key,
	          label,
	          unread,
          file,
          fileBase,
          followed,
	          hidden: isHidden,
	          closed: false,
	          active: String(state.currentKey || "all") === key,
	          color: clr,
	        };
	        if (isHidden) hiddenItems.push(entry);
	        else items.push(entry);
      }
    } catch (_) {}

	    const _renderList = (target, rows, opts = {}) => {
	      const isHiddenList = !!opts.hiddenList;
	      try { target.replaceChildren(); } catch (_) { while (target.firstChild) target.removeChild(target.firstChild); }
	      const frag = document.createDocumentFragment();

	      if (!rows.length) {
	        const empty = document.createElement("div");
	        empty.className = "meta";
	        empty.style.opacity = "0.7";
	        empty.style.padding = "6px 2px";
	        empty.textContent = isHiddenList ? "暂无已关闭监听会话" : "暂无会话";
	        frag.appendChild(empty);
	        target.appendChild(frag);
	        return;
	      }

			      for (const it of rows) {
			        const row = document.createElement("div");
			        row.className = "tab"
			          + (it.active ? " active" : "")
			          + (it.closed ? " tab-closed" : "")
			          + (isHiddenList ? " tab-hidden" : "");
			        row.dataset.key = String(it.key || "");
			        row.dataset.label = String(it.label || "");
			        if (isHiddenList) row.dataset.hidden = "1";
			        row.setAttribute("role", "button");
			        row.tabIndex = 0;
	          try { row.removeAttribute("title"); } catch (_) {}
	          try { row.dataset.file = String(it.file || ""); } catch (_) {}

		        const dot = document.createElement("span");
		        dot.className = "tab-dot";
		        try { dot.style.background = String((it.color && it.color.fg) ? it.color.fg : "#64748b"); } catch (_) {}

	        const label = document.createElement("span");
	        label.className = "tab-label";
	        label.textContent = String(it.label || "");

	          const sub = document.createElement("span");
	          sub.className = "tab-sub";
	          try {
	            sub.textContent = "";
	          } catch (_) { sub.textContent = ""; }

	        const input = document.createElement("input");
	        input.className = "tab-edit";
	        input.type = "text";
	        input.autocomplete = "off";
	        input.spellcheck = false;
	        input.value = String(it.label || "");

	        const actions = document.createElement("div");
	        actions.className = "tab-actions";

	        const canHoverTip = (e) => {
	          try {
	            const pt = e && e.pointerType ? String(e.pointerType) : "";
	            if (pt && pt !== "mouse") return false;
	          } catch (_) {}
	          try {
	            if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) return false;
	          } catch (_) {}
	          return true;
	        };

	        const wireMiniBtnHoverTip = (btn) => {
	          if (!btn || btn.__miniTipWired) return;
	          btn.__miniTipWired = true;
	          const show = (e) => {
	            if (!canHoverTip(e)) return;
	            const txt = String(btn.getAttribute && btn.getAttribute("aria-label") ? btn.getAttribute("aria-label") : "").trim();
	            if (!txt) return;
	            _showUiHoverTip(btn, txt, { insetX: 6, gap: 6, pad: 10, prefer: "above" });
	          };
	          const hide = (e) => {
	            if (!canHoverTip(e)) return;
	            _hideUiHoverTip();
	          };
	          try { btn.addEventListener("pointerenter", show); } catch (_) {}
	          try { btn.addEventListener("pointerleave", hide); } catch (_) {}
	          try { btn.addEventListener("pointerdown", () => { _hideUiHoverTip(); }); } catch (_) {}
	          try { btn.addEventListener("focus", (e) => show(e)); } catch (_) {}
	          try { btn.addEventListener("blur", (e) => hide(e)); } catch (_) {}
	        };

	        const renameBtn = document.createElement("button");
	        renameBtn.className = "mini-btn";
	        renameBtn.type = "button";
	        renameBtn.dataset.action = "rename";
	        renameBtn.setAttribute("aria-label", "重命名");
	        try { renameBtn.removeAttribute("title"); } catch (_) {}
	        renameBtn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-edit"></use></svg>`;
	        wireMiniBtnHoverTip(renameBtn);

		        const exportBtn = document.createElement("button");
		        exportBtn.className = "mini-btn";
		        exportBtn.type = "button";
		        exportBtn.dataset.action = "export";
		        try {
		          const p = getExportPrefsForKey(String(it.key || ""));
		          exportBtn.classList.toggle("flag-quick", !!p.quick);
		          exportBtn.classList.toggle("flag-tr", !!p.translate);
		        } catch (_) {
		          try { exportBtn.classList.remove("flag-quick"); } catch (_) {}
		          try { exportBtn.classList.remove("flag-tr"); } catch (_) {}
		        }
		        exportBtn.setAttribute("aria-label", "导出（长按设置）");
		        try { exportBtn.removeAttribute("title"); } catch (_) {}
		        exportBtn.innerHTML = `
		          <svg class="ico" aria-hidden="true"><use href="#i-download"></use></svg>
		          <span class="mini-flag flag-tr" aria-hidden="true"><svg class="ico ico-mini" aria-hidden="true"><use href="#i-globe"></use></svg></span>
		          <span class="mini-flag flag-quick" aria-hidden="true"><svg class="ico ico-mini" aria-hidden="true"><use href="#i-bolt"></use></svg></span>
		        `;
		        wireMiniBtnHoverTip(exportBtn);
	        try {
	          let pressT = 0;
	          let startX = 0;
          let startY = 0;
          let moved = false;
          let pressed = false;
          let longFired = false;
          const LONG_MS = 520;
          const MOVE_PX = 8;

          const clear = () => {
            pressed = false;
            if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
            pressT = 0;
          };

	          exportBtn.addEventListener("pointerdown", (e) => {
	            try { if (e && typeof e.button === "number" && e.button !== 0) return; } catch (_) {}
	            moved = false;
	            pressed = true;
	            longFired = false;
	            startX = Number(e && e.clientX) || 0;
	            startY = Number(e && e.clientY) || 0;
	            if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
		            pressT = window.setTimeout(() => {
		              if (!pressed || moved) return;
		              longFired = true;
		              try {
		                const dlg = dom && dom.exportPrefsDialog ? dom.exportPrefsDialog : null;
		                if (dlg && dlg.open) { try { dlg.close(); } catch (_) {} return; }
		              } catch (_) {}
		              try { _openExportPrefsPanel(String(it.key || ""), exportBtn); } catch (_) {}
			            }, LONG_MS);
			          });
          exportBtn.addEventListener("pointermove", (e) => {
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
          });
          exportBtn.addEventListener("pointerup", clear);
          exportBtn.addEventListener("pointercancel", clear);
          exportBtn.addEventListener("pointerleave", clear);
          exportBtn.addEventListener("click", (e) => {
            if (!longFired) return;
            longFired = false;
            try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
          });
        } catch (_) {}

	        const toggleBtn = document.createElement("button");
	        toggleBtn.className = "mini-btn";
	        toggleBtn.type = "button";
	        toggleBtn.dataset.action = isHiddenList ? "listenOn" : "listenOff";
	        toggleBtn.setAttribute("aria-label", isHiddenList ? "开启监听" : "关闭监听");
	        try { toggleBtn.removeAttribute("title"); } catch (_) {}
	        toggleBtn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="${isHiddenList ? "#i-eye" : "#i-eye-closed"}"></use></svg>`;
	        wireMiniBtnHoverTip(toggleBtn);
	
	        const delBtn = document.createElement("button");
	        delBtn.className = "mini-btn danger";
	        delBtn.type = "button";
	        delBtn.dataset.action = "delete";
	        delBtn.setAttribute("aria-label", "清除对话");
	        try { delBtn.removeAttribute("title"); } catch (_) {}
	        delBtn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-trash"></use></svg>`;
	        wireMiniBtnHoverTip(delBtn);

		        actions.appendChild(renameBtn);
		        actions.appendChild(exportBtn);
		        actions.appendChild(toggleBtn);
		        actions.appendChild(delBtn);

	          const main = document.createElement("div");
	          main.className = "tab-main";
	          main.appendChild(label);
	          if (sub && String(sub.textContent || "").trim()) main.appendChild(sub);
	          main.appendChild(input);

	        row.appendChild(dot);
	        row.appendChild(main);
		        row.appendChild(actions);
		        frag.appendChild(row);
	          // Hover hint (only when hovering the left area; hovering the action buttons should not trigger).
		          try {
		            const filePath = String(it.file || "").trim();
		            if (filePath) {
		              let tracking = false;
		              const hintText = "长按可复制源 JSON 路径";
		              const update = (e) => {
		                if (!tracking) return;
		                if (row.classList && row.classList.contains("editing")) return;
		                _showUiHoverTip(main, hintText, { insetX: 8, gap: 6, pad: 10, prefer: "below" });
		              };
		              main.addEventListener("pointerenter", (e) => { if (!canHoverTip(e)) return; tracking = true; update(e); });
		              main.addEventListener("pointermove", update);
		              main.addEventListener("pointerleave", (e) => { if (!canHoverTip(e)) return; tracking = false; _hideUiHoverTip(); });
		            }
		          } catch (_) {}
	          // Long-press: copy JSON source path (explicit action; no hover hints).
	          try {
	            const filePath = String(it.file || "").trim();
	            if (filePath) {
	              let pressT = 0;
	              let pressed = false;
	              let moved = false;
	              let longFired = false;
	              let startX = 0;
	              let startY = 0;
	              const LONG_MS = 520;
	              const MOVE_PX = 8;

	              const clear = () => {
	                pressed = false;
	                moved = false;
	                if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
	                pressT = 0;
	              };

	              row.addEventListener("pointerdown", (e) => {
	                try {
	                  if (e && typeof e.button === "number" && e.button !== 0) return;
	                } catch (_) {}
	                try {
	                  const t = e && e.target;
	                  if (t && t.closest && t.closest("button")) return;
	                } catch (_) {}
	                pressed = true;
	                moved = false;
	                longFired = false;
	                startX = Number(e && e.clientX) || 0;
	                startY = Number(e && e.clientY) || 0;
	                if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
	                pressT = window.setTimeout(() => {
	                  if (!pressed || moved) return;
	                  longFired = true;
	                  try { row.dataset.lp = String(Date.now()); } catch (_) {}
	                  copyToClipboard(filePath)
	                    .then((ok) => { _toastFromEl(row, ok ? "已复制对话 JSON 路径" : "复制失败", { durationMs: 1200 }); })
	                    .catch(() => {});
	                }, LONG_MS);
	              });
	              row.addEventListener("pointermove", (e) => {
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
	              });
	              row.addEventListener("pointerup", clear);
	              row.addEventListener("pointercancel", clear);
	              row.addEventListener("pointerleave", clear);
	              row.addEventListener("click", (e) => {
	                if (!longFired) return;
	                longFired = false;
	                try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
	              });
	            }
	          } catch (_) {}

			      }

	      target.appendChild(frag);
	    };

    _renderList(host, items, { hiddenList: false });
    _renderList(hiddenHost, hiddenItems, { hiddenList: true });

	    try {
	      if (dom.bookmarkHiddenCount) dom.bookmarkHiddenCount.textContent = String(hiddenItems.length);
	      if (dom.bookmarkHiddenDetails) {
	        dom.bookmarkHiddenDetails.style.display = hiddenItems.length ? "" : "none";
	      }
	    } catch (_) {}
	  };

  const _openBookmarkDrawer = () => {
    openBookmarkDrawer(dom);
    _syncBookmarkTabsToggle();
    _renderBookmarkDrawerList();
  };

	  if (dom.bookmarkDrawerToggleBtn) {
	    const btn = dom.bookmarkDrawerToggleBtn;
	    let pressT = 0;
	    let pressed = false;
	    let moved = false;
	    let longFired = false;
	    let startX = 0;
	    let startY = 0;
	    const LONG_MS = 520;
	    const MOVE_PX = 8;

	    const clearPress = () => {
	      pressed = false;
	      moved = false;
	      if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
	      pressT = 0;
	    };

	    const toggleDrawer = () => {
	      try {
	        if (_isBookmarkDrawerOpen()) closeBookmarkDrawer(dom);
	        else _openBookmarkDrawer();
	      } catch (_) { _openBookmarkDrawer(); }
	    };

	    btn.addEventListener("pointerdown", (e) => {
	      try {
	        if (e && typeof e.button === "number" && e.button !== 0) return;
	      } catch (_) {}
	      pressed = true;
	      moved = false;
	      longFired = false;
	      startX = Number(e && e.clientX) || 0;
	      startY = Number(e && e.clientY) || 0;
	      if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
	      pressT = window.setTimeout(() => {
	        if (!pressed || moved) return;
	        longFired = true;
	        toggleDrawer();
	      }, LONG_MS);
	    });
	    btn.addEventListener("pointermove", (e) => {
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
	    });
	    btn.addEventListener("pointerup", clearPress);
	    btn.addEventListener("pointercancel", clearPress);
	    btn.addEventListener("pointerleave", clearPress);

	    btn.addEventListener("click", (e) => {
	      if (longFired) {
	        longFired = false;
	        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
	        return;
	      }
	      toggleDrawer();
	    });
  }
  if (dom.bookmarkTabsToggleBtn) {
    const btn = dom.bookmarkTabsToggleBtn;
    let pressed = false;
    let moved = false;
    let skipClick = false;
    let capturedPid = null;
    let startX = 0;
    let startY = 0;
    const MOVE_PX = 6;

    const setCollapsed = (collapsed) => {
      const on = !!collapsed;
      try { localStorage.setItem(_LS_TABS_COLLAPSED, on ? "1" : "0"); } catch (_) {}
      _applyTabsCollapsedLocal(on);
      _syncBookmarkTabsToggle();
    };

    const releaseCapture = () => {
      try {
        if (capturedPid != null && typeof btn.releasePointerCapture === "function") btn.releasePointerCapture(capturedPid);
      } catch (_) {}
      capturedPid = null;
    };

    const calcCheckedFromPointer = (e) => {
      try {
        const r = btn.getBoundingClientRect();
        const x = Number(e && e.clientX) || 0;
        return x >= (r.left + r.width / 2);
      } catch (_) {}
      return String(btn.getAttribute("aria-checked") || "") === "true";
    };

    btn.addEventListener("pointerdown", (e) => {
      try {
        if (e && typeof e.button === "number" && e.button !== 0) return;
      } catch (_) {}
      pressed = true;
      moved = false;
      skipClick = false;
      startX = Number(e && e.clientX) || 0;
      startY = Number(e && e.clientY) || 0;
      try {
        if (e && typeof e.pointerId === "number" && typeof btn.setPointerCapture === "function") {
          btn.setPointerCapture(e.pointerId);
          capturedPid = e.pointerId;
        }
      } catch (_) {}
    });
    btn.addEventListener("pointermove", (e) => {
      if (!pressed) return;
      const x = Number(e && e.clientX) || 0;
      const y = Number(e && e.clientY) || 0;
      const dx = x - startX;
      const dy = y - startY;
      if (!moved && (dx * dx + dy * dy) > (MOVE_PX * MOVE_PX)) moved = true;
      if (!moved) return;
      const checked = calcCheckedFromPointer(e);
      try { btn.setAttribute("aria-checked", checked ? "true" : "false"); } catch (_) {}
    });
    btn.addEventListener("pointerup", (e) => {
      if (!pressed) return;
      pressed = false;
      releaseCapture();
      if (!moved) return;
      skipClick = true;
      const checked = calcCheckedFromPointer(e);
      setCollapsed(!checked);
    });
    btn.addEventListener("pointercancel", () => {
      pressed = false;
      moved = false;
      releaseCapture();
      _syncBookmarkTabsToggle();
    });
    btn.addEventListener("pointerleave", () => {
      if (capturedPid != null) return;
      pressed = false;
      moved = false;
      _syncBookmarkTabsToggle();
    });
    btn.addEventListener("click", (e) => {
      if (skipClick) {
        skipClick = false;
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        return;
      }
      const cur = _readSavedBool(_LS_TABS_COLLAPSED, false);
      setCollapsed(!cur);
    });
  }
  if (dom.bookmarkDrawerOverlay) dom.bookmarkDrawerOverlay.addEventListener("click", () => { closeBookmarkDrawer(dom); });
  if (dom.bookmarkDrawerCloseBtn) dom.bookmarkDrawerCloseBtn.addEventListener("click", () => { closeBookmarkDrawer(dom); });

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

  const _enterInlineRename = (row, key) => {
    const k = String(key || "");
    if (!row || !k) return;
    if (_bookmarkDrawerEditingKey && _bookmarkDrawerEditingKey !== k) return;
    const input = row.querySelector ? row.querySelector("input.tab-edit") : null;
    const labelEl = row.querySelector ? row.querySelector(".tab-label") : null;
    if (!input || !labelEl) return;
    _bookmarkDrawerEditingKey = k;
    try { row.classList.add("editing"); } catch (_) {}

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const t = state.threadIndex.get(k) || { key: k, thread_id: "", file: "" };
      const def = _threadDefaultLabel(t);
      const raw = String(input.value || "");
      const v = raw.trim();
      if (commit) setCustomLabel(k, v);
      const nextLabel = getCustomLabel(k) || def;
      try { labelEl.textContent = nextLabel; } catch (_) {}
      try { input.value = nextLabel; } catch (_) {}
      try { row.classList.remove("editing"); } catch (_) {}
      _bookmarkDrawerEditingKey = "";
      try { renderTabs(); } catch (_) {}
      if (commit) _toastFromEl(input, v ? "已重命名" : "已恢复默认名");
    };

    input.onkeydown = (e) => {
      const kk = String(e && e.key ? e.key : "");
      if (kk === "Enter") { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} finish(true); }
      if (kk === "Escape") { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} finish(false); }
    };
    input.onblur = () => finish(true);

    try {
      const cur = getCustomLabel(k) || _threadDefaultLabel(state.threadIndex.get(k) || {});
      input.value = cur;
      setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 0);
    } catch (_) {}
  };

  const _handleBookmarkListClick = async (e) => {
    const btn = e && e.target && e.target.closest ? e.target.closest("button[data-action]") : null;
    const row = e && e.target && e.target.closest ? e.target.closest(".tab[data-key]") : null;
    const key = row && row.dataset ? String(row.dataset.key || "") : "";
    if (!row || !key) return;
    const isHiddenRow = !!(row.dataset && row.dataset.hidden === "1");
    if (row.classList && row.classList.contains("editing")) return;
    try {
      const lp = row.dataset ? Number(row.dataset.lp || 0) : 0;
      if (lp && (Date.now() - lp) < 900) return;
    } catch (_) {}

	    if (btn && btn.dataset) {
	      const action = String(btn.dataset.action || "");
	      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
		      if (action === "rename") { _enterInlineRename(row, key); return; }
			      if (action === "export") {
		        const p = getExportPrefsForKey(key);
		        const mode = p.quick ? "quick" : "full";
		        const reasoningLang = p.translate ? "zh" : "en";
		        const r = await exportThreadMarkdown(state, key, { mode, reasoningLang });
			        _toastFromEl(btn, r && r.ok ? "已导出" : "导出失败");
			        return;
			      }
			      if (action === "delete") {
			        const labelText = row && row.dataset ? String(row.dataset.label || "") : "";
			        const ok = await confirmDialog(dom, {
			          title: "清除该会话？",
			          desc: `将从会话列表清除：${labelText || key}\n（不会删除原始会话文件；有新输出会自动回来）`,
			          confirmText: "清除",
			          cancelText: "取消",
			          danger: true,
			        });
			        if (!ok) return;
			        // “清除对话”仅用于清理僵尸会话：不应永久落入“已关闭监听”。
			        try {
			          const hidden = _ensureHiddenSet();
			          if (hidden && typeof hidden.delete === "function" && hidden.has(key)) {
			            hidden.delete(key);
			            saveHiddenThreads(hidden);
			          }
			        } catch (_) {}
			        const t0 = state.threadIndex.get(key) || { last_seq: 0 };
			        const atSeq = Number(t0 && t0.last_seq) || 0;
			        const kk = (t0 && t0.kinds && typeof t0.kinds === "object") ? t0.kinds : {};
			        const m = (state.closedThreads && typeof state.closedThreads.set === "function") ? state.closedThreads : (state.closedThreads = new Map());
			        m.set(key, {
			          at_seq: atSeq,
			          at_count: Number(t0 && t0.count) || 0,
			          at_ts: String((t0 && t0.last_ts) ? t0.last_ts : ""),
			          at_ms: Date.now(),
			          at_kinds: {
			            assistant_message: Number(kk.assistant_message) || 0,
			            user_message: Number(kk.user_message) || 0,
			            reasoning_summary: Number(kk.reasoning_summary) || 0,
			          },
			        });
			        try { saveClosedThreads(m); } catch (_) {}
			        _toastFromEl(btn, "已清除（有新输出会自动回来）");
			        try { renderTabs(); } catch (_) {}
			        _renderBookmarkDrawerList();
			        if (String(state.currentKey || "all") === key) {
			          await onSelectKey("all");
			        }
			        return;
			      }
		      if (action === "listenOff") {
		        const hidden = _ensureHiddenSet();
		        if (!hidden.has(key)) hidden.add(key);
		        saveHiddenThreads(hidden);
		        try { renderTabs(); } catch (_) {}
		        _renderBookmarkDrawerList();
		        if (String(state.currentKey || "all") === key) {
		          await onSelectKey(_pickFallbackKey(key));
	        }
	        return;
	      }
		      if (action === "listenOn") {
		        const hidden = _ensureHiddenSet();
		        if (hidden.has(key)) hidden.delete(key);
		        saveHiddenThreads(hidden);
		        try { renderTabs(); } catch (_) {}
		        _renderBookmarkDrawerList();
		        return;
		      }
	      if (action === "remove") {
	        const hidden = _ensureHiddenSet();
	        if (!hidden.has(key)) hidden.add(key);
	        saveHiddenThreads(hidden);
	        try { renderTabs(); } catch (_) {}
	        _renderBookmarkDrawerList();
	        if (String(state.currentKey || "all") === key) {
	          await onSelectKey(_pickFallbackKey(key));
        }
        return;
      }
	      if (action === "restore") {
	        const hidden = _ensureHiddenSet();
	        if (hidden.has(key)) hidden.delete(key);
	        saveHiddenThreads(hidden);
	        try { renderTabs(); } catch (_) {}
	        _renderBookmarkDrawerList();
	        return;
	      }
      return;
    }

    // 点击条目：切换会话（若来自“已移除”，则先恢复）
    if (isHiddenRow) {
      const hidden = _ensureHiddenSet();
      if (hidden.has(key)) hidden.delete(key);
      saveHiddenThreads(hidden);
      try { renderTabs(); } catch (_) {}
      _renderBookmarkDrawerList();
    }
    await onSelectKey(key);
    closeBookmarkDrawer(dom);
  };

  const _handleBookmarkListKeydown = async (e) => {
    if (!e) return;
    const keyName = String(e.key || "");
    if (keyName !== "Enter" && keyName !== " ") return;
    const row = e.target && e.target.closest ? e.target.closest(".tab[data-key]") : null;
    const key = row && row.dataset ? String(row.dataset.key || "") : "";
    if (!row || !key) return;
    try { e.preventDefault(); } catch (_) {}
    await _handleBookmarkListClick({ target: row });
  };

  if (dom.bookmarkList) dom.bookmarkList.addEventListener("click", async (e) => { try { await _handleBookmarkListClick(e); } catch (_) {} });
  if (dom.bookmarkHiddenList) dom.bookmarkHiddenList.addEventListener("click", async (e) => { try { await _handleBookmarkListClick(e); } catch (_) {} });
  if (dom.bookmarkList) dom.bookmarkList.addEventListener("keydown", async (e) => { try { await _handleBookmarkListKeydown(e); } catch (_) {} });
  if (dom.bookmarkHiddenList) dom.bookmarkHiddenList.addEventListener("keydown", async (e) => { try { await _handleBookmarkListKeydown(e); } catch (_) {} });

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
