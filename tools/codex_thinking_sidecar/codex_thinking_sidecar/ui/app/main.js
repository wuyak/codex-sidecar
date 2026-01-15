import { getDom } from "./dom.js";
import { connectEventStream, drainBufferedForKey } from "./events.js";
import { loadControl, maybeAutoStartOnce, setStatus, wireControlEvents } from "./control.js";
import { bootstrap, refreshList } from "./list.js";
import { renderEmpty, renderMessage } from "./render.js";
import { createState } from "./state.js";
import { renderTabs, upsertThread } from "./sidebar.js";
import { escapeHtml } from "./utils.js";
import { flashToastAt } from "./utils/toast.js";
import { stabilizeClickWithin } from "./utils/anchor.js";
import { initViewMode } from "./view_mode.js";
import { activateView, initViews } from "./views.js";

export async function initApp() {
  const dom = getDom();
  const state = createState();
  initViews(dom, state);
  initViewMode(dom, state);

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

  function _defaultThinkMode(hasZh) {
    return hasZh ? "zh" : "en";
  }

  function _setThinkModeOverride(mid, mode, hasZh) {
    const k = String(mid || "").trim();
    const m = String(mode || "").trim().toLowerCase();
    if (!k) return;
    const next = (m === "en" || m === "zh") ? m : _defaultThinkMode(!!hasZh);
    const def = _defaultThinkMode(!!hasZh);
    try {
      if (!state.thinkModeById || typeof state.thinkModeById.get !== "function") state.thinkModeById = new Map();
      if (!Array.isArray(state.thinkModeOrder)) state.thinkModeOrder = [];

      if (next === def) state.thinkModeById.delete(k);
      else state.thinkModeById.set(k, next);
      state.thinkModeOrder.push(k);
      const max = Number(state.thinkModeMax) || 600;
      if (state.thinkModeById.size > max) {
        while (state.thinkModeById.size > max && state.thinkModeOrder.length) {
          const victim = state.thinkModeOrder.shift();
          if (!victim) continue;
          if (state.thinkModeById.has(victim) && state.thinkModeById.size > max) state.thinkModeById.delete(victim);
        }
      }
    } catch (_) {}
  }

  function _getRowThinkMode(row) {
    if (!row || !row.classList) return "en";
    return row.classList.contains("think-mode-zh") ? "zh" : "en";
  }

  function _hasZhReady(row) {
    try {
      const zhEl = row.querySelector ? row.querySelector(".think-zh") : null;
      const txt = zhEl ? String(zhEl.textContent || "") : "";
      return !!txt.trim();
    } catch (_) {
      return false;
    }
  }

  function _hasActiveSelection() {
    try {
      const sel = window.getSelection && window.getSelection();
      if (!sel) return false;
      if (sel.type === "Range") return true;
      const s = String(sel.toString() || "").trim();
      return !!s;
    } catch (_) {}
    return false;
  }

  function _updateThinkingMetaRight(row, mid) {
    if (!row) return;
    const metaRight = row.querySelector ? row.querySelector(".meta-right") : null;
    if (!metaRight) return;
    const hasZh = _hasZhReady(row);
    const err = String((row.dataset && row.dataset.translateError) ? row.dataset.translateError : "").trim();
    const inFlight = !!(state.translateInFlight && typeof state.translateInFlight.has === "function" && state.translateInFlight.has(mid));
    const tmode = (String(state.translateMode || "").toLowerCase() === "manual") ? "manual" : "auto";
    const statusText = hasZh
      ? "ZH 已就绪"
      : (err
        ? "ZH 翻译失败（点重试）"
        : (tmode === "manual"
          ? (inFlight ? "ZH 翻译中…" : "ZH 待翻译（点击思考）")
          : "ZH 翻译中…"));
    const btnLabel = hasZh ? "重译" : (err ? "重试" : "翻译");
    const dis = inFlight ? " disabled" : "";
    try {
      const titleAttr = err ? ` title="${escapeHtml(err)}"` : "";
      metaRight.innerHTML = `<span class="pill"${titleAttr}>${statusText}</span><button type="button" class="pill pill-btn think-translate" data-think-act="retranslate" data-mid="${mid}" title="翻译/重新翻译这条思考"${dis}>${btnLabel}</button>`;
    } catch (_) {}
  }

  function _wireThinkingRowActions() {
    const host = state && state.listHost ? state.listHost : (dom && dom.list ? dom.list : null);
    if (!host || !host.addEventListener) return;
    host.addEventListener("click", async (e) => {
      if (!e || !e.target) return;
      if (_hasActiveSelection()) return;

      // Do not hijack link clicks inside markdown.
      try { if (e.target.closest && e.target.closest("a")) return; } catch (_) {}

      // 1) Explicit translate button (always available).
      const btn = e.target.closest ? e.target.closest("[data-think-act='retranslate']") : null;
      if (btn) {
        const mid = String(btn.dataset && btn.dataset.mid ? btn.dataset.mid : "").trim();
        if (!mid) return;
        const row = btn.closest ? btn.closest(".row") : null;
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        try {
          const p = String(state.translatorProvider || "").trim().toLowerCase();
          if (p === "none") {
            flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "未启用翻译（Provider=none）", { isLight: true });
            return;
          }
        } catch (_) {}
        const inFlight = !!(state.translateInFlight && typeof state.translateInFlight.has === "function" && state.translateInFlight.has(mid));
        if (inFlight) {
          flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "正在翻译…", { isLight: true });
          return;
        }
        try {
          if (!state.translateInFlight || typeof state.translateInFlight.add !== "function") state.translateInFlight = new Set();
          state.translateInFlight.add(mid);
        } catch (_) {}
        try { if (row && row.dataset) row.dataset.translateError = ""; } catch (_) {}
        _updateThinkingMetaRight(row, mid);
        flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "正在翻译…", { isLight: true });
        try {
          await fetch("/api/control/retranslate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: mid }),
          });
        } catch (_) {
          try { state.translateInFlight.delete(mid); } catch (_) {}
          try { if (row && row.dataset) row.dataset.translateError = "翻译请求失败"; } catch (_) {}
          _updateThinkingMetaRight(row, mid);
          flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "翻译请求失败", { isLight: true });
        }
        return;
      }

      // 2) Clicking the thinking block:
      // - manual mode: trigger translation when ZH is missing
      // - after ZH ready: toggle EN/ZH
      const think = e.target.closest ? e.target.closest(".think") : null;
      if (!think) return;
      const row = think.closest ? think.closest(".row") : null;
      if (!row || !row.classList) return;
      if (!(row.classList.contains("kind-reasoning_summary") || row.classList.contains("kind-agent_reasoning"))) return;
      const mid = String((row.dataset && row.dataset.msgId) ? row.dataset.msgId : "").trim();
      if (!mid) return;

      const hasZh = _hasZhReady(row);
      if (!hasZh) {
        const tmode = (String(state.translateMode || "").toLowerCase() === "manual") ? "manual" : "auto";
        if (tmode !== "manual") {
          const err = String((row.dataset && row.dataset.translateError) ? row.dataset.translateError : "").trim();
          flashToastAt(
            Number(e.clientX) || 0,
            Number(e.clientY) || 0,
            err ? "翻译失败，点“翻译/重试”重发" : "等待翻译…",
            { isLight: true },
          );
          return;
        }
        try {
          const p = String(state.translatorProvider || "").trim().toLowerCase();
          if (p === "none") {
            flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "未启用翻译（Provider=none）", { isLight: true });
            return;
          }
        } catch (_) {}
        const inFlight = !!(state.translateInFlight && typeof state.translateInFlight.has === "function" && state.translateInFlight.has(mid));
        if (inFlight) {
          flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "正在翻译…", { isLight: true });
          return;
        }
        try {
          if (!state.translateInFlight || typeof state.translateInFlight.add !== "function") state.translateInFlight = new Set();
          state.translateInFlight.add(mid);
        } catch (_) {}
        try { if (row && row.dataset) row.dataset.translateError = ""; } catch (_) {}
        _updateThinkingMetaRight(row, mid);
        flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "正在翻译…", { isLight: true });
        try {
          await fetch("/api/control/retranslate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: mid }),
          });
        } catch (_) {
          try { state.translateInFlight.delete(mid); } catch (_) {}
          try { if (row && row.dataset) row.dataset.translateError = "翻译请求失败"; } catch (_) {}
          _updateThinkingMetaRight(row, mid);
          flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "翻译请求失败", { isLight: true });
        }
        return;
      }

      // ZH ready: toggle EN/ZH.
      const cur = _getRowThinkMode(row);
      const next = (cur === "zh") ? "en" : "zh";
      _setThinkModeOverride(mid, next, true);
      try {
        row.classList.remove("think-mode-en", "think-mode-zh", "think-mode-both");
        row.classList.add(`think-mode-${next}`);
      } catch (_) {}
      _updateThinkingMetaRight(row, mid);
      try { stabilizeClickWithin(row, Number(e && e.clientY) || 0); } catch (_) {}
    });
  }

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

  _wireThinkingRowActions();

  const onSelectKey = async (key) => {
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
    renderTabs: () => renderTabsWrapper(dom, state),
  });

  await loadControl(dom, state);
  await maybeAutoStartOnce(dom, state);
  await loadControl(dom, state);

  await bootstrap(dom, state, renderTabsWrapper, renderMessage, renderEmpty);
  connectEventStream(dom, state, upsertThread, renderTabsWrapper, renderMessage, setStatus, refreshListWrapper);
}
