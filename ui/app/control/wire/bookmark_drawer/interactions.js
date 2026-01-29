import { closeBookmarkDrawer, confirmDialog } from "../../ui.js";
import { exportThreadMarkdown } from "../../../export.js";
import { getExportPrefsForKey } from "../../../export_prefs.js";
import { getCustomLabel, setCustomLabel } from "../../../sidebar/labels.js";
import { saveClosedThreads } from "../../../closed_threads.js";
import { loadHiddenChildrenByParent, saveHiddenChildrenByParent, saveHiddenThreads } from "../../../sidebar/hidden.js";
import { removeOfflineShowByKey, saveOfflineShowList } from "../../../offline_show.js";

export function wireBookmarkDrawerInteractions(dom, state, helpers = {}) {
  const h = (helpers && typeof helpers === "object") ? helpers : {};
  const onSelectKey = typeof h.onSelectKey === "function" ? h.onSelectKey : (async () => {});
  const renderTabs = typeof h.renderTabs === "function" ? h.renderTabs : (() => {});
  const renderBookmarkDrawerList = typeof h.renderBookmarkDrawerList === "function" ? h.renderBookmarkDrawerList : (() => {});
  const toggleSubagents = typeof h.toggleSubagents === "function" ? h.toggleSubagents : (() => false);
  const threadDefaultLabel = typeof h.threadDefaultLabel === "function" ? h.threadDefaultLabel : (() => "unknown");
  const pickFallbackKey = typeof h.pickFallbackKey === "function" ? h.pickFallbackKey : (() => "all");
  const ensureHiddenSet = typeof h.ensureHiddenSet === "function" ? h.ensureHiddenSet : (() => (state.hiddenThreads = (state.hiddenThreads || new Set())));
  const toastFromEl = typeof h.toastFromEl === "function" ? h.toastFromEl : (() => {});

  let bookmarkDrawerEditingKey = "";

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

  const _isSubagentOfHiddenParent = (key) => {
    const k = String(key || "").trim();
    if (!k || k === "all") return false;
    try {
      const t = state && state.threadIndex && typeof state.threadIndex.get === "function" ? state.threadIndex.get(k) : null;
      const pid = String(t && t.parent_thread_id ? t.parent_thread_id : "").trim();
      const sk = String(t && t.source_kind ? t.source_kind : "").trim().toLowerCase();
      if (!pid || sk !== "subagent") return false;
      return !!(state && state.hiddenThreads && typeof state.hiddenThreads.has === "function" && state.hiddenThreads.has(pid));
    } catch (_) {
      return false;
    }
  };

  const _autoHideChildrenForParent = (parentKey, hiddenSet) => {
    const pk = String(parentKey || "").trim();
    if (!pk || pk === "all") return { added: [], map: null };
    const hidden = hiddenSet && typeof hiddenSet.add === "function" ? hiddenSet : ensureHiddenSet();
    const kids = _subagentChildrenKeys(pk);
    if (!kids.length) return { added: [], map: null };
    const m = loadHiddenChildrenByParent();
    const added = [];
    for (const ck of kids) {
      if (hidden.has(ck)) continue;
      hidden.add(ck);
      added.push(ck);
    }
    if (added.length) {
      const prev = Array.isArray(m[pk]) ? m[pk] : [];
      const next = new Set(prev);
      for (const x of added) next.add(String(x || "").trim());
      m[pk] = Array.from(next).filter(Boolean).slice(0, 200);
      saveHiddenChildrenByParent(m);
      return { added, map: m };
    }
    return { added: [], map: m };
  };

  const _autoRestoreChildrenForParent = (parentKey, hiddenSet) => {
    const pk = String(parentKey || "").trim();
    if (!pk || pk === "all") return false;
    const hidden = hiddenSet && typeof hiddenSet.delete === "function" ? hiddenSet : ensureHiddenSet();
    const m = loadHiddenChildrenByParent();
    const prev = Array.isArray(m[pk]) ? m[pk] : [];
    if (!prev.length) return false;
    const nowKids = new Set(_subagentChildrenKeys(pk));
    for (const ck0 of prev) {
      const ck = String(ck0 || "").trim();
      if (!ck) continue;
      if (!nowKids.has(ck)) continue;
      if (hidden.has(ck)) hidden.delete(ck);
    }
    try { delete m[pk]; } catch (_) {}
    saveHiddenChildrenByParent(m);
    return true;
  };

  const enterInlineRename = (row, key, opts = {}) => {
    const k = String(key || "");
    if (!row || !k) return;
    if (bookmarkDrawerEditingKey && bookmarkDrawerEditingKey !== k) return;
    const input = row.querySelector ? row.querySelector("input.tab-edit") : null;
    const labelEl = row.querySelector ? row.querySelector(".tab-label") : null;
    if (!input || !labelEl) return;
    const o = (opts && typeof opts === "object") ? opts : {};
    const defaultLabel = String(o.defaultLabel || "").trim();
    bookmarkDrawerEditingKey = k;
    try { row.classList.add("editing"); } catch (_) {}

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const t = state.threadIndex.get(k) || { key: k, thread_id: "", file: "" };
      const def = defaultLabel || threadDefaultLabel(t);
      const raw = String(input.value || "");
      const v = raw.trim();
      if (commit) setCustomLabel(k, v);
      const nextLabel = getCustomLabel(k) || def;
      try { labelEl.textContent = nextLabel; } catch (_) {}
      try { input.value = nextLabel; } catch (_) {}
      try { row.classList.remove("editing"); } catch (_) {}
      bookmarkDrawerEditingKey = "";
      try { renderTabs(); } catch (_) {}
      if (commit) toastFromEl(input, v ? "已重命名" : "已恢复默认名");
    };

    input.onkeydown = (e) => {
      const kk = String(e && e.key ? e.key : "");
      if (kk === "Enter") { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} finish(true); }
      if (kk === "Escape") { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} finish(false); }
    };
    input.onblur = () => finish(true);

    try {
      const cur = getCustomLabel(k) || defaultLabel || threadDefaultLabel(state.threadIndex.get(k) || {});
      input.value = cur;
      setTimeout(() => { try { input.focus(); input.select(); } catch (_) {} }, 0);
    } catch (_) {}
  };

  const handleBookmarkListClick = async (e) => {
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
      if (action === "toggleSubagents") {
        try { toggleSubagents(key); } catch (_) {}
        renderBookmarkDrawerList();
        return;
      }
      if (action === "subagent") {
        const subKey = String(btn.dataset.subkey || "").trim();
        if (!subKey) return;
        try {
          const hidden = ensureHiddenSet();
          if (hidden && hidden.has(subKey)) {
            hidden.delete(subKey);
            saveHiddenThreads(hidden);
            try { renderTabs(); } catch (_) {}
            renderBookmarkDrawerList();
          }
        } catch (_) {}
        await onSelectKey(subKey);
        closeBookmarkDrawer(dom);
        return;
      }
      if (action === "rename") {
        try {
          const t = state && state.threadIndex && typeof state.threadIndex.get === "function" ? state.threadIndex.get(key) : null;
          const pid = String((t && t.parent_thread_id) ? t.parent_thread_id : "").trim();
          const sk = String((t && t.source_kind) ? t.source_kind : "").trim().toLowerCase();
          if (pid && sk === "subagent") {
            toastFromEl(btn, "子代理名称随主会话自动生成");
            return;
          }
        } catch (_) {}
        const def = row && row.dataset ? String(row.dataset.defaultLabel || "") : "";
        enterInlineRename(row, key, { defaultLabel: def });
        return;
      }
      if (action === "export") {
        const p = getExportPrefsForKey(key);
        const mode = p.quick ? "quick" : "full";
        const reasoningLang = p.translate ? "zh" : "en";
        try { btn.disabled = true; } catch (_) {}
        toastFromEl(btn, "导出中…", { durationMs: 1400 });
        let r = null;
        try {
          r = await exportThreadMarkdown(state, key, { mode, reasoningLang });
        } catch (_) {
          r = null;
        }
        if (r && r.ok) toastFromEl(btn, "已导出");
        else if (r && r.error === "export_in_flight") toastFromEl(btn, "已有导出在进行中", { durationMs: 1400 });
        else toastFromEl(btn, "导出失败", { durationMs: 1400 });
        try { btn.disabled = false; } catch (_) {}
        return;
      }
      if (action === "delete") {
        const labelText = row && row.dataset ? String(row.dataset.label || "") : "";
        const ok = await confirmDialog(dom, {
          title: "清除该会话？",
          desc: `将从会话列表清除：${labelText || key}\n（不会删除原始会话文件；有新输出或重启后会自动回来）`,
          confirmText: "清除",
          cancelText: "取消",
          danger: true,
        });
        if (!ok) return;
        // “清除对话”仅用于清理僵尸会话：不应永久落入“已关闭监听”。
        try {
          const hidden = ensureHiddenSet();
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
        toastFromEl(btn, "已清除（有新输出或重启后会自动回来）");
        try { renderTabs(); } catch (_) {}
        renderBookmarkDrawerList();
        if (String(state.currentKey || "all") === key) {
          await onSelectKey("all");
        }
        return;
      }
      if (action === "listenOff") {
        const hidden = ensureHiddenSet();
        if (!hidden.has(key)) hidden.add(key);
        try { _autoHideChildrenForParent(key, hidden); } catch (_) {}
        saveHiddenThreads(hidden);
        try { renderTabs(); } catch (_) {}
        renderBookmarkDrawerList();
        if (String(state.currentKey || "all") === key) {
          await onSelectKey(pickFallbackKey(key));
        }
        return;
      }
      if (action === "listenOn") {
        if (_isSubagentOfHiddenParent(key)) {
          toastFromEl(btn, "主会话已关闭监听");
          return;
        }
        const hidden = ensureHiddenSet();
        if (hidden.has(key)) hidden.delete(key);
        try { _autoRestoreChildrenForParent(key, hidden); } catch (_) {}
        saveHiddenThreads(hidden);
        try { renderTabs(); } catch (_) {}
        renderBookmarkDrawerList();
        return;
      }
      if (action === "remove") {
        const hidden = ensureHiddenSet();
        if (!hidden.has(key)) hidden.add(key);
        try { _autoHideChildrenForParent(key, hidden); } catch (_) {}
        saveHiddenThreads(hidden);
        try { renderTabs(); } catch (_) {}
        renderBookmarkDrawerList();
        if (String(state.currentKey || "all") === key) {
          await onSelectKey(pickFallbackKey(key));
        }
        return;
      }
      if (action === "restore") {
        if (_isSubagentOfHiddenParent(key)) {
          toastFromEl(btn, "主会话已关闭监听");
          return;
        }
        const hidden = ensureHiddenSet();
        if (hidden.has(key)) hidden.delete(key);
        try { _autoRestoreChildrenForParent(key, hidden); } catch (_) {}
        saveHiddenThreads(hidden);
        try { renderTabs(); } catch (_) {}
        renderBookmarkDrawerList();
        return;
      }
      return;
    }

    // 点击条目：切换会话（若来自“已移除”，则先恢复）
    if (isHiddenRow) {
      if (_isSubagentOfHiddenParent(key)) {
        toastFromEl(row, "主会话已关闭监听");
        return;
      }
      const hidden = ensureHiddenSet();
      if (hidden.has(key)) hidden.delete(key);
      try { _autoRestoreChildrenForParent(key, hidden); } catch (_) {}
      saveHiddenThreads(hidden);
      try { renderTabs(); } catch (_) {}
      renderBookmarkDrawerList();
    }
    await onSelectKey(key);
    closeBookmarkDrawer(dom);
  };

  const handleBookmarkListKeydown = async (e) => {
    if (!e) return;
    const keyName = String(e.key || "");
    if (keyName !== "Enter" && keyName !== " ") return;
    const row = e.target && e.target.closest ? e.target.closest(".tab[data-key]") : null;
    const key = row && row.dataset ? String(row.dataset.key || "") : "";
    if (!row || !key) return;
    try { e.preventDefault(); } catch (_) {}
    await handleBookmarkListClick({ target: row });
  };

  const handleOfflineShowListClick = async (e) => {
    const btn = e && e.target && e.target.closest ? e.target.closest("button[data-action]") : null;
    const row = e && e.target && e.target.closest ? e.target.closest(".tab[data-key]") : null;
    const key = row && row.dataset ? String(row.dataset.key || "") : "";
    if (!row || !key) return;
    if (row.classList && row.classList.contains("editing")) return;
    try {
      const lp = row.dataset ? Number(row.dataset.lp || 0) : 0;
      if (lp && (Date.now() - lp) < 900) return;
    } catch (_) {}

    if (btn && btn.dataset) {
      const action = String(btn.dataset.action || "");
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      if (action === "rename") {
        const rel = row.dataset ? String(row.dataset.rel || "") : "";
        const file = row.dataset ? String(row.dataset.file || "") : "";
        const tid = row.dataset ? String(row.dataset.threadId || "") : "";
        const def = threadDefaultLabel({ key, thread_id: tid, file: file || rel });
        enterInlineRename(row, key, { defaultLabel: def });
        return;
      }
      if (action === "export") {
        const p = getExportPrefsForKey(key);
        const mode = p.quick ? "quick" : "full";
        const reasoningLang = p.translate ? "zh" : "en";
        try { btn.disabled = true; } catch (_) {}
        toastFromEl(btn, "导出中…", { durationMs: 1400 });
        let r = null;
        try {
          r = await exportThreadMarkdown(state, key, { mode, reasoningLang });
        } catch (_) {
          r = null;
        }
        if (r && r.ok) toastFromEl(btn, "已导出");
        else if (r && r.error === "export_in_flight") toastFromEl(btn, "已有导出在进行中", { durationMs: 1400 });
        else toastFromEl(btn, "导出失败", { durationMs: 1400 });
        try { btn.disabled = false; } catch (_) {}
        return;
      }
      if (action === "removeShow") {
        const next = removeOfflineShowByKey(state.offlineShow, key);
        try { state.offlineShow = next; } catch (_) {}
        try { saveOfflineShowList(next); } catch (_) {}
        try { renderTabs(); } catch (_) {}
        renderBookmarkDrawerList();
        if (String(state.currentKey || "all") === key) {
          let pick = "";
          try { pick = String(next && next[0] && next[0].key ? next[0].key : ""); } catch (_) { pick = ""; }
          if (!pick) pick = pickFallbackKey(key);
          await onSelectKey(pick || "all");
        }
        return;
      }
      return;
    }

    await onSelectKey(key);
    closeBookmarkDrawer(dom);
  };

  const handleOfflineShowListKeydown = async (e) => {
    if (!e) return;
    const keyName = String(e.key || "");
    if (keyName !== "Enter" && keyName !== " ") return;
    const row = e.target && e.target.closest ? e.target.closest(".tab[data-key]") : null;
    const key = row && row.dataset ? String(row.dataset.key || "") : "";
    if (!row || !key) return;
    try { e.preventDefault(); } catch (_) {}
    await handleOfflineShowListClick({ target: row });
  };

  if (dom && dom.bookmarkList) dom.bookmarkList.addEventListener("click", async (e) => { try { await handleBookmarkListClick(e); } catch (_) {} });
  if (dom && dom.bookmarkHiddenList) dom.bookmarkHiddenList.addEventListener("click", async (e) => { try { await handleBookmarkListClick(e); } catch (_) {} });
  if (dom && dom.bookmarkList) dom.bookmarkList.addEventListener("keydown", async (e) => { try { await handleBookmarkListKeydown(e); } catch (_) {} });
  if (dom && dom.bookmarkHiddenList) dom.bookmarkHiddenList.addEventListener("keydown", async (e) => { try { await handleBookmarkListKeydown(e); } catch (_) {} });
  if (dom && dom.offlineShowList) dom.offlineShowList.addEventListener("click", async (e) => { try { await handleOfflineShowListClick(e); } catch (_) {} });
  if (dom && dom.offlineShowList) dom.offlineShowList.addEventListener("keydown", async (e) => { try { await handleOfflineShowListKeydown(e); } catch (_) {} });

  // offline-show-changed：用于同步“展示中”列表（例如从展示标签栏关闭时）。
  try {
    window.addEventListener("offline-show-changed", () => {
      try { renderBookmarkDrawerList(); } catch (_) {}
    });
  } catch (_) {}
}
