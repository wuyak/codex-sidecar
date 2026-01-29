import { exportCurrentThreadMarkdown } from "../export.js";
import { loadHiddenChildrenByParent, saveHiddenChildrenByParent, saveHiddenThreads, saveShowHiddenFlag } from "../sidebar/hidden.js";

export function syncSidebarHeadButtons(dom, state) {
  const key = String(state.currentKey || "all");
  const isAll = (key === "all");
  const hidden = !!(key && key !== "all" && state.hiddenThreads && typeof state.hiddenThreads.has === "function" && state.hiddenThreads.has(key));
  try {
    if (dom.exportThreadBtn) dom.exportThreadBtn.disabled = isAll;
    if (dom.hideThreadBtn) dom.hideThreadBtn.disabled = isAll;
    if (dom.hideThreadBtn && dom.hideThreadBtn.classList) dom.hideThreadBtn.classList.toggle("active", hidden);
    if (dom.showHiddenBtn && dom.showHiddenBtn.classList) dom.showHiddenBtn.classList.toggle("active", !!state.showHiddenThreads);
  } catch (_) {}
}

export function wireSidebarHeadActions(dom, state, helpers) {
  const h = (helpers && typeof helpers === "object") ? helpers : {};
  const toastBtn = typeof h.toastBtn === "function" ? h.toastBtn : (() => {});
  const onSelectKey = typeof h.onSelectKey === "function" ? h.onSelectKey : (async () => {});
  const renderTabs = typeof h.renderTabs === "function" ? h.renderTabs : (() => {});
  const syncButtons = typeof h.syncButtons === "function" ? h.syncButtons : (() => {});

  try {
    if (dom.showHiddenBtn) dom.showHiddenBtn.addEventListener("click", () => {
      state.showHiddenThreads = !state.showHiddenThreads;
      saveShowHiddenFlag(!!state.showHiddenThreads);
      syncButtons();
      try { renderTabs(); } catch (_) {}
      toastBtn(dom.showHiddenBtn, state.showHiddenThreads ? "已显示隐藏会话" : "已隐藏隐藏会话");
    });
    if (dom.hideThreadBtn) dom.hideThreadBtn.addEventListener("click", async () => {
      const key = String(state.currentKey || "all");
      if (!key || key === "all") { toastBtn(dom.hideThreadBtn, "请先选择具体会话"); return; }
      if (!state.hiddenThreads || typeof state.hiddenThreads.add !== "function") state.hiddenThreads = new Set();
      const was = state.hiddenThreads.has(key);
      if (was) state.hiddenThreads.delete(key);
      else state.hiddenThreads.add(key);

      const _subagentChildrenKeys = (parentKey) => {
        const pk = String(parentKey || "").trim();
        if (!pk || pk === "all") return [];
        const out = [];
        try {
          if (!state || !state.threadIndex || typeof state.threadIndex.values !== "function") return [];
          for (const t of state.threadIndex.values()) {
            const k = String((t && t.key) ? t.key : "").trim();
            if (!k || k === "all") continue;
            const pid = String((t && t.parent_thread_id) ? t.parent_thread_id : "").trim();
            const sk = String((t && t.source_kind) ? t.source_kind : "").trim().toLowerCase();
            if (sk !== "subagent") continue;
            if (pid !== pk) continue;
            if (k === pk) continue;
            out.push(k);
          }
        } catch (_) {}
        return out;
      };

      try {
        if (!was) {
          // Hide parent -> hide its child subagent threads (auto).
          const m = loadHiddenChildrenByParent();
          const kids = _subagentChildrenKeys(key);
          const added = [];
          for (const ck of kids) {
            if (state.hiddenThreads.has(ck)) continue;
            state.hiddenThreads.add(ck);
            added.push(ck);
          }
          if (added.length) {
            const prev = Array.isArray(m[key]) ? m[key] : [];
            const next = new Set(prev);
            for (const x of added) next.add(String(x || "").trim());
            m[key] = Array.from(next).filter(Boolean).slice(0, 200);
            saveHiddenChildrenByParent(m);
          }
        } else {
          // Restore parent -> restore children that were auto-hidden with it.
          const m = loadHiddenChildrenByParent();
          const prev = Array.isArray(m[key]) ? m[key] : [];
          const nowKids = new Set(_subagentChildrenKeys(key));
          for (const ck0 of prev) {
            const ck = String(ck0 || "").trim();
            if (!ck) continue;
            if (!nowKids.has(ck)) continue;
            if (state.hiddenThreads.has(ck)) state.hiddenThreads.delete(ck);
          }
          try { delete m[key]; } catch (_) {}
          saveHiddenChildrenByParent(m);
        }
      } catch (_) {}

      saveHiddenThreads(state.hiddenThreads);
      toastBtn(dom.hideThreadBtn, was ? "已取消隐藏" : "已隐藏会话");
      // If we just hid the current session and hidden items are not shown, jump to "all" to avoid “消失”困惑。
      if (!was && !state.showHiddenThreads) {
        await onSelectKey("all");
      } else {
        try { renderTabs(); } catch (_) {}
      }
      syncButtons();
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
}
