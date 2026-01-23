import { getExportPrefsForKey, setExportPrefsForKey } from "../../export_prefs.js";

const clamp = (n, a, b) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.min(b, Math.max(a, x));
};

export function createExportPrefsPanel(dom, state, deps = {}) {
  const d = (deps && typeof deps === "object") ? deps : {};
  const toastFromEl = typeof d.toastFromEl === "function" ? d.toastFromEl : (() => {});
  const openPopupNearEl = typeof d.openPopupNearEl === "function" ? d.openPopupNearEl : (() => false);
  const renderBookmarkDrawerList = typeof d.renderBookmarkDrawerList === "function" ? d.renderBookmarkDrawerList : (() => {});
  const clampFn = typeof d.clamp === "function" ? d.clamp : clamp;

  let exportPrefsKey = "";

  const sanitizeKey = (v) => {
    const s = String(v || "").trim();
    return (!s || s === "all") ? "" : s;
  };

  const exportPrefsText = (p) => `${p && p.quick ? "精简" : "全量"} · ${p && p.translate ? "译文" : "原文"}`;

  const syncExportPrefsPanel = (key, silent = true) => {
    const k = sanitizeKey(key) || sanitizeKey(exportPrefsKey) || sanitizeKey(state && state.currentKey);
    const dlg = dom && dom.exportPrefsDialog ? dom.exportPrefsDialog : null;
    if (!dlg) return null;
    if (!k) return null;
    exportPrefsKey = k;
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
      try { toastFromEl(dlg, `导出：${exportPrefsText(p)}`, { durationMs: 1400 }); } catch (_) {}
    }
    return p;
  };

  const openExportPrefsPanel = (key, anchorEl = null) => {
    const p = syncExportPrefsPanel(key, true);
    const dlg = dom && dom.exportPrefsDialog ? dom.exportPrefsDialog : null;
    const ok = openPopupNearEl(dlg, anchorEl, { prefer: "left", align: "end", gap: 10, pad: 12 });
    if (ok) {
      // 让“导出设置”弹层与会话管理抽屉对齐，同时避免遮挡导出按钮：
      // - 默认左边框对齐抽屉左边框；
      // - 若会遮挡导出按钮，则改为右边框对齐导出按钮左边缘。
      try {
        const drawer = dom && dom.bookmarkDrawer ? dom.bookmarkDrawer : null;
        const anchor = anchorEl && anchorEl.getBoundingClientRect ? anchorEl : null;
        if (!anchor) throw new Error("no_anchor");
        const ar = anchor.getBoundingClientRect();
        const pr = dlg.getBoundingClientRect();
        const vw = window.innerWidth || 0;
        const pad = 12;
        let left = Number.isFinite(ar.left) ? (ar.left - pr.width) : 0;
        try {
          if (drawer && drawer.getBoundingClientRect && drawer.classList && !drawer.classList.contains("hidden")) {
            const dr = drawer.getBoundingClientRect();
            // Prefer drawer-left alignment when it won't cover the export button.
            const drawerLeft = Number.isFinite(dr.left) ? dr.left : left;
            if ((drawerLeft + pr.width) <= ar.left) left = drawerLeft;
          }
        } catch (_) {}
        left = clampFn(left, pad, Math.max(pad, vw - pr.width - pad));
        try { dlg.style.left = `${left}px`; } catch (_) {}
      } catch (_) {}
      try {
        setTimeout(() => {
          try { if (dom.exportPrefsQuickBtn && typeof dom.exportPrefsQuickBtn.focus === "function") dom.exportPrefsQuickBtn.focus(); } catch (_) {}
        }, 0);
      } catch (_) {}
    }
    return p;
  };

  const wireExportPrefsPanel = () => {
    const quickBtn = dom && dom.exportPrefsQuickBtn ? dom.exportPrefsQuickBtn : null;
    const trBtn = dom && dom.exportPrefsTranslateBtn ? dom.exportPrefsTranslateBtn : null;
    if (!quickBtn && !trBtn) return;
    const apply = (next) => {
      const k = sanitizeKey(exportPrefsKey) || sanitizeKey(state && state.currentKey);
      if (!k) return;
      setExportPrefsForKey(k, next);
      syncExportPrefsPanel(k, true);
      try { renderBookmarkDrawerList(); } catch (_) {}
    };
    try {
      if (quickBtn) quickBtn.addEventListener("click", () => {
        const k = sanitizeKey(exportPrefsKey) || sanitizeKey(state && state.currentKey);
        const cur = getExportPrefsForKey(k);
        apply({ quick: !cur.quick, translate: !!cur.translate });
      });
    } catch (_) {}
    try {
      if (trBtn) trBtn.addEventListener("click", () => {
        const k = sanitizeKey(exportPrefsKey) || sanitizeKey(state && state.currentKey);
        const cur = getExportPrefsForKey(k);
        apply({ quick: !!cur.quick, translate: !cur.translate });
      });
    } catch (_) {}

    try { syncExportPrefsPanel(state && state.currentKey, true); } catch (_) {}
  };

  wireExportPrefsPanel();

  return {
    syncExportPrefsPanel,
    openExportPrefsPanel,
  };
}

