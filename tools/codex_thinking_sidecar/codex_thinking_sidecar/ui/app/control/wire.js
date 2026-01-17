import { api } from "./api.js";
import { clearView, restartProcess, startWatch, stopWatch } from "./actions.js";
import { saveConfig, saveTranslateConfig } from "./config.js";
import { applyProfileToInputs, readHttpInputs, refreshHttpProfileSelect, upsertSelectedProfileFromInputs } from "./http_profiles.js";
import { closeBookmarkDrawer, closeDrawer, closeTranslateDrawer, openBookmarkDrawer, openDrawer, openTranslatorSettings, setDebug, setStatus, showProviderBlocks } from "./ui.js";
import { showShutdownScreen } from "../shutdown.js";
import { toggleViewMode } from "../view_mode.js";
import { flashToastAt } from "../utils/toast.js";
import { buildThinkingMetaRight } from "../thinking/meta.js";
import { maybePlayNotifySound, preloadNotifySound } from "../sound.js";
import { colorForKey, rolloutStampFromFile, shortId } from "../utils.js";
import { exportCurrentThreadMarkdown } from "../export.js";
import { getCustomLabel, setCustomLabel } from "../sidebar/labels.js";
import { saveHiddenThreads, saveShowHiddenFlag } from "../sidebar/hidden.js";
import { getUnreadCount, getUnreadTotal } from "../unread.js";

export function wireControlEvents(dom, state, helpers) {
  const h = (helpers && typeof helpers === "object") ? helpers : {};
  const refreshList = typeof h.refreshList === "function" ? h.refreshList : (async () => {});
  const onSelectKey = typeof h.onSelectKey === "function" ? h.onSelectKey : (async () => {});
  const renderTabs = typeof h.renderTabs === "function" ? h.renderTabs : (() => {});

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

  const _getPinOnSelect = () => {
    try {
      const raw = localStorage.getItem("codex_sidecar_pin_on_select");
      return raw !== "0";
    } catch (_) {
      return true;
    }
  };

  const _setPinOnSelect = (on) => {
    try { localStorage.setItem("codex_sidecar_pin_on_select", on ? "1" : "0"); } catch (_) {}
  };

  const _syncBookmarkDrawerControls = () => {
    try {
      if (dom.bookmarkShowHidden) dom.bookmarkShowHidden.value = state.showHiddenThreads ? "1" : "0";
      if (dom.bookmarkPinOnSelect) dom.bookmarkPinOnSelect.value = _getPinOnSelect() ? "1" : "0";
    } catch (_) {}
  };

  const _renderBookmarkDrawerList = () => {
    const host = dom.bookmarkList;
    if (!host) return;
    // 仅在抽屉打开时渲染，避免 SSE 高频刷新带来额外负担。
    if (!_isBookmarkDrawerOpen()) return;

    const q = String(dom.bookmarkSearch && dom.bookmarkSearch.value ? dom.bookmarkSearch.value : "").trim().toLowerCase();
    const items = [];

    try {
      const totalUnread = getUnreadTotal(state);
      items.push({
        key: "all",
        label: "全部",
        unread: totalUnread,
        hidden: false,
        active: String(state.currentKey || "all") === "all",
        color: { fg: "#111827" },
      });
    } catch (_) {}

    try {
      const arr = Array.from(state.threadIndex.values());
      arr.sort((a, b) => {
        const sa = Number(a && a.last_seq) || 0;
        const sb = Number(b && b.last_seq) || 0;
        if (sa !== sb) return sb - sa;
        return String(b && b.last_ts ? b.last_ts : "").localeCompare(String(a && a.last_ts ? a.last_ts : ""));
      });

      for (const t of arr) {
        const key = String((t && t.key) ? t.key : "");
        if (!key) continue;
        const label = _threadLabel(t);
        const file = String((t && t.file) ? t.file : "");
        const tid = String((t && t.thread_id) ? t.thread_id : "");
        const hay = `${label}\n${key}\n${file}\n${tid}`.toLowerCase();
        if (q && !hay.includes(q)) continue;
        const isHidden = !!(state.hiddenThreads && typeof state.hiddenThreads.has === "function" && state.hiddenThreads.has(key));
        const unread = getUnreadCount(state, key);
        const clr = colorForKey(key);
        items.push({
          key,
          label,
          unread,
          hidden: isHidden,
          active: String(state.currentKey || "all") === key,
          color: clr,
        });
      }
    } catch (_) {}

    try { host.replaceChildren(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }

    const frag = document.createDocumentFragment();
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "tab"
        + (it.active ? " active" : "")
        + (it.unread > 0 ? " has-unread" : "")
        + (it.hidden ? " tab-hidden" : "");
      row.dataset.key = String(it.key || "");
      if (it.unread > 0) row.dataset.unread = it.unread > 99 ? "99+" : String(it.unread);
      row.setAttribute("role", "button");
      row.tabIndex = 0;

      const dot = document.createElement("span");
      dot.className = "tab-dot";
      try { dot.style.background = String((it.color && it.color.fg) ? it.color.fg : "#64748b"); } catch (_) {}

      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = String(it.label || "");

      const actions = document.createElement("div");
      actions.style.marginLeft = "auto";
      actions.style.display = "flex";
      actions.style.gap = "6px";
      actions.style.alignItems = "center";

      if (it.key !== "all") {
        const renameBtn = document.createElement("button");
        renameBtn.className = "mini-btn";
        renameBtn.type = "button";
        renameBtn.dataset.action = "rename";
        renameBtn.setAttribute("aria-label", "重命名");
        renameBtn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-edit"></use></svg>`;

        const hideBtn = document.createElement("button");
        hideBtn.className = "mini-btn" + (it.hidden ? " active" : "");
        hideBtn.type = "button";
        hideBtn.dataset.action = "toggleHidden";
        hideBtn.setAttribute("aria-label", it.hidden ? "取消隐藏" : "隐藏");
        hideBtn.textContent = it.hidden ? "显" : "隐";

        actions.appendChild(renameBtn);
        actions.appendChild(hideBtn);
      }

      row.appendChild(dot);
      row.appendChild(label);
      row.appendChild(actions);
      frag.appendChild(row);
    }

    host.appendChild(frag);
  };

  const _openBookmarkDrawer = () => {
    openBookmarkDrawer(dom);
    _syncBookmarkDrawerControls();
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

  if (dom.bookmarkSearch) dom.bookmarkSearch.addEventListener("input", () => { _renderBookmarkDrawerList(); });
  if (dom.bookmarkShowHidden) dom.bookmarkShowHidden.addEventListener("change", async () => {
    const on = String(dom.bookmarkShowHidden.value || "") === "1";
    try { state.showHiddenThreads = on; } catch (_) {}
    saveShowHiddenFlag(on);
    let jumped = false;
    try {
      const curKey = String(state.currentKey || "all");
      const hiddenCur = !!(!on && curKey && curKey !== "all" && state.hiddenThreads && typeof state.hiddenThreads.has === "function" && state.hiddenThreads.has(curKey));
      if (hiddenCur) { jumped = true; await onSelectKey("all"); }
    } catch (_) {}
    if (!jumped) renderTabs();
    _renderBookmarkDrawerList();
    _toastFromEl(dom.bookmarkShowHidden, on ? "已显示隐藏会话" : "已隐藏隐藏会话");
  });
  if (dom.bookmarkPinOnSelect) dom.bookmarkPinOnSelect.addEventListener("change", () => {
    const on = String(dom.bookmarkPinOnSelect.value || "") !== "0";
    _setPinOnSelect(on);
    _toastFromEl(dom.bookmarkPinOnSelect, on ? "选中即锁定：已开启" : "选中即锁定：已关闭");
  });

  if (dom.bookmarkExportBtn) dom.bookmarkExportBtn.addEventListener("click", async () => {
    const key = String(state.currentKey || "all");
    if (!key || key === "all") { _toastFromEl(dom.bookmarkExportBtn, "请先选择具体会话"); return; }
    _toastFromEl(dom.bookmarkExportBtn, "正在导出…");
    const mode = (String(state.viewMode || "").toLowerCase() === "quick") ? "quick" : "full";
    const r = await exportCurrentThreadMarkdown(state, { mode });
    _toastFromEl(dom.bookmarkExportBtn, r && r.ok ? "已导出（下载）" : "导出失败");
  });

  if (dom.bookmarkList) dom.bookmarkList.addEventListener("click", async (e) => {
    try {
      const btn = e && e.target && e.target.closest ? e.target.closest("button[data-action]") : null;
      const row = e && e.target && e.target.closest ? e.target.closest(".tab[data-key]") : null;
      const key = row && row.dataset ? String(row.dataset.key || "") : "";
      if (!key) return;

      if (btn && btn.dataset) {
        const action = String(btn.dataset.action || "");
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        if (action === "rename") {
          const t = state.threadIndex.get(key) || { key, thread_id: "", file: "" };
          const cur = getCustomLabel(key) || _threadDefaultLabel(t);
          const raw = prompt("重命名会话书签：", cur);
          if (raw == null) return;
          const next = String(raw || "").trim();
          setCustomLabel(key, next);
          renderTabs();
          _renderBookmarkDrawerList();
          _toastFromEl(btn, next ? "已重命名" : "已恢复默认名");
          return;
        }
        if (action === "toggleHidden") {
          if (!state.hiddenThreads || typeof state.hiddenThreads.add !== "function") state.hiddenThreads = new Set();
          const was = state.hiddenThreads.has(key);
          if (was) state.hiddenThreads.delete(key);
          else state.hiddenThreads.add(key);
          saveHiddenThreads(state.hiddenThreads);
          renderTabs();
          _renderBookmarkDrawerList();
          _toastFromEl(btn, was ? "已取消隐藏" : "已隐藏会话");
          if (!was && !state.showHiddenThreads && String(state.currentKey || "all") === key) {
            await onSelectKey("all");
          }
          return;
        }
        return;
      }

      // 点击条目：切换会话并关闭抽屉，便于查看内容。
      await onSelectKey(key);
      closeBookmarkDrawer(dom);
    } catch (_) {}
  });

  if (dom.bookmarkList) dom.bookmarkList.addEventListener("keydown", async (e) => {
    try {
      if (!e || (e.key !== "Enter" && e.key !== " ")) return;
      const row = e.target && e.target.closest ? e.target.closest(".tab[data-key]") : null;
      const key = row && row.dataset ? String(row.dataset.key || "") : "";
      if (!key) return;
      try { e.preventDefault(); } catch (_) {}
      await onSelectKey(key);
      closeBookmarkDrawer(dom);
    } catch (_) {}
  });

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
  if (dom.quickViewBtn) dom.quickViewBtn.addEventListener("click", () => { toggleViewMode(dom, state); });
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
  }

  if (dom.scrollTopBtn) dom.scrollTopBtn.addEventListener("click", () => { window.scrollTo({ top: 0, behavior: "smooth" }); });
  if (dom.scrollBottomBtn) dom.scrollBottomBtn.addEventListener("click", async () => {
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
    }
  });
}
