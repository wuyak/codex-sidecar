import { closeBookmarkDrawer, closeDrawer, closeTranslateDrawer } from "../ui.js";
import { colorForKey, rolloutStampFromFile, shortId } from "../../utils.js";
import { offlineKeyFromRel } from "../../offline.js";
import { saveOfflineShowList, upsertOfflineShow } from "../../offline_show.js";
import { openPopupNearEl } from "./ui_hints.js";

export function wireImportDialog(dom, state, helpers, opts = {}) {
  const h = (helpers && typeof helpers === "object") ? helpers : {};
  const onSelectKey = typeof h.onSelectKey === "function" ? h.onSelectKey : (async () => {});
  const renderTabs = typeof h.renderTabs === "function" ? h.renderTabs : (() => {});
  const renderBookmarkDrawerList = typeof opts.renderBookmarkDrawerList === "function"
    ? opts.renderBookmarkDrawerList
    : (() => {});

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

    const files = Array.isArray(state && state.offlineFiles) ? state.offlineFiles : [];

    try { host.replaceChildren(); } catch (_) { while (host.firstChild) host.removeChild(host.firstChild); }
    const frag = document.createDocumentFragment();

    if (!files.length) {
      const empty = document.createElement("div");
      empty.className = "meta";
      empty.style.opacity = "0.7";
      empty.style.padding = "6px 2px";
      empty.textContent = "暂无可选文件（可手动输入 rel，或稍等写入）";
      frag.appendChild(empty);
      host.appendChild(frag);
      return;
    }

    const parseYmd = (rel) => {
      const r = String(rel || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
      const parts = r.split("/");
      if (parts.length < 5) return null;
      if (parts[0] !== "sessions") return null;
      const y = String(parts[1] || "");
      const m = String(parts[2] || "");
      const d = String(parts[3] || "");
      if (!/^\d{4}$/.test(y)) return null;
      if (!/^\d{2}$/.test(m)) return null;
      if (!/^\d{2}$/.test(d)) return null;
      return { y, m, d };
    };

    // Build a directory tree: year -> month -> day -> [files...]
    const tree = new Map(); // y -> Map(m -> Map(d -> items[]))
    const other = []; // fallback bucket (should be rare)
    for (const it of files) {
      const rel = String((it && it.rel) ? it.rel : "").trim();
      if (!rel) continue;
      const ymd = parseYmd(rel);
      if (!ymd) { other.push(it); continue; }
      const { y, m, d } = ymd;
      if (!tree.has(y)) tree.set(y, new Map());
      const ym = tree.get(y);
      if (!ym.has(m)) ym.set(m, new Map());
      const dm = ym.get(m);
      if (!dm.has(d)) dm.set(d, []);
      try { dm.get(d).push(it); } catch (_) {}
    }

    const asc = (a, b) => String(a || "").localeCompare(String(b || ""));
    const years = Array.from(tree.keys()).sort(asc);

    const countYear = (y) => {
      try {
        const ym = tree.get(y);
        let n = 0;
        for (const m of ym.keys()) {
          const dm = ym.get(m);
          for (const d of dm.keys()) n += (dm.get(d) || []).length;
        }
        return n;
      } catch (_) { return 0; }
    };
    const countMonth = (y, m) => {
      try {
        const dm = tree.get(y).get(m);
        let n = 0;
        for (const d of dm.keys()) n += (dm.get(d) || []).length;
        return n;
      } catch (_) { return 0; }
    };

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

    const renderFileRowsInto = (listEl, items) => {
      if (!listEl) return;
      if (listEl.dataset && listEl.dataset.loaded === "1") return;
      try { if (listEl.dataset) listEl.dataset.loaded = "1"; } catch (_) {}

      const arr = Array.isArray(items) ? items.slice(0) : [];
      // Sort by filename timestamp (directory date order should not depend on mtime).
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

        // Avoid duplicating information: year/month/day already in group header,
        // and labelText already carries stamp + id. Only add a small marker if shown.
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

    // Compact 3-level index:
    // - Years: horizontal chips
    // - Months: horizontal chips
    // - Days: compact grid
    // - Files: list for selected day only
    const root = document.createElement("div");
    root.className = "imp-tree";

    const pickLast = (xs) => (Array.isArray(xs) && xs.length) ? String(xs[xs.length - 1] || "") : "";
    const hasYear = (y) => y && tree.has(y);
    const hasMonth = (y, m) => {
      if (!y || !m) return false;
      try { return !!(tree.get(y) && tree.get(y).has(m)); } catch (_) { return false; }
    };
    const hasDay = (y, m, d) => {
      if (!y || !m || !d) return false;
      try { return !!(tree.get(y).get(m) && tree.get(y).get(m).has(d)); } catch (_) { return false; }
    };

    let selY = "";
    let selM = "";
    let selD = "";
    try { selY = String(state && state.importSelY ? state.importSelY : ""); } catch (_) { selY = ""; }
    try { selM = String(state && state.importSelM ? state.importSelM : ""); } catch (_) { selM = ""; }
    try { selD = String(state && state.importSelD ? state.importSelD : ""); } catch (_) { selD = ""; }

    if (!hasYear(selY)) {
      selY = pickLast(years);
      selM = "";
      selD = "";
      try { state.importSelY = selY; state.importSelM = ""; state.importSelD = ""; } catch (_) {}
    }

    const monthsMap = hasYear(selY) ? tree.get(selY) : null;
    const months = monthsMap ? Array.from(monthsMap.keys()).sort(asc) : [];
    if (!hasMonth(selY, selM)) {
      selM = pickLast(months);
      selD = "";
      try { state.importSelM = selM; state.importSelD = ""; } catch (_) {}
    }

    const daysMap = hasMonth(selY, selM) ? tree.get(selY).get(selM) : null;
    const days = daysMap ? Array.from(daysMap.keys()).sort(asc) : [];
    if (!hasDay(selY, selM, selD)) {
      selD = pickLast(days);
      try { state.importSelD = selD; } catch (_) {}
    }

    const formatCount = (n) => {
      const x = Math.max(0, Number(n) || 0);
      if (!x) return "";
      if (x >= 1000) return "999+";
      return String(x);
    };

    const makeChip = (label, count, attrs = {}) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "imp-chip";
      const a = (attrs && typeof attrs === "object") ? attrs : {};
      const active = !!a.active;
      if (active) btn.classList.add("is-active");
      try {
        const act = String(a.action || "");
        if (act === "selYear") btn.classList.add("imp-chip-year");
        if (act === "selMonth") btn.classList.add("imp-chip-month");
        if (act === "selDay") btn.classList.add("imp-chip-day");
      } catch (_) {}
      try { btn.setAttribute("aria-pressed", active ? "true" : "false"); } catch (_) {}
      try { btn.setAttribute("aria-label", `${String(label || "")}（${Number(count) || 0}个文件）`); } catch (_) {}
      try { btn.dataset.action = String(a.action || ""); } catch (_) {}
      if (a.year) try { btn.dataset.year = String(a.year); } catch (_) {}
      if (a.month) try { btn.dataset.month = String(a.month); } catch (_) {}
      if (a.day) try { btn.dataset.day = String(a.day); } catch (_) {}
      const text = document.createElement("span");
      text.className = "imp-chip-text";
      try {
        if (Object.prototype.hasOwnProperty.call(a, "displayLabel")) text.textContent = String(a.displayLabel || "");
        else text.textContent = String(label || "");
      } catch (_) {
        text.textContent = String(label || "");
      }
      btn.appendChild(text);
      try {
        const v = formatCount(count);
        if (!v) return btn;
        const act = String(a.action || "");
        const badge = document.createElement("span");
        if (act === "selDay") badge.className = "imp-day-count";
        else badge.className = "imp-chip-count";
        badge.textContent = v;
        btn.appendChild(badge);
      } catch (_) {}
      return btn;
    };

    // Years
    const yearsRow = document.createElement("div");
    yearsRow.className = "imp-row imp-years";
    for (const y of years) {
      const chip = makeChip(String(y), countYear(y), { action: "selYear", year: y, active: y === selY });
      yearsRow.appendChild(chip);
    }
    root.appendChild(yearsRow);

    // Months
    if (months.length) {
      const monthsRow = document.createElement("div");
      monthsRow.className = "imp-row imp-months";
      for (const m of months) {
        const mm = String(Number(m) || m);
        const chip = makeChip(`${mm}月`, countMonth(selY, m), { action: "selMonth", month: m, active: m === selM });
        monthsRow.appendChild(chip);
      }
      root.appendChild(monthsRow);
    }

    // Days (grid)
    if (days.length) {
      const daysGrid = document.createElement("div");
      daysGrid.className = "imp-grid imp-days";
      for (const d of days) {
        let n = 0;
        try { n = (daysMap && daysMap.get(d)) ? (daysMap.get(d) || []).length : 0; } catch (_) { n = 0; }
        const dd = String(Number(d) || d);
        const chip = makeChip(`${dd}日`, n, { action: "selDay", day: d, active: d === selD, displayLabel: dd });
        daysGrid.appendChild(chip);
      }
      root.appendChild(daysGrid);
    }

    let selectedItems = [];
    try {
      selectedItems = (selY && selM && selD && daysMap && daysMap.get(selD)) ? (daysMap.get(selD) || []) : [];
    } catch (_) {
      selectedItems = [];
    }

    const pathLine = document.createElement("div");
    pathLine.className = "meta imp-path";
    if (selY && selM && selD) {
      pathLine.textContent = `sessions/${selY}/${selM}/${selD} · ${selectedItems.length} 个文件`;
    } else {
      pathLine.textContent = "sessions/";
    }
    root.appendChild(pathLine);

    const filesHost = document.createElement("div");
    filesHost.className = "tabs imp-files";
    try { filesHost.dataset.loaded = "0"; } catch (_) {}
    renderFileRowsInto(filesHost, selectedItems);
    root.appendChild(filesHost);

    if (other.length) {
      const otherLine = document.createElement("div");
      otherLine.className = "meta";
      otherLine.style.marginTop = "8px";
      otherLine.style.opacity = "0.8";
      otherLine.textContent = `其他：${other.length}`;
      root.appendChild(otherLine);
      const otherHost = document.createElement("div");
      otherHost.className = "tabs";
      try { otherHost.dataset.loaded = "0"; } catch (_) {}
      renderFileRowsInto(otherHost, other);
      root.appendChild(otherHost);
    }

    frag.appendChild(root);
    host.appendChild(frag);
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
      const url = `/api/offline/files?limit=0&t=${now}`;
      const r = await fetch(url, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      const files = Array.isArray(r && r.files) ? r.files : [];
      state.offlineFiles = files;
      state.offlineFilesLastSyncMs = now;
      renderImportList();
    } catch (_) {
      state.offlineFiles = [];
      state.offlineFilesLastSyncMs = now;
      setImportError("离线文件列表加载失败");
      renderImportList();
    } finally {
      offlineFetchInFlight = false;
    }
  };

  const normalizeRelForImport = (raw) => {
    let s = String(raw ?? "").trim();
    if (!s) return "";
    // Strip accidental wrapping quotes from copy/paste.
    try {
      const a = s.startsWith("\"") && s.endsWith("\"");
      const b = s.startsWith("'") && s.endsWith("'");
      if (a || b) s = s.slice(1, -1).trim();
    } catch (_) {}
    // Normalize separators + strip file:// prefix (if any).
    s = s.replace(/^file:\/*/i, "");
    s = s.replaceAll("\\", "/");

    // Best-effort: extract canonical rel from absolute paths like:
    // - /home/.../.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
    // - \\wsl.localhost\\...\\.codex\\sessions\\YYYY\\MM\\DD\\rollout-*.jsonl
    try {
      const m = s.match(/(?:^|\/)(sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[^\/]+\.jsonl)\b/i);
      if (m && m[1]) return String(m[1]).replaceAll("\\", "/");
    } catch (_) {}

    // Fallback: take the tail after the last "/sessions/".
    try {
      const lower = s.toLowerCase();
      let idx = lower.lastIndexOf("/sessions/");
      if (idx >= 0) idx += 1; // keep "sessions/..."
      else idx = lower.lastIndexOf("sessions/");
      if (idx >= 0) s = s.slice(idx);
    } catch (_) {}

    while (s.startsWith("/")) s = s.slice(1);
    return s;
  };

  const openOfflineRel = async (rel, meta = {}) => {
    let rel0 = normalizeRelForImport(rel);
    while (rel0.startsWith("/")) rel0 = rel0.slice(1);
    if (!rel0) return;
    // Echo back normalized rel so the user can see what's actually imported.
    try {
      const el = dom && dom.importRel ? dom.importRel : null;
      if (el && typeof el.value === "string") el.value = rel0;
    } catch (_) {}

    if (!rel0.startsWith("sessions/") || !/\/rollout-[^\/]+\.jsonl$/i.test(rel0)) {
      try { setImportError("请输入 sessions/**/rollout-*.jsonl（可直接粘贴完整路径）"); } catch (_) {}
      return;
    }
    const file = String(meta.file || "").trim();
    const tid = String(meta.thread_id || meta.threadId || "").trim();
    try { setImportError(""); } catch (_) {}
    try {
      const next = upsertOfflineShow(state.offlineShow, { rel: rel0, file, thread_id: tid });
      state.offlineShow = next;
      saveOfflineShowList(next);
    } catch (_) {}
    try { renderTabs(); } catch (_) {}
    try { renderBookmarkDrawerList(); } catch (_) {}
    const key = offlineKeyFromRel(rel0);
    await onSelectKey(key);
    try { if (dom && dom.importDialog && dom.importDialog.open) dom.importDialog.close(); } catch (_) {}
    closeBookmarkDrawer(dom);
  };

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
    try { renderImportList(); } catch (_) {}
    try { refreshOfflineFiles(false); } catch (_) {}
    try {
      setTimeout(() => {
        try { if (dom.importRel && typeof dom.importRel.focus === "function") dom.importRel.focus(); } catch (_) {}
      }, 0);
    } catch (_) {}
  };

  // 导入对话（离线展示入口）
  if (dom.importBtn) dom.importBtn.addEventListener("click", () => { try { openImportDialog(); } catch (_) {} });
  if (dom.importDialogCloseBtn) dom.importDialogCloseBtn.addEventListener("click", () => { try { if (dom.importDialog && dom.importDialog.open) dom.importDialog.close(); } catch (_) {} });
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
      const chip = e && e.target && e.target.closest ? e.target.closest("button.imp-chip[data-action]") : null;
      if (chip && chip.dataset) {
        const act = String(chip.dataset.action || "");
        if (act === "selYear") {
          const y = String(chip.dataset.year || "");
          try { state.importSelY = y; state.importSelM = ""; state.importSelD = ""; } catch (_) {}
          renderImportList();
          setTimeout(() => {
            try {
              const q = `button.imp-chip[data-action="selYear"][data-year="${y}"]`;
              const btn = dom && dom.importList && dom.importList.querySelector ? dom.importList.querySelector(q) : null;
              if (btn && typeof btn.focus === "function") btn.focus();
            } catch (_) {}
          }, 0);
          return;
        }
        if (act === "selMonth") {
          const m = String(chip.dataset.month || "");
          try { state.importSelM = m; state.importSelD = ""; } catch (_) {}
          renderImportList();
          setTimeout(() => {
            try {
              const q = `button.imp-chip[data-action="selMonth"][data-month="${m}"]`;
              const btn = dom && dom.importList && dom.importList.querySelector ? dom.importList.querySelector(q) : null;
              if (btn && typeof btn.focus === "function") btn.focus();
            } catch (_) {}
          }, 0);
          return;
        }
        if (act === "selDay") {
          const d = String(chip.dataset.day || "");
          try { state.importSelD = d; } catch (_) {}
          renderImportList();
          setTimeout(() => {
            try {
              const q = `button.imp-chip[data-action="selDay"][data-day="${d}"]`;
              const btn = dom && dom.importList && dom.importList.querySelector ? dom.importList.querySelector(q) : null;
              if (btn && typeof btn.focus === "function") btn.focus();
            } catch (_) {}
          }, 0);
          return;
        }
      }

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
      try { e.preventDefault(); } catch (_) {}
      const chip = e && e.target && e.target.closest ? e.target.closest("button.imp-chip[data-action]") : null;
      if (chip && chip.dataset) {
        const act = String(chip.dataset.action || "");
        if (act === "selYear") {
          const y = String(chip.dataset.year || "");
          try { state.importSelY = y; state.importSelM = ""; state.importSelD = ""; } catch (_) {}
          renderImportList();
          setTimeout(() => {
            try {
              const q = `button.imp-chip[data-action="selYear"][data-year="${y}"]`;
              const btn = dom && dom.importList && dom.importList.querySelector ? dom.importList.querySelector(q) : null;
              if (btn && typeof btn.focus === "function") btn.focus();
            } catch (_) {}
          }, 0);
          return;
        }
        if (act === "selMonth") {
          const m = String(chip.dataset.month || "");
          try { state.importSelM = m; state.importSelD = ""; } catch (_) {}
          renderImportList();
          setTimeout(() => {
            try {
              const q = `button.imp-chip[data-action="selMonth"][data-month="${m}"]`;
              const btn = dom && dom.importList && dom.importList.querySelector ? dom.importList.querySelector(q) : null;
              if (btn && typeof btn.focus === "function") btn.focus();
            } catch (_) {}
          }, 0);
          return;
        }
        if (act === "selDay") {
          const d = String(chip.dataset.day || "");
          try { state.importSelD = d; } catch (_) {}
          renderImportList();
          setTimeout(() => {
            try {
              const q = `button.imp-chip[data-action="selDay"][data-day="${d}"]`;
              const btn = dom && dom.importList && dom.importList.querySelector ? dom.importList.querySelector(q) : null;
              if (btn && typeof btn.focus === "function") btn.focus();
            } catch (_) {}
          }, 0);
          return;
        }
      }

      const row = e && e.target && e.target.closest ? e.target.closest(".tab[data-rel]") : null;
      if (!row) return;
      await openOfflineRel(String(row.dataset ? row.dataset.rel || "" : ""), { file: String(row.dataset ? row.dataset.file || "" : ""), thread_id: String(row.dataset ? row.dataset.threadId || "" : "") });
    } catch (_) {}
  });

  // API: allow other modules to open the dialog or refresh list if needed.
  return { openImportDialog, refreshOfflineFiles };
}
