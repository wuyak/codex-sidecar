import { getDom } from "./dom.js";
import { connectEventStream, drainBufferedForKey } from "./events.js";
import { loadControl, maybeAutoStartOnce, setStatus, wireControlEvents } from "./control.js";
import { bootstrap, refreshList } from "./list.js";
import { renderEmpty, renderMessage } from "./render.js";
import { createState } from "./state.js";
import { renderTabs, upsertThread } from "./sidebar.js";
import { activateView, initViews } from "./views.js";

export async function initApp() {
  const dom = getDom();
  const state = createState();
  initViews(dom, state);

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

  function _currentGlobalThinkMode() {
    try {
      const v = dom && dom.displayMode && dom.displayMode.value ? dom.displayMode.value : "both";
      return (v === "en" || v === "zh" || v === "both") ? v : "both";
    } catch (_) {
      return "both";
    }
  }

  function _setThinkModeOverride(mid, mode) {
    const k = String(mid || "").trim();
    const m = String(mode || "").trim().toLowerCase();
    if (!k) return;
    const next = (m === "en" || m === "zh" || m === "both") ? m : "both";
    const global = _currentGlobalThinkMode();
    try {
      if (!state.thinkModeById || typeof state.thinkModeById.get !== "function") state.thinkModeById = new Map();
      if (!Array.isArray(state.thinkModeOrder)) state.thinkModeOrder = [];

      if (next === global) state.thinkModeById.delete(k);
      else state.thinkModeById.set(k, next);
      state.thinkModeOrder.push(k);
      const max = Number(state.thinkModeMax) || 600;
      if (state.thinkModeById.size > max) {
        // Best-effort prune: drop oldest ids in order.
        while (state.thinkModeById.size > max && state.thinkModeOrder.length) {
          const victim = state.thinkModeOrder.shift();
          if (!victim) continue;
          // Only drop if it still maps to the stored victim (avoid deleting a recently re-used id).
          if (state.thinkModeById.has(victim) && state.thinkModeById.size > max) state.thinkModeById.delete(victim);
        }
      }
    } catch (_) {}
  }

  function _getRowThinkMode(row) {
    if (!row || !row.classList) return _currentGlobalThinkMode();
    if (row.classList.contains("think-mode-zh")) return "zh";
    if (row.classList.contains("think-mode-en")) return "en";
    if (row.classList.contains("think-mode-both")) return "both";
    return _currentGlobalThinkMode();
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

  function _updateThinkingMetaRow(row, mode) {
    if (!row) return;
    const m = (mode === "en" || mode === "zh" || mode === "both") ? mode : "both";
    try {
      row.classList.remove("think-mode-en", "think-mode-zh", "think-mode-both");
      row.classList.add(`think-mode-${m}`);
    } catch (_) {}

    const hasZh = _hasZhReady(row);
    const waitingZh = (m !== "en") && !hasZh;
    let label = "思考";
    if (m === "en") label = "思考（EN）";
    else if (m === "zh") label = waitingZh ? "思考（ZH…）" : "思考（ZH）";
    else label = waitingZh ? "思考（对照…）" : "思考（对照）";

    try {
      const modeBtn = row.querySelector ? row.querySelector("button.think-mode") : null;
      if (modeBtn) modeBtn.textContent = label;
    } catch (_) {}
    try {
      const trBtn = row.querySelector ? row.querySelector("button.think-translate") : null;
      if (trBtn) trBtn.textContent = hasZh ? "重译" : "翻译";
    } catch (_) {}
    try {
      const zhEl = row.querySelector ? row.querySelector(".think-zh") : null;
      const enEl = row.querySelector ? row.querySelector(".think-en") : null;
      if (zhEl) {
        const enHas = !!(m === "both" && enEl && String(enEl.textContent || "").trim());
        zhEl.className = `think-zh md${enHas ? " think-split" : ""}`;
      }
    } catch (_) {}
    try {
      const metaRight = row.querySelector ? row.querySelector(".meta-right") : null;
      if (metaRight) {
        metaRight.innerHTML = (m === "en")
          ? (hasZh ? `<span class="pill">ZH 已就绪</span>` : `<span class="pill">ZH 翻译中</span>`)
          : "";
      }
    } catch (_) {}
  }

  function _wireThinkingRowActions() {
    const host = state && state.listHost ? state.listHost : (dom && dom.list ? dom.list : null);
    if (!host || !host.addEventListener) return;
    host.addEventListener("click", async (e) => {
      const t = e && e.target && e.target.closest ? e.target.closest("[data-think-act]") : null;
      if (!t) return;
      const act = String(t.dataset && t.dataset.thinkAct ? t.dataset.thinkAct : "").trim();
      const mid = String(t.dataset && t.dataset.mid ? t.dataset.mid : "").trim();
      if (!act || !mid) return;

      // Avoid triggering other row click interactions.
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}

      const row = t.closest ? t.closest(".row") : null;
      if (act === "cycle_mode") {
        const cur = _getRowThinkMode(row);
        const order = ["en", "zh", "both"];
        const idx = order.indexOf(cur);
        const next = order[(idx >= 0 ? idx + 1 : 0) % order.length];
        _setThinkModeOverride(mid, next);
        _updateThinkingMetaRow(row, next);
        return;
      }

      if (act === "retranslate") {
        // In EN-only mode, "翻译/重译" implies switching this row to ZH view.
        try {
          const cur = _getRowThinkMode(row);
          if (cur === "en") {
            _setThinkModeOverride(mid, "zh");
            _updateThinkingMetaRow(row, "zh");
          }
        } catch (_) {}

        try { t.disabled = true; } catch (_) {}
        try {
          await fetch("/api/control/retranslate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: mid }),
          });
        } catch (_) {}
        setTimeout(() => { try { t.disabled = false; } catch (_) {} }, 800);
      }
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
