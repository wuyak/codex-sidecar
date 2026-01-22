import { closeBookmarkDrawer, closeDrawer, closeTranslateDrawer } from "../ui.js";
import { colorForKey, rolloutStampFromFile, shortId } from "../../utils.js";
import { offlineKeyFromRel } from "../../offline.js";
import { openPopupNearEl } from "./ui_hints.js";
import { buildImportIndex } from "./import_dialog/import_index.js";
import { createOpenOfflineRel } from "./import_dialog/open_offline_rel.js";

export function wireImportDialog(dom, state, helpers, opts = {}) {
  const h = (helpers && typeof helpers === "object") ? helpers : {};
  const onSelectKey = typeof h.onSelectKey === "function" ? h.onSelectKey : (async () => {});
  const renderTabs = typeof h.renderTabs === "function" ? h.renderTabs : (() => {});
  const renderBookmarkDrawerList = typeof opts.renderBookmarkDrawerList === "function"
    ? opts.renderBookmarkDrawerList
    : (() => {});

  let importDatepicker = null;
  let importIndex = null;
  let importUi = null;

  const destroyImportDatepicker = () => {
    try { if (importDatepicker && typeof importDatepicker.destroy === "function") importDatepicker.destroy(); } catch (_) {}
    importDatepicker = null;
  };

  const pad2 = (n) => String(Math.max(0, Number(n) || 0)).padStart(2, "0");
  const toYmd = (dt) => {
    try {
      if (!(dt instanceof Date)) return "";
      const t = dt.getTime();
      if (!Number.isFinite(t)) return "";
      return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
    } catch (_) {
      return "";
    }
  };
  const fromYmd = (ymd) => {
    const s = String(ymd || "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mm) || !Number.isFinite(dd)) return null;
    if (mm < 1 || mm > 12) return null;
    if (dd < 1 || dd > 31) return null;
    const d = new Date(y, mm - 1, dd);
    if (!Number.isFinite(d.getTime())) return null;
    return d;
  };

  const formatCount = (n) => {
    const x = Math.max(0, Number(n) || 0);
    if (!x) return "";
    if (x >= 1000) return "999+";
    if (x >= 100) return "99+";
    return String(x);
  };

  const importRelFromInput = () => {
    try {
      const el = dom && dom.importRel ? dom.importRel : null;
      return el ? String(el.value || "").trim() : "";
    } catch (_) {
      return "";
    }
  };

  const setImportError = (msg) => {
    const el = dom && dom.importErrorText ? dom.importErrorText : null;
    if (!el) return;
    try { el.textContent = String(msg || "").trim(); } catch (_) {}
  };

  const isImportDialogOpen = () => {
    try { return !!(dom && dom.importDialog && dom.importDialog.open); } catch (_) { return false; }
  };

  const renderImportList = () => {
    const host = dom && dom.importList ? dom.importList : null;
    if (!host) return;
    if (!isImportDialogOpen()) return;

    destroyImportDatepicker();
    importIndex = null;
    importUi = null;

    const files = Array.isArray(state && state.offlineFiles) ? state.offlineFiles : [];

    try { host.replaceChildren(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
    const frag = document.createDocumentFragment();

    if (!files.length) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.style.opacity = "0.7";
      empty.style.padding = "6px 2px";
      const loading = !!(state && state.offlineFilesLoading);
      empty.textContent = loading ? "加载中…" : "暂无可选文件（可直接粘贴完整路径）";
      frag.appendChild(empty);
      host.appendChild(frag);
      return;
    }

    importIndex = buildImportIndex(files);
    const byDate = (importIndex && importIndex.byDate) ? importIndex.byDate : new Map();
    const countByMonth = (importIndex && importIndex.countByMonth) ? importIndex.countByMonth : new Map();
    const countByYear = (importIndex && importIndex.countByYear) ? importIndex.countByYear : new Map();
    const minDate = (importIndex && importIndex.minDate) ? importIndex.minDate : null;
    const maxDate = (importIndex && importIndex.maxDate) ? importIndex.maxDate : null;
    const other = (importIndex && Array.isArray(importIndex.other)) ? importIndex.other : [];

    const isShown = (rel) => {
      const r = String(rel || "").trim();
      if (!r) return false;
      try {
        const show = Array.isArray(state && state.offlineShow) ? state.offlineShow : [];
        for (const s of show) {
          if (!s || typeof s !== "object") continue;
          if (String(s.rel || "").trim() === r) return true;
        }
      } catch (_) {}
      return false;
    };

    const renderFileRows = (listEl, items) => {
      if (!listEl) return;
      try { listEl.replaceChildren(); } catch (_) { while (listEl.firstChild) listEl.removeChild(listEl.firstChild); }

      const arr = Array.isArray(items) ? items.slice(0) : [];
      arr.sort((a, b) => {
        const ra = String(a && a.rel ? a.rel : "");
        const rb = String(b && b.rel ? b.rel : "");
        const fa = (ra.split("/").slice(-1)[0] || "").trim();
        const fb = (rb.split("/").slice(-1)[0] || "").trim();
        if (fa && fb && fa !== fb) return fb.localeCompare(fa);
        return rb.localeCompare(ra);
      });

      for (const it of arr) {
        const rel = String((it && it.rel) ? it.rel : "").trim();
        const file = String((it && it.file) ? it.file : "").trim();
        const tid = String((it && it.thread_id) ? it.thread_id : "").trim();
        if (!rel) continue;

        const stamp = rolloutStampFromFile(file || rel);
        const idPart = tid ? shortId(tid) : shortId((file.split("/").slice(-1)[0]) || rel);
        const labelText = (stamp && idPart) ? `${stamp} · ${idPart}` : (idPart || stamp || rel);

        const row = document.createElement("div");
        row.className = "tab";
        row.dataset.rel = rel;
        row.dataset.file = file;
        row.dataset.threadId = tid;
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        try { row.removeAttribute("title"); } catch (_) {}

        const dot = document.createElement("span");
        dot.className = "tab-dot";
        try { dot.style.background = String(colorForKey(offlineKeyFromRel(rel)).fg || "#64748b"); } catch (_) {}

        const main = document.createElement("div");
        main.className = "tab-main";

        const label = document.createElement("span");
        label.className = "tab-label";
        label.textContent = labelText;

        if (isShown(rel)) {
          try {
            const mark = document.createElement("span");
            mark.className = "pill";
            mark.style.marginLeft = "8px";
            mark.textContent = "展示中";
            label.appendChild(mark);
          } catch (_) {}
        }

        main.appendChild(label);
        row.appendChild(dot);
        row.appendChild(main);
        listEl.appendChild(row);
      }
    };

    let selKey = "";
    try { selKey = String(state && state.importSelDate ? state.importSelDate : "").trim(); } catch (_) { selKey = ""; }
    if (!selKey || !byDate.has(selKey)) {
      selKey = maxDate ? toYmd(maxDate) : "";
      if (!selKey || !byDate.has(selKey)) {
        const any = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b));
        selKey = any.length ? String(any[any.length - 1] || "") : "";
      }
      try { state.importSelDate = selKey; } catch (_) {}
    }

    const root = document.createElement("div");
    root.className = "imp-import";

    const calWrap = document.createElement("div");
    calWrap.className = "imp-cal-wrap";
    const calHost = document.createElement("div");
    calHost.className = "imp-cal";
    calWrap.appendChild(calHost);
    root.appendChild(calWrap);

    const pane = document.createElement("div");
    pane.className = "imp-pane";
    const head = document.createElement("div");
    head.className = "imp-head";
    const headDate = document.createElement("span");
    headDate.className = "pill";
    headDate.textContent = selKey || "—";
    const headCount = document.createElement("span");
    headCount.className = "meta";
    headCount.style.marginLeft = "8px";
    head.appendChild(headDate);
    head.appendChild(headCount);
    pane.appendChild(head);

    const list = document.createElement("div");
    list.className = "tabs imp-files";
    pane.appendChild(list);
    root.appendChild(pane);

    if (other.length) {
      const otherLine = document.createElement("div");
      otherLine.className = "meta";
      otherLine.style.marginTop = "10px";
      otherLine.style.opacity = "0.8";
      otherLine.textContent = `其他路径（未按 sessions/YYYY/MM/DD 解析）：${other.length}`;
      root.appendChild(otherLine);
      const otherHost = document.createElement("div");
      otherHost.className = "tabs";
      renderFileRows(otherHost, other);
      root.appendChild(otherHost);
    }

    frag.appendChild(root);
    host.appendChild(frag);

    importUi = { calHost, headDate, headCount, list };

    const renderSelected = (dateKey) => {
      const items = byDate.has(dateKey) ? (byDate.get(dateKey) || []) : [];
      const n = Array.isArray(items) ? items.length : 0;
      try { headDate.textContent = dateKey || "—"; } catch (_) {}
      try { headCount.textContent = n ? `${n} 个会话文件` : "无会话文件"; } catch (_) {}
      renderFileRows(list, items);
    };

    if (!byDate.size) {
      renderSelected("");
      try { setImportError("未发现 sessions/YYYY/MM/DD 结构的 rollout 文件"); } catch (_) {}
      return;
    }

    const ADP = globalThis.AirDatepicker;
    if (typeof ADP === "function") {
      const start0 = selKey ? fromYmd(selKey) : null;
      const start = start0 || maxDate || new Date();
      const zh = {
        days: ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"],
        daysShort: ["日", "一", "二", "三", "四", "五", "六"],
        daysMin: ["日", "一", "二", "三", "四", "五", "六"],
        months: ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"],
        monthsShort: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
        today: "今天",
        clear: "清除",
        dateFormat: "yyyy-MM-dd",
        timeFormat: "HH:mm",
        firstDay: 1,
      };

      importDatepicker = new ADP(calHost, {
        inline: true,
        locale: zh,
        keyboardNav: true,
        toggleSelected: false,
        minDate: minDate || "",
        maxDate: maxDate || "",
        startDate: start,
        selectedDates: start ? [start] : [],
        navTitles: {
          days: '<span class="imp-adp-title"><span class="imp-adp-title-y">yyyy</span>年<span class="imp-adp-title-m">M</span>月</span>',
          months: '<span class="imp-adp-title"><span class="imp-adp-title-y">yyyy</span>年</span>',
          years: '<span class="imp-adp-title"><span class="imp-adp-title-y1">yyyy1</span>-<span class="imp-adp-title-y2">yyyy2</span>年</span>',
        },
        onRenderCell: ({ date, cellType }) => {
          try {
            if (!(date instanceof Date)) return {};
            const y = date.getFullYear();
            const m = pad2(date.getMonth() + 1);
            if (cellType === "day") {
              const d = pad2(date.getDate());
              const key = `${y}-${m}-${d}`;
              const items = byDate.has(key) ? (byDate.get(key) || []) : [];
              const n = Array.isArray(items) ? items.length : 0;
              const attrs = { "data-ymd": key, "aria-label": n ? `${key}（${n}个会话文件）` : `${key}（无会话文件）` };
              if (n) return { classes: "imp-adp-has", attrs: { ...attrs, "data-count": formatCount(n) } };
              return { classes: "imp-adp-empty", disabled: true, attrs };
            }
            if (cellType === "month") {
              const key = `${y}-${m}`;
              const n = Number(countByMonth.get(key) || 0) || 0;
              const attrs = { "data-ym": key, "aria-label": n ? `${y}年${Number(m)}月（${n}个会话文件）` : `${y}年${Number(m)}月（无会话文件）` };
              if (n) return { classes: "imp-adp-has", attrs: { ...attrs, "data-count": formatCount(n) } };
              return { classes: "imp-adp-empty", disabled: true, attrs };
            }
            if (cellType === "year") {
              const key = String(y);
              const n = Number(countByYear.get(key) || 0) || 0;
              const attrs = { "data-y": key, "aria-label": n ? `${y}年（${n}个会话文件）` : `${y}年（无会话文件）` };
              if (n) return { classes: "imp-adp-has", attrs: { ...attrs, "data-count": formatCount(n) } };
              return { classes: "imp-adp-empty", disabled: true, attrs };
            }
          } catch (_) {}
          return {};
        },
        onSelect: ({ date }) => {
          const key = toYmd(date);
          if (!key) return;
          try { state.importSelDate = key; } catch (_) {}
          renderSelected(key);
        },
      });

      try {
        const rootEl = calHost && calHost.querySelector ? calHost.querySelector(".air-datepicker") : null;
        const prev = rootEl && rootEl.querySelector ? rootEl.querySelector('.air-datepicker-nav--action[data-action="prev"]') : null;
        const next = rootEl && rootEl.querySelector ? rootEl.querySelector('.air-datepicker-nav--action[data-action="next"]') : null;
        if (prev) prev.setAttribute("aria-label", "上一个月");
        if (next) next.setAttribute("aria-label", "下一个月");
      } catch (_) {}

      renderSelected(selKey);
    } else {
      renderSelected(selKey);
      try { setImportError("日历组件加载失败（请刷新页面）"); } catch (_) {}
    }
  };

  let offlineFetchInFlight = false;
  const refreshOfflineFiles = async (force = false) => {
    if (offlineFetchInFlight) return;
    if (!isImportDialogOpen()) return;
    const now = Date.now();
    const last = Number(state && state.offlineFilesLastSyncMs) || 0;
    if (!force && last && (now - last) < 5000) return;
    offlineFetchInFlight = true;
    try {
      setImportError("");
      try {
        const cur = Array.isArray(state && state.offlineFiles) ? state.offlineFiles : [];
        if (!cur.length) {
          state.offlineFilesLoading = true;
          renderImportList();
        }
      } catch (_) {}
      const url = `/api/offline/files?limit=0&t=${now}`;
      const r = await fetch(url, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (!r || (r && r.ok === false)) {
        const err = String((r && r.error) ? r.error : "").trim();
        if (err === "not_found") setImportError("当前 sidecar 不支持离线导入（请重启/更新）");
        else if (err === "sessions_not_found") setImportError("未找到 sessions 目录（请检查 CODEX_HOME / watch_codex_home）");
        else setImportError("离线文件列表不可用");
        state.offlineFiles = [];
        state.offlineFilesLastSyncMs = now;
        state.offlineFilesLoading = false;
        renderImportList();
        return;
      }
      const files = Array.isArray(r.files) ? r.files : [];
      state.offlineFiles = files;
      state.offlineFilesLastSyncMs = now;
      state.offlineFilesLoading = false;
      renderImportList();
    } catch (_) {
      state.offlineFiles = [];
      state.offlineFilesLastSyncMs = now;
      state.offlineFilesLoading = false;
      setImportError("离线文件列表加载失败");
      renderImportList();
    } finally {
      offlineFetchInFlight = false;
      try { state.offlineFilesLoading = false; } catch (_) {}
    }
  };

  const openOfflineRel = createOpenOfflineRel(dom, state, {
    onSelectKey,
    renderTabs,
    renderBookmarkDrawerList,
    setImportError,
  });

  const openImportDialog = () => {
    const btn = dom && dom.importBtn ? dom.importBtn : null;
    const dlg = dom && dom.importDialog ? dom.importDialog : null;
    const canPopup = !!(btn && dlg && typeof dlg.show === "function");
    if (!canPopup) return;
    try {
      if (dlg.open) { dlg.close(); return; }
    } catch (_) {}

    // Keep UI clean: import popover is exclusive with drawers.
    try { closeDrawer(dom); } catch (_) {}
    try { closeTranslateDrawer(dom); } catch (_) {}
    try { closeBookmarkDrawer(dom); } catch (_) {}
    try { if (dom.exportPrefsDialog && dom.exportPrefsDialog.open) dom.exportPrefsDialog.close(); } catch (_) {}
    try { if (dom.quickViewDialog && dom.quickViewDialog.open) dom.quickViewDialog.close(); } catch (_) {}

    const ok = openPopupNearEl(dlg, btn, { prefer: "left", align: "start", gap: 10, pad: 12 });
    if (!ok) return;

    try { setImportError(""); } catch (_) {}
    const hasFiles = Array.isArray(state && state.offlineFiles) && state.offlineFiles.length;
    try { if (!hasFiles) state.offlineFilesLoading = true; } catch (_) {}
    try { renderImportList(); } catch (_) {}
    try { refreshOfflineFiles(!hasFiles); } catch (_) {}
    try {
      setTimeout(() => {
        try { if (dom.importRel && typeof dom.importRel.focus === "function") dom.importRel.focus(); } catch (_) {}
      }, 0);
    } catch (_) {}
  };

  // 导入对话（离线展示入口）
  if (dom.importBtn) dom.importBtn.addEventListener("click", () => { try { openImportDialog(); } catch (_) {} });
  if (dom.importDialogCloseBtn) dom.importDialogCloseBtn.addEventListener("click", () => { try { if (dom.importDialog && dom.importDialog.open) dom.importDialog.close(); } catch (_) {} });
  if (dom.importDialog) dom.importDialog.addEventListener("close", () => {
    try { destroyImportDatepicker(); } catch (_) {}
    importIndex = null;
    importUi = null;
  });
  if (dom.importRefreshBtn) dom.importRefreshBtn.addEventListener("click", async () => { try { await refreshOfflineFiles(true); } catch (_) {} });
  if (dom.importOpenBtn) dom.importOpenBtn.addEventListener("click", async () => { try { await openOfflineRel(importRelFromInput()); } catch (_) {} });
  if (dom.importRel) dom.importRel.addEventListener("keydown", async (e) => {
    try {
      const keyName = String(e && e.key ? e.key : "");
      if (keyName !== "Enter") return;
      try { e.preventDefault(); } catch (_) {}
      await openOfflineRel(importRelFromInput());
    } catch (_) {}
  });
  if (dom.importList) dom.importList.addEventListener("click", async (e) => {
    try {
      const row = e && e.target && e.target.closest ? e.target.closest(".tab[data-rel]") : null;
      if (!row) return;
      const rel = row.dataset ? String(row.dataset.rel || "") : "";
      const file = row.dataset ? String(row.dataset.file || "") : "";
      const thread_id = row.dataset ? String(row.dataset.threadId || "") : "";
      if (!rel) return;
      await openOfflineRel(rel, { file, thread_id });
    } catch (_) {}
  });
  if (dom.importList) dom.importList.addEventListener("keydown", async (e) => {
    try {
      const keyName = String(e && e.key ? e.key : "");
      if (keyName !== "Enter" && keyName !== " ") return;
      const row = e && e.target && e.target.closest ? e.target.closest(".tab[data-rel]") : null;
      if (!row) return;
      try { e.preventDefault(); } catch (_) {}
      await openOfflineRel(String(row.dataset ? row.dataset.rel || "" : ""), { file: String(row.dataset ? row.dataset.file || "" : ""), thread_id: String(row.dataset ? row.dataset.threadId || "" : "") });
    } catch (_) {}
  });

  // API: allow other modules to open the dialog or refresh list if needed.
  return { openImportDialog, refreshOfflineFiles };
}
