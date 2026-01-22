import { closeBookmarkDrawer, openBookmarkDrawer } from "../ui.js";
import { copyToClipboard } from "../../utils/clipboard.js";
import { colorForKey, rolloutStampFromFile, shortId } from "../../utils.js";
import { getExportPrefsForKey } from "../../export_prefs.js";
import { getCustomLabel } from "../../sidebar/labels.js";
import { getUnreadCount } from "../../unread.js";
import { isOfflineKey, offlineKeyFromRel } from "../../offline.js";
import { hideUiHoverTip, showUiHoverTip, toastFromEl } from "./ui_hints.js";
import { wireImportDialog } from "./import_dialog.js";
import { wireBookmarkDrawerInteractions } from "./bookmark_drawer/interactions.js";

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

  wireBookmarkDrawerInteractions(dom, state, {
    onSelectKey,
    renderTabs,
    renderBookmarkDrawerList: _renderBookmarkDrawerList,
    threadDefaultLabel: _threadDefaultLabel,
    pickFallbackKey: _pickFallbackKey,
    ensureHiddenSet: _ensureHiddenSet,
    toastFromEl: _toastFromEl,
  });

  return {
    renderBookmarkDrawerList: _renderBookmarkDrawerList,
    openBookmarkDrawer: _openBookmarkDrawer,
    isBookmarkDrawerOpen: _isBookmarkDrawerOpen,
  };
}
