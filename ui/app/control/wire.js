import { api } from "./api.js";
import { clearView, restartProcess, startWatch, stopWatch } from "./actions.js";
import { saveConfig, saveTranslateConfig } from "./config.js";
import { applyProfileToInputs, readHttpInputs, refreshHttpProfileSelect, upsertSelectedProfileFromInputs } from "./http_profiles.js";
import { closeBookmarkDrawer, closeDrawer, closeTranslateDrawer, confirmDialog, openBookmarkDrawer, openDrawer, openTranslatorSettings, setDebug, setStatus, setTopStatusSummary, showProviderBlocks } from "./ui.js";
import { showShutdownScreen } from "../shutdown.js";
import { toggleViewMode } from "../view_mode.js";
import { flashToastAt } from "../utils/toast.js";
import { buildThinkingMetaRight } from "../thinking/meta.js";
import { maybePlayNotifySound, preloadNotifySound } from "../sound.js";
import { colorForKey, rolloutStampFromFile, shortId } from "../utils.js";
import { exportThreadMarkdown } from "../export.js";
import { getCustomLabel, setCustomLabel } from "../sidebar/labels.js";
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
  const _LS_EXPORT_QUICK = "codex_sidecar_export_quick_v1";
  const _LS_EXPORT_TRANSLATE = "codex_sidecar_export_translate_v1";

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

  if (dom.notifySound) dom.notifySound.addEventListener("change", async () => {
    const v = String(dom.notifySound.value || "none").trim().toLowerCase() || "none";
    try { state.notifySound = v; } catch (_) {}
    try { preloadNotifySound(state); } catch (_) {}
    try {
      await api("POST", "/api/config", { notify_sound: v });
    } catch (_) {}
    try {
      const label = (() => {
        try {
          const sel = dom.notifySound;
          const idx = Number(sel && typeof sel.selectedIndex === "number" ? sel.selectedIndex : -1);
          const opt = (sel && sel.options && idx >= 0) ? sel.options[idx] : null;
          const t = opt ? String(opt.textContent || "").trim() : "";
          return t || "";
        } catch (_) {
          return "";
        }
      })();
      const r = dom.notifySound.getBoundingClientRect();
      flashToastAt(r.left + r.width / 2, r.top + r.height / 2, v === "none" ? "提示音：已关闭" : (`提示音：${label || "已开启"}`), { isLight: true, durationMs: 1100 });
    } catch (_) {}
    try { if (v !== "none") maybePlayNotifySound(dom, state); } catch (_) {}
  });

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
      if (!silent) _toastFromEl(el, "字体大小需为整数（12-24px）", { durationMs: 1500 });
      return;
    }
    _setInvalid(el, false);
    const v = _applyUiFontSize(n);
    try { localStorage.setItem(_LS_UI_FONT, String(v)); } catch (_) {}
    if (!silent) _toastFromEl(el, `字体大小：${v}px`);
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
      if (!silent) _toastFromEl(el, "按钮大小需为整数（32-72px）", { durationMs: 1500 });
      return;
    }
    _setInvalid(el, false);
    const v = _applyUiButtonSize(n);
    try { localStorage.setItem(_LS_UI_BTN, String(v)); } catch (_) {}
    if (!silent) _toastFromEl(el, `按钮大小：${v}px`);
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

  const _getExportPrefs = () => {
    const quick = _readSavedBool(_LS_EXPORT_QUICK, true);
    const translate = _readSavedBool(_LS_EXPORT_TRANSLATE, true);
    return { quick, translate };
  };

  const _syncExportPrefsUI = (silent = true) => {
    const p = _getExportPrefs();
    try { if (dom.exportQuick) dom.exportQuick.checked = !!p.quick; } catch (_) {}
    try { if (dom.exportTranslate) dom.exportTranslate.checked = !!p.translate; } catch (_) {}
    if (!silent) {
      try { _toastFromEl(dom.exportOptions || dom.exportQuick, `导出：${p.quick ? "精简" : "全量"} · ${p.translate ? "含翻译" : "仅原文"}`, { durationMs: 1400 }); } catch (_) {}
    }
    return p;
  };

  _syncExportPrefsUI(true);

  if (dom.exportQuick) dom.exportQuick.addEventListener("change", () => {
    const v = !!dom.exportQuick.checked;
    try { localStorage.setItem(_LS_EXPORT_QUICK, v ? "1" : "0"); } catch (_) {}
    _syncExportPrefsUI(false);
  });
  if (dom.exportTranslate) dom.exportTranslate.addEventListener("change", () => {
    const v = !!dom.exportTranslate.checked;
    try { localStorage.setItem(_LS_EXPORT_TRANSLATE, v ? "1" : "0"); } catch (_) {}
    _syncExportPrefsUI(false);
  });

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
  let _bookmarkDrawerTipMs = 0;
  const _bmTip = (el, text) => {
    const msg = String(text || "").trim();
    if (!msg) return;
    const now = Date.now();
    if (now - _bookmarkDrawerTipMs < 2200) return;
    _bookmarkDrawerTipMs = now;
    _toastFromEl(el, msg, { durationMs: 1400 });
  };
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
	        row.dataset.hint = isHiddenList ? "点击：恢复到标签栏" : "左键长按：删除该会话";
	        if (isHiddenList) row.dataset.hidden = "1";
	        row.setAttribute("role", "button");
	        row.tabIndex = 0;
          try { row.removeAttribute("title"); } catch (_) {}

	        const dot = document.createElement("span");
	        dot.className = "tab-dot";
	        try { dot.style.background = String((it.color && it.color.fg) ? it.color.fg : "#64748b"); } catch (_) {}

	        const label = document.createElement("span");
	        label.className = "tab-label";
	        label.textContent = String(it.label || "");

          const sub = document.createElement("span");
          sub.className = "tab-sub";
          try {
            const base = String(it.fileBase || "");
            const followFiles = (state && Array.isArray(state.statusFollowFiles)) ? state.statusFollowFiles : [];
            const suffix = followFiles.length ? (it.followed ? " · 跟随中" : " · 历史") : "";
            sub.textContent = base ? `${base}${suffix}` : "";
          } catch (_) { sub.textContent = ""; }

	        const input = document.createElement("input");
	        input.className = "tab-edit";
	        input.type = "text";
	        input.autocomplete = "off";
	        input.spellcheck = false;
	        input.value = String(it.label || "");

        const actions = document.createElement("div");
        actions.className = "tab-actions";

        const renameBtn = document.createElement("button");
        renameBtn.className = "mini-btn";
        renameBtn.type = "button";
        renameBtn.dataset.action = "rename";
        renameBtn.setAttribute("aria-label", "重命名");
        renameBtn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-edit"></use></svg>`;
        try { renameBtn.addEventListener("mouseenter", () => _bmTip(renameBtn, "重命名~ (´▽｀)")); } catch (_) {}

        const exportBtn = document.createElement("button");
        exportBtn.className = "mini-btn";
        exportBtn.type = "button";
        exportBtn.dataset.action = "export";
        exportBtn.setAttribute("aria-label", "导出（长按设置）");
        exportBtn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-download"></use></svg>`;
        try { exportBtn.addEventListener("mouseenter", () => _bmTip(exportBtn, "长按：导出设置~ (￣▽￣)")); } catch (_) {}
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
              try { openDrawer(dom); } catch (_) {}
              try {
                setTimeout(() => {
                  try { if (dom.exportOptions && dom.exportOptions.scrollIntoView) dom.exportOptions.scrollIntoView({ block: "center" }); } catch (_) {}
                }, 0);
              } catch (_) {}
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
        toggleBtn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="${isHiddenList ? "#i-eye" : "#i-eye-closed"}"></use></svg>`;
        try { toggleBtn.addEventListener("mouseenter", () => _bmTip(toggleBtn, isHiddenList ? "开启监听" : "关闭监听")); } catch (_) {}

	        actions.appendChild(renameBtn);
	        actions.appendChild(exportBtn);
	        actions.appendChild(toggleBtn);

          const main = document.createElement("div");
          main.className = "tab-main";
          main.appendChild(label);
          if (sub && String(sub.textContent || "").trim()) main.appendChild(sub);
          main.appendChild(input);

	        row.appendChild(dot);
	        row.appendChild(main);
	        row.appendChild(actions);
	        frag.appendChild(row);
          try {
            row.addEventListener("mouseenter", () => {
              const hint = row && row.dataset ? String(row.dataset.hint || "") : "";
              if (hint) _bmTip(row, hint);
            });
          } catch (_) {}

          // Long press to rename (more direct than opening dialogs).
          try {
            let pressT = 0;
            let startX = 0;
            let startY = 0;
            let moved = false;
            const clear = () => { if (pressT) { try { clearTimeout(pressT); } catch (_) {} } pressT = 0; moved = false; };
            row.addEventListener("pointerdown", (e) => {
              try {
                if (e && typeof e.button === "number" && e.button !== 0) return;
                const t = e && e.target;
                if (t && t.closest && t.closest("button")) return;
              } catch (_) {}
              clear();
              startX = Number(e && e.clientX) || 0;
              startY = Number(e && e.clientY) || 0;
              moved = false;
              pressT = setTimeout(() => {
                if (moved) return;
                try { row.dataset.lp = String(Date.now()); } catch (_) {}
                (async () => {
                  const k = String(it.key || "");
                  if (!k) return;
                  const ok = await confirmDialog(dom, {
                    title: "清除该会话？",
                    desc: `将从会话列表清除：${String(it.label || "")}\n（不会删除原始会话文件；有新输出会自动回来）`,
                    confirmText: "清除",
                    cancelText: "取消",
                    danger: true,
                  });
                  if (!ok) return;
                  const t0 = state.threadIndex.get(k) || { last_seq: 0 };
                  const atSeq = Number(t0 && t0.last_seq) || 0;
                  const m = (state.closedThreads && typeof state.closedThreads.set === "function") ? state.closedThreads : (state.closedThreads = new Map());
                  m.set(k, { at_seq: atSeq, at_count: Number(t0 && t0.count) || 0, at_ts: String((t0 && t0.last_ts) ? t0.last_ts : "") });
                  _toastFromEl(row, "已清除（有新输出会自动回来）");
                  try { renderTabs(); } catch (_) {}
                  _renderBookmarkDrawerList();
                  if (String(state.currentKey || "all") === k) await onSelectKey(_pickFallbackKey(k));
                })().catch(() => {});
              }, 460);
            });
            row.addEventListener("pointermove", (e) => {
              if (!pressT) return;
              const x = Number(e && e.clientX) || 0;
              const y = Number(e && e.clientY) || 0;
              const dx = x - startX;
              const dy = y - startY;
              if ((dx * dx + dy * dy) > (8 * 8)) { moved = true; clear(); }
            });
            row.addEventListener("pointerup", clear);
            row.addEventListener("pointercancel", clear);
            row.addEventListener("pointerleave", clear);
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
    _renderBookmarkDrawerList();
  };

  if (dom.bookmarkDrawerToggleBtn) dom.bookmarkDrawerToggleBtn.addEventListener("click", () => {
    try {
      if (_isBookmarkDrawerOpen()) closeBookmarkDrawer(dom);
      else _openBookmarkDrawer();
    } catch (_) { _openBookmarkDrawer(); }
  });
  if (dom.bookmarkDrawerOverlay) dom.bookmarkDrawerOverlay.addEventListener("click", () => { closeBookmarkDrawer(dom); });
  if (dom.bookmarkDrawerCloseBtn) dom.bookmarkDrawerCloseBtn.addEventListener("click", () => { closeBookmarkDrawer(dom); });

  if (dom.drawerOverlay) dom.drawerOverlay.addEventListener("click", () => { closeDrawer(dom); });
  if (dom.drawerCloseBtn) dom.drawerCloseBtn.addEventListener("click", () => { closeDrawer(dom); });
  if (dom.translateDrawerOverlay) dom.translateDrawerOverlay.addEventListener("click", () => { closeTranslateDrawer(dom); });
  if (dom.translateDrawerCloseBtn) dom.translateDrawerCloseBtn.addEventListener("click", () => { closeTranslateDrawer(dom); });
  window.addEventListener("keydown", (e) => {
    try {
      if (e && e.key === "Escape") { closeBookmarkDrawer(dom); closeTranslateDrawer(dom); closeDrawer(dom); }
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
        _toastFromEl(btn, "正在导出…");
        const p = _getExportPrefs();
        const mode = p.quick ? "quick" : "full";
        const reasoningLang = p.translate ? "toggle" : "en";
        const r = await exportThreadMarkdown(state, key, { mode, reasoningLang });
	        _toastFromEl(btn, r && r.ok ? "已导出（下载）" : "导出失败");
	        return;
	      }
	      if (action === "listenOff") {
	        const hidden = _ensureHiddenSet();
	        if (!hidden.has(key)) hidden.add(key);
	        saveHiddenThreads(hidden);
	        _toastFromEl(btn, "监听：已关闭（已隐藏）");
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
	        _toastFromEl(btn, "监听：已开启（已恢复）");
	        try { renderTabs(); } catch (_) {}
	        _renderBookmarkDrawerList();
	        return;
	      }
	      if (action === "remove") {
	        const hidden = _ensureHiddenSet();
	        if (!hidden.has(key)) hidden.add(key);
	        saveHiddenThreads(hidden);
        _toastFromEl(btn, "已从标签栏移除");
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
        _toastFromEl(btn, "已恢复到标签栏");
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
  if (dom.saveBtn) dom.saveBtn.addEventListener("click", async () => { await saveConfig(dom, state); });
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
  if (dom.quickViewBtn) dom.quickViewBtn.addEventListener("click", () => { toggleViewMode(dom, state); try { setTopStatusSummary(dom, state); } catch (_) {} });
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
