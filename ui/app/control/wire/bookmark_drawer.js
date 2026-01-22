import { closeBookmarkDrawer, confirmDialog, openBookmarkDrawer } from "../ui.js";
import { copyToClipboard } from "../../utils/clipboard.js";
import { colorForKey, rolloutStampFromFile, shortId } from "../../utils.js";
import { getExportPrefsForKey } from "../../export_prefs.js";
import { exportThreadMarkdown } from "../../export.js";
import { getCustomLabel, setCustomLabel } from "../../sidebar/labels.js";
import { saveClosedThreads } from "../../closed_threads.js";
import { saveHiddenThreads } from "../../sidebar/hidden.js";
import { getUnreadCount } from "../../unread.js";
import { isOfflineKey, offlineKeyFromRel } from "../../offline.js";
import { removeOfflineShowByKey, saveOfflineShowList } from "../../offline_show.js";
import { hideUiHoverTip, showUiHoverTip, toastFromEl } from "./ui_hints.js";
import { wireImportDialog } from "./import_dialog.js";

const _LS_TABS_COLLAPSED = "codex_sidecar_tabs_collapsed_v1";

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

const _syncBookmarkTabsToggle = (dom) => {
  const btn = dom && dom.bookmarkTabsToggleBtn ? dom.bookmarkTabsToggleBtn : null;
  if (!btn) return;
  const collapsed = _readSavedBool(_LS_TABS_COLLAPSED, false);
  const expanded = !collapsed;
  try { btn.setAttribute("aria-checked", expanded ? "true" : "false"); } catch (_) {}
};

export function wireBookmarkDrawer(dom, state, helpers = {}) {
  const h = (helpers && typeof helpers === "object") ? helpers : {};
  const onSelectKey = typeof h.onSelectKey === "function" ? h.onSelectKey : (async () => {});
  const renderTabs = typeof h.renderTabs === "function" ? h.renderTabs : (() => {});
  const openExportPrefsPanel = typeof h.openExportPrefsPanel === "function" ? h.openExportPrefsPanel : (() => null);

  const _toastFromEl = (el, text, opts = {}) => { toastFromEl(el, text, opts); };
  const _showUiHoverTip = showUiHoverTip;
  const _hideUiHoverTip = hideUiHoverTip;

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
      if (isOfflineKey(k)) continue;
      if (k === ex) continue;
      if (hidden && typeof hidden.has === "function" && hidden.has(k)) continue;
      if (closed && typeof closed.has === "function" && closed.has(k)) continue;
      return k;
    }
    return "all";
  };

  const _renderOfflineShowList = () => {
    const host = dom && dom.offlineShowList ? dom.offlineShowList : null;
    if (!host) return;
    // 仅在抽屉打开时渲染
    if (!_isBookmarkDrawerOpen()) return;
    if (_isBookmarkDrawerEditing()) return;

    const list = Array.isArray(state && state.offlineShow) ? state.offlineShow : [];
    try { if (dom && dom.offlineShowCount) dom.offlineShowCount.textContent = String(list.length || 0); } catch (_) {}

    try { host.replaceChildren(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
    const frag = document.createDocumentFragment();

    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.style.opacity = "0.7";
      empty.style.padding = "6px 2px";
      empty.textContent = "暂无展示会话（点击右侧“导入对话”加入）";
      frag.appendChild(empty);
      host.appendChild(frag);
      return;
    }

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

    for (const it of list) {
      if (!it || typeof it !== "object") continue;
      const rel = String(it.rel || "").trim();
      const key = String(it.key || offlineKeyFromRel(rel)).trim();
      if (!rel || !key) continue;
      const file = String(it.file || "").trim();
      const tid = String(it.thread_id || "").trim();

      const tmeta = { key, thread_id: tid, file: file || rel };
      const defaultLabel = _threadDefaultLabel(tmeta);
      const labelText = getCustomLabel(key) || defaultLabel;

      const row = document.createElement("div");
      row.className = "tab" + (String(state.currentKey || "all") === key ? " active" : "");
      row.dataset.key = key;
      row.dataset.rel = rel;
      row.dataset.file = file;
      row.dataset.threadId = tid;
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      try { row.removeAttribute("title"); } catch (_) {}

      const dot = document.createElement("span");
      dot.className = "tab-dot";
      try { dot.style.background = String(colorForKey(key).fg || "#64748b"); } catch (_) {}

      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = labelText;

      const input = document.createElement("input");
      input.className = "tab-edit";
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = labelText;

      const main = document.createElement("div");
      main.className = "tab-main";
      main.appendChild(label);
      main.appendChild(input);

      const actions = document.createElement("div");
      actions.className = "tab-actions";

      const renameBtn = document.createElement("button");
      renameBtn.className = "mini-btn";
      renameBtn.type = "button";
      renameBtn.dataset.action = "rename";
      renameBtn.setAttribute("aria-label", "重命名");
      try { renameBtn.removeAttribute("title"); } catch (_) {}
      renameBtn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-edit"></use></svg>`;

      const exportBtn = document.createElement("button");
      exportBtn.className = "mini-btn";
      exportBtn.type = "button";
      exportBtn.dataset.action = "export";
      try {
        const p = getExportPrefsForKey(key);
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

      // Long-press: open export prefs panel (same as live list).
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
            try { openExportPrefsPanel(key, exportBtn); } catch (_) {}
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

      const removeBtn = document.createElement("button");
      removeBtn.className = "mini-btn danger";
      removeBtn.type = "button";
      removeBtn.dataset.action = "removeShow";
      removeBtn.setAttribute("aria-label", "移除展示");
      try { removeBtn.removeAttribute("title"); } catch (_) {}
      removeBtn.innerHTML = `<svg class="ico" aria-hidden="true"><use href="#i-trash"></use></svg>`;

      actions.appendChild(renameBtn);
      actions.appendChild(exportBtn);
      actions.appendChild(removeBtn);

      row.appendChild(dot);
      row.appendChild(main);
      row.appendChild(actions);
      frag.appendChild(row);

      // Hover hint (only when hovering the left area; hovering action buttons should not trigger).
      try {
        const filePath = String(file || "").trim();
        if (filePath) {
          let tracking = false;
          const hintText = "长按复制源json路径";
          const update = (e) => {
            if (!tracking) return;
            if (row.classList && row.classList.contains("editing")) return;
            _showUiHoverTip(row, hintText, { insetX: 10, gap: 6, pad: 10, prefer: "below" });
          };
          main.addEventListener("pointerenter", (e) => { if (!canHoverTip(e)) return; tracking = true; update(e); });
          main.addEventListener("pointermove", update);
          main.addEventListener("pointerleave", (e) => { if (!canHoverTip(e)) return; tracking = false; _hideUiHoverTip(); });
        }
      } catch (_) {}

      // Long-press: copy JSON source path.
      try {
        const filePath = String(file || "").trim();
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
            try { if (e && typeof e.button === "number" && e.button !== 0) return; } catch (_) {}
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
              try { _hideUiHoverTip(); } catch (_) {}
              copyToClipboard(filePath)
                .then(() => { try { _toastFromEl(row, "已复制源json路径", { durationMs: 1200 }); } catch (_) {} })
                .catch(() => { try { _toastFromEl(row, "复制失败", { durationMs: 1200 }); } catch (_) {} });
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

    host.appendChild(frag);
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
        if (isOfflineKey(key)) continue;
        if (closed && typeof closed.has === "function" && closed.has(key)) continue;
        const label0 = _threadLabel(t);
        const label = label0;
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
              try { openExportPrefsPanel(String(it.key || ""), exportBtn); } catch (_) {}
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
            const hintText = "长按复制源json路径";
            const update = (e) => {
              if (!tracking) return;
              if (row.classList && row.classList.contains("editing")) return;
              _showUiHoverTip(row, hintText, { insetX: 10, gap: 6, pad: 10, prefer: "below" });
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
                try { _hideUiHoverTip(); } catch (_) {}
                copyToClipboard(filePath)
                  .then(() => { try { _toastFromEl(row, "已复制源json路径", { durationMs: 1200 }); } catch (_) {} })
                  .catch(() => { try { _toastFromEl(row, "复制失败", { durationMs: 1200 }); } catch (_) {} });
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
      if (dom.bookmarkCount) dom.bookmarkCount.textContent = String(items.length);
      if (dom.bookmarkHiddenCount) dom.bookmarkHiddenCount.textContent = String(hiddenItems.length);
      if (dom.bookmarkHiddenDetails) {
        dom.bookmarkHiddenDetails.style.display = hiddenItems.length ? "" : "none";
      }
    } catch (_) {}

    // 离线“展示中”（固定列表）
    try { _renderOfflineShowList(); } catch (_) {}
  };

  // 导入对话（离线展示入口）
  wireImportDialog(dom, state, { onSelectKey, renderTabs }, { renderBookmarkDrawerList: _renderBookmarkDrawerList });

  const _openBookmarkDrawer = () => {
    openBookmarkDrawer(dom);
    _syncBookmarkTabsToggle(dom);
    _renderBookmarkDrawerList();
  };

  // 标签页栏收起状态（由会话管理内开关切换）
  _applyTabsCollapsedLocal(_readSavedBool(_LS_TABS_COLLAPSED, false));
  _syncBookmarkTabsToggle(dom);

  if (dom && dom.bookmarkDrawerToggleBtn) {
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

  if (dom && dom.bookmarkTabsToggleBtn) {
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
      _syncBookmarkTabsToggle(dom);
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
      _syncBookmarkTabsToggle(dom);
    });
    btn.addEventListener("pointerleave", () => {
      if (capturedPid != null) return;
      pressed = false;
      moved = false;
      _syncBookmarkTabsToggle(dom);
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

  if (dom && dom.bookmarkDrawerOverlay) dom.bookmarkDrawerOverlay.addEventListener("click", () => { closeBookmarkDrawer(dom); });
  if (dom && dom.bookmarkDrawerCloseBtn) dom.bookmarkDrawerCloseBtn.addEventListener("click", () => { closeBookmarkDrawer(dom); });

  const _enterInlineRename = (row, key, opts = {}) => {
    const k = String(key || "");
    if (!row || !k) return;
    if (_bookmarkDrawerEditingKey && _bookmarkDrawerEditingKey !== k) return;
    const input = row.querySelector ? row.querySelector("input.tab-edit") : null;
    const labelEl = row.querySelector ? row.querySelector(".tab-label") : null;
    if (!input || !labelEl) return;
    const o = (opts && typeof opts === "object") ? opts : {};
    const defaultLabel = String(o.defaultLabel || "").trim();
    _bookmarkDrawerEditingKey = k;
    try { row.classList.add("editing"); } catch (_) {}

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      const t = state.threadIndex.get(k) || { key: k, thread_id: "", file: "" };
      const def = defaultLabel || _threadDefaultLabel(t);
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
      const cur = getCustomLabel(k) || defaultLabel || _threadDefaultLabel(state.threadIndex.get(k) || {});
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
        try { btn.disabled = true; } catch (_) {}
        _toastFromEl(btn, "导出中…", { durationMs: 1400 });
        let r = null;
        try {
          r = await exportThreadMarkdown(state, key, { mode, reasoningLang });
        } catch (_) {
          r = null;
        }
        if (r && r.ok) _toastFromEl(btn, "已导出");
        else if (r && r.error === "export_in_flight") _toastFromEl(btn, "已有导出在进行中", { durationMs: 1400 });
        else _toastFromEl(btn, "导出失败", { durationMs: 1400 });
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
        _toastFromEl(btn, "已清除（有新输出或重启后会自动回来）");
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

  const _handleOfflineShowListClick = async (e) => {
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
        const def = _threadDefaultLabel({ key, thread_id: tid, file: file || rel });
        _enterInlineRename(row, key, { defaultLabel: def });
        return;
      }
      if (action === "export") {
        const p = getExportPrefsForKey(key);
        const mode = p.quick ? "quick" : "full";
        const reasoningLang = p.translate ? "zh" : "en";
        try { btn.disabled = true; } catch (_) {}
        _toastFromEl(btn, "导出中…", { durationMs: 1400 });
        let r = null;
        try {
          r = await exportThreadMarkdown(state, key, { mode, reasoningLang });
        } catch (_) {
          r = null;
        }
        if (r && r.ok) _toastFromEl(btn, "已导出");
        else if (r && r.error === "export_in_flight") _toastFromEl(btn, "已有导出在进行中", { durationMs: 1400 });
        else _toastFromEl(btn, "导出失败", { durationMs: 1400 });
        try { btn.disabled = false; } catch (_) {}
        return;
      }
      if (action === "removeShow") {
        const next = removeOfflineShowByKey(state.offlineShow, key);
        try { state.offlineShow = next; } catch (_) {}
        try { saveOfflineShowList(next); } catch (_) {}
        try { renderTabs(); } catch (_) {}
        _renderBookmarkDrawerList();
        if (String(state.currentKey || "all") === key) {
          let pick = "";
          try { pick = String(next && next[0] && next[0].key ? next[0].key : ""); } catch (_) { pick = ""; }
          if (!pick) pick = _pickFallbackKey(key);
          await onSelectKey(pick || "all");
        }
        return;
      }
      return;
    }

    await onSelectKey(key);
    closeBookmarkDrawer(dom);
  };

  const _handleOfflineShowListKeydown = async (e) => {
    if (!e) return;
    const keyName = String(e.key || "");
    if (keyName !== "Enter" && keyName !== " ") return;
    const row = e.target && e.target.closest ? e.target.closest(".tab[data-key]") : null;
    const key = row && row.dataset ? String(row.dataset.key || "") : "";
    if (!row || !key) return;
    try { e.preventDefault(); } catch (_) {}
    await _handleOfflineShowListClick({ target: row });
  };

  if (dom && dom.bookmarkList) dom.bookmarkList.addEventListener("click", async (e) => { try { await _handleBookmarkListClick(e); } catch (_) {} });
  if (dom && dom.bookmarkHiddenList) dom.bookmarkHiddenList.addEventListener("click", async (e) => { try { await _handleBookmarkListClick(e); } catch (_) {} });
  if (dom && dom.bookmarkList) dom.bookmarkList.addEventListener("keydown", async (e) => { try { await _handleBookmarkListKeydown(e); } catch (_) {} });
  if (dom && dom.bookmarkHiddenList) dom.bookmarkHiddenList.addEventListener("keydown", async (e) => { try { await _handleBookmarkListKeydown(e); } catch (_) {} });
  if (dom && dom.offlineShowList) dom.offlineShowList.addEventListener("click", async (e) => { try { await _handleOfflineShowListClick(e); } catch (_) {} });
  if (dom && dom.offlineShowList) dom.offlineShowList.addEventListener("keydown", async (e) => { try { await _handleOfflineShowListKeydown(e); } catch (_) {} });

  // offline-show-changed：用于同步“展示中”列表（例如从展示标签栏关闭时）。
  try {
    window.addEventListener("offline-show-changed", () => {
      try { _renderBookmarkDrawerList(); } catch (_) {}
    });
  } catch (_) {}

  return {
    renderBookmarkDrawerList: _renderBookmarkDrawerList,
    openBookmarkDrawer: _openBookmarkDrawer,
    isBookmarkDrawerOpen: _isBookmarkDrawerOpen,
  };
}

