import { colorForKey, keyOf, rolloutStampFromFile, shortId } from "../utils.js";
import { getCustomLabel, setCustomLabel } from "./labels.js";
import { loadHiddenThreads, saveHiddenThreads, saveShowHiddenFlag } from "./hidden.js";
import { getUnreadCount, getUnreadTotal } from "../unread.js";
import { notifyCorner } from "../utils/notify.js";

function _parseStamp(stamp) {
  const s = String(stamp || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return { yyyy: m[1], mm: m[2], dd: m[3], HH: m[4], MM: m[5] };
}

function _stampShort(stamp) {
  const p = _parseStamp(stamp);
  if (p) return `${p.mm}-${p.dd} ${p.HH}:${p.MM}`;
  return String(stamp || "").trim();
}

function threadLabels(t) {
  const stampFull = rolloutStampFromFile(t.file || "");
  const stampShort = _stampShort(stampFull);
  const idPart = t.thread_id ? shortId(t.thread_id) : shortId(((t.file || "").split("/").slice(-1)[0]) || (t.key || ""));
  const full = (stampFull && idPart) ? `${stampFull} · ${idPart}` : (stampFull || idPart || "unknown");
  const label = (stampShort && idPart) ? `${stampShort} · ${idPart}` : (idPart || stampShort || stampFull || "unknown");
  return { label, full };
}

export function clearTabs(dom) {
  const host = dom.bookmarks;
  if (!host) return;
  while (host.firstChild) host.removeChild(host.firstChild);
}

function _getOrCreateBookmark(host, existing, key, create) {
  const k = String(key || "");
  const prev = existing && typeof existing.get === "function" ? existing.get(k) : null;
  if (prev) return prev;
  const el = create();
  try { el.dataset.key = k; } catch (_) {}
  return el;
}

function _ensureBookmarkStructure(btn) {
  if (!btn) return null;
  const labelSpan = btn.querySelector ? btn.querySelector(".bm-label") : null;
  const input = btn.querySelector ? btn.querySelector(".bm-edit") : null;
  const dotSpan = btn.querySelector ? btn.querySelector(".bm-dot") : null;
  const tipSpan = btn.querySelector ? btn.querySelector(".bm-tip") : null;
  if (labelSpan && input && dotSpan && tipSpan) return { tipSpan, dotSpan, labelSpan, input };
  // (Re)build inner structure once; updates reuse these nodes.
  while (btn.firstChild) btn.removeChild(btn.firstChild);
  const tip = document.createElement("span");
  tip.className = "bm-tip";
  const dot = document.createElement("span");
  dot.className = "bm-dot";
  const l = document.createElement("span");
  l.className = "bm-label";
  const i = document.createElement("input");
  i.className = "bm-edit";
  i.type = "text";
  i.autocomplete = "off";
  i.spellcheck = false;
  i.placeholder = "重命名…";
  btn.appendChild(tip);
  btn.appendChild(dot);
  btn.appendChild(l);
  btn.appendChild(i);
  return { tipSpan: tip, dotSpan: dot, labelSpan: l, input: i };
}

function _wireBookmarkInteractions(btn) {
  if (!btn || btn.__bmWired) return;
  btn.__bmWired = true;

  let startX = 0;
  let startY = 0;
  let startAt = 0;
  let moved = false;
  let longFired = false;
  let pressT = 0;

  const clearPress = () => {
    if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
    pressT = 0;
    startAt = 0;
    moved = false;
  };

  const enterEdit = () => {
    longFired = true;
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    if (!k || k === "all") return;
    try { btn.classList.add("editing", "active"); } catch (_) {}
    const parts = _ensureBookmarkStructure(btn);
    if (!parts) return;
    const input = parts.input;
    const label = String((btn.dataset && btn.dataset.label) ? btn.dataset.label : "");
    const custom = getCustomLabel(k);
    const v = String(custom || label || "");
    try { input.value = v; } catch (_) {}
    try {
      setTimeout(() => {
        try { input.focus(); } catch (_) {}
        try { input.select(); } catch (_) {}
      }, 0);
    } catch (_) {}
  };

  const commitEdit = (keepFocus = false) => {
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    if (!k || k === "all") return;
    const parts = _ensureBookmarkStructure(btn);
    if (!parts) return;
    const input = parts.input;
    const raw = String(input.value || "");
    const v = raw.trim();
    const defaultLabel = String((btn.dataset && btn.dataset.defaultLabel) ? btn.dataset.defaultLabel : "");
    if (!v || (defaultLabel && v === defaultLabel)) setCustomLabel(k, "");
    else setCustomLabel(k, v);
    try { btn.classList.remove("editing"); } catch (_) {}
    if (!keepFocus) {
      try { input.blur(); } catch (_) {}
    }
    const rerender = btn.__bmRender;
    if (typeof rerender === "function") rerender();
  };

  const cancelEdit = () => {
    try { btn.classList.remove("editing"); } catch (_) {}
    const rerender = btn.__bmRender;
    if (typeof rerender === "function") rerender();
  };

  btn.addEventListener("pointerdown", (e) => {
    try {
      if (e && typeof e.button === "number" && e.button !== 0) return;
    } catch (_) {}
    clearPress();
    moved = false;
    longFired = false;
    startX = Number(e && e.clientX) || 0;
    startY = Number(e && e.clientY) || 0;
    startAt = Date.now();
    const mode = String(btn.dataset && btn.dataset.mode ? btn.dataset.mode : "");
    const allowLongPressEdit = mode !== "rail";
    if (allowLongPressEdit) {
      pressT = setTimeout(() => {
        if (!startAt) return;
        if (moved) return;
        enterEdit();
      }, 420);
    }
  });

  btn.addEventListener("pointermove", (e) => {
    if (!startAt) return;
    const x = Number(e && e.clientX) || 0;
    const y = Number(e && e.clientY) || 0;
    const dx = x - startX;
    const dy = y - startY;
    if ((dx * dx + dy * dy) > (6 * 6)) {
      moved = true;
      if (pressT) { try { clearTimeout(pressT); } catch (_) {} }
      pressT = 0;
    }
  });

  btn.addEventListener("pointerup", clearPress);
  btn.addEventListener("pointercancel", clearPress);
  btn.addEventListener("pointerleave", clearPress);

  btn.addEventListener("click", async (e) => {
    if (longFired) { longFired = false; try { e.preventDefault(); e.stopPropagation(); } catch (_) {} return; }
    if (btn.classList && btn.classList.contains("editing")) return;
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    const onSelect = btn.__bmOnSelect;
    if (typeof onSelect === "function" && k) await onSelect(k);
  });

  btn.addEventListener("contextmenu", async (e) => {
    if (btn.classList && btn.classList.contains("editing")) return;
    const k = String(btn.dataset && btn.dataset.key ? btn.dataset.key : "").trim();
    const onCtx = btn.__bmOnContext;
    if (typeof onCtx !== "function" || !k) return;
    try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
    try { await onCtx(k); } catch (_) {}
  });

  btn.addEventListener("keydown", (e) => {
    const key = String(e && e.key ? e.key : "");
    const editing = !!(btn.classList && btn.classList.contains("editing"));
    if (editing) {
      if (key === "Enter") { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} commitEdit(); }
      if (key === "Escape") { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} cancelEdit(); }
      return;
    }
    if (key === "Delete") {
      const onDelete = btn.__bmOnDelete;
      if (typeof onDelete !== "function") return;
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      try { onDelete(); } catch (_) {}
    }
  });

  btn.addEventListener("focusout", (e) => {
    try {
      if (!btn.classList || !btn.classList.contains("editing")) return;
      const rt = e && e.relatedTarget;
      if (rt && btn.contains && btn.contains(rt)) return;
      commitEdit(true);
    } catch (_) {}
  });
}

export function upsertThread(state, msg) {
  const key = keyOf(msg);
  const prev = state.threadIndex.get(key) || { key, thread_id: msg.thread_id || "", file: msg.file || "", count: 0, last_ts: "", last_seq: 0 };
  prev.count = (prev.count || 0) + 1;
  const ts = msg.ts || "";
  if (ts && (!prev.last_ts || ts > prev.last_ts)) prev.last_ts = ts;
  const seq = Number.isFinite(Number(msg && msg.seq)) ? Number(msg.seq) : 0;
  if (seq && (!prev.last_seq || seq > prev.last_seq)) prev.last_seq = seq;
  state.threadIndex.set(key, prev);
}

export function renderTabs(dom, state, onSelectKey) {
  const host = dom.bookmarks;
  if (!host) return;

  // Avoid breaking inline rename (focus loss) while SSE updates are streaming in.
  try {
    const editingBtn = host.querySelector ? host.querySelector("button.bookmark.editing") : null;
    if (editingBtn) return;
  } catch (_) {}

  // Ensure rail + popover containers exist (host stays fixed at right).
  let rail = null;
  let pop = null;
  let popList = null;
  try {
    host.classList.add("bm-host");
    rail = host.querySelector ? host.querySelector(".bm-rail") : null;
    if (!rail) {
      rail = document.createElement("div");
      rail.className = "bm-rail";
      host.appendChild(rail);
    }
    pop = host.querySelector ? host.querySelector(".bm-pop") : null;
    if (!pop) {
      pop = document.createElement("div");
      pop.className = "bm-pop";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "会话列表");
      host.appendChild(pop);
    }
    popList = pop.querySelector ? pop.querySelector(".bm-pop-list") : null;
    if (!popList) {
      while (pop.firstChild) pop.removeChild(pop.firstChild);
      const list = document.createElement("div");
      list.className = "bm-pop-list";
      pop.appendChild(list);
      popList = list;
    }
  } catch (_) {}

  const items = Array.from(state.threadIndex.values()).sort((a, b) => {
    const sa = Number(a && a.last_seq) || 0;
    const sb = Number(b && b.last_seq) || 0;
    if (sa !== sb) return sb - sa;
    return String(b.last_ts || "").localeCompare(String(a.last_ts || ""));
  });

  const hidden = (state && state.hiddenThreads && typeof state.hiddenThreads.has === "function")
    ? state.hiddenThreads
    : loadHiddenThreads();
  const showHidden = !!(state && state.showHiddenThreads);
  const fragRail = document.createDocumentFragment();
  const fragPop = document.createDocumentFragment();

  const _ensureHiddenSet = () => {
    if (!state.hiddenThreads || typeof state.hiddenThreads.add !== "function") state.hiddenThreads = new Set();
    return state.hiddenThreads;
  };

  const _toggleShowHidden = async () => {
    const next = !showHidden;
    try { state.showHiddenThreads = next; } catch (_) {}
    saveShowHiddenFlag(next);
    try {
      notifyCorner(
        "bm_ctx",
        "会话列表",
        next ? "已显示已移除会话（右键会话可恢复）" : "已隐藏已移除会话",
        { ttlMs: 1600, level: "info" },
      );
    } catch (_) {}
    const curKey = String(state.currentKey || "all");
    const hiddenCur = !!(curKey && curKey !== "all" && _ensureHiddenSet().has(curKey));
    if (!next && hiddenCur) await onSelectKey("all");
    else renderTabs(dom, state, onSelectKey);
  };

  const _hideKey = async (key, labelForToast = "") => {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const s = _ensureHiddenSet();
    if (s.has(k)) return;
    s.add(k);
    saveHiddenThreads(s);
    try { notifyCorner("bm_ctx", "会话列表", `已从列表移除：${labelForToast || shortId(k)}`, { ttlMs: 1600, level: "success" }); } catch (_) {}
    if (!state.showHiddenThreads && String(state.currentKey || "all") === k) await onSelectKey("all");
    else renderTabs(dom, state, onSelectKey);
  };

  const _toggleHiddenKey = async (key, labelForToast = "") => {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const s = _ensureHiddenSet();
    const was = s.has(k);
    if (was) s.delete(k);
    else s.add(k);
    saveHiddenThreads(s);
    try {
      notifyCorner(
        "bm_ctx",
        "会话列表",
        was ? `已恢复：${labelForToast || shortId(k)}` : `已从列表移除：${labelForToast || shortId(k)}`,
        { ttlMs: 1600, level: was ? "info" : "success" },
      );
    } catch (_) {}
    if (!was && !state.showHiddenThreads && String(state.currentKey || "all") === k) await onSelectKey("all");
    else renderTabs(dom, state, onSelectKey);
  };

  const renderList = (container, existing, opts) => {
    const includeAll = !!(opts && opts.includeAll);
    const mode = String(opts && opts.mode ? opts.mode : "");
    const limit = Number.isFinite(Number(opts && opts.limit)) ? Number(opts.limit) : 0;

    const currentKey = String(state.currentKey || "all");

    const _appendAll = () => {
      const totalUnread = getUnreadTotal(state);
      const allBtn = _getOrCreateBookmark(container, existing, "all", () => document.createElement("button"));
      allBtn.className = "bookmark" + (currentKey === "all" ? " active" : "") + (totalUnread > 0 ? " has-unread" : "");
      allBtn.dataset.mode = mode;
      allBtn.style.setProperty("--bm-accent", "var(--c-muted)");
      allBtn.style.setProperty("--bm-border", "rgba(148,163,184,.55)");
      const partsAll = _ensureBookmarkStructure(allBtn);
      if (partsAll) {
        try { partsAll.tipSpan.textContent = "全部"; } catch (_) {}
        try { partsAll.labelSpan.textContent = "全部"; } catch (_) {}
      }
      try { allBtn.setAttribute("aria-label", "全部会话"); } catch (_) {}
      allBtn.__bmOnSelect = onSelectKey;
      allBtn.__bmOnContext = async (k) => { if (k === "all") await _toggleShowHidden(); };
      allBtn.__bmOnDelete = null;
      allBtn.__bmRender = () => renderTabs(dom, state, onSelectKey);
      _wireBookmarkInteractions(allBtn);
      try {
        if (totalUnread > 0) allBtn.dataset.unread = totalUnread > 99 ? "99+" : String(totalUnread);
        else { try { delete allBtn.dataset.unread; } catch (_) { allBtn.dataset.unread = ""; } }
      } catch (_) {}
      try { allBtn.title = `全部会话\n右键：${showHidden ? "隐藏" : "显示"}已移除会话`; } catch (_) {}
      return allBtn;
    };

    const _appendThread = (t) => {
      const isHidden = !!(hidden && typeof hidden.has === "function" && hidden.has(t.key));
      const u = getUnreadCount(state, t.key);
      const btn = _getOrCreateBookmark(container, existing, t.key, () => document.createElement("button"));
      btn.className = "bookmark" + (isHidden ? " tab-hidden" : "") + (currentKey === t.key ? " active" : "") + (u > 0 ? " has-unread" : "");
      btn.dataset.mode = mode;
      const clr = colorForKey(t.key || "");
      const labels = threadLabels(t);
      const defaultLabel = labels.label;
      const fullLabel = labels.full;
      const custom = getCustomLabel(t.key);
      const label = custom || defaultLabel;

      try {
        btn.style.setProperty("--bm-accent", clr.fg);
        btn.style.setProperty("--bm-border", clr.border);
      } catch (_) {}
      const parts = _ensureBookmarkStructure(btn);
      if (parts) {
        try { parts.tipSpan.textContent = label; } catch (_) {}
        try { parts.labelSpan.textContent = label; } catch (_) {}
      }
      try {
        btn.dataset.label = label;
        btn.dataset.defaultLabel = defaultLabel;
      } catch (_) {}
      try { btn.setAttribute("aria-label", label); } catch (_) {}
      try {
        if (u > 0) btn.dataset.unread = u > 99 ? "99+" : String(u);
        else { try { delete btn.dataset.unread; } catch (_) { btn.dataset.unread = ""; } }
      } catch (_) {}
      try {
        const base = custom ? `${custom}\n${fullLabel}` : fullLabel;
        const hint = isHidden ? "右键：恢复到列表" : "右键：从列表移除";
        btn.title = `${base}\n长按：重命名\n${hint}\nDelete：从列表移除`;
      } catch (_) {}
      btn.__bmOnSelect = onSelectKey;
      btn.__bmOnContext = async (k) => { await _toggleHiddenKey(k, label); };
      btn.__bmOnDelete = async () => { await _hideKey(t.key, label); };
      btn.__bmRender = () => renderTabs(dom, state, onSelectKey);
      _wireBookmarkInteractions(btn);
      return btn;
    };

    const out = document.createDocumentFragment();
    if (includeAll) out.appendChild(_appendAll());

    let list = items;
    if (limit > 0) {
      const picked = [];
      const seen = new Set();
      for (const t of items) {
        if (picked.length >= limit) break;
        const isHidden = !!(hidden && typeof hidden.has === "function" && hidden.has(t.key));
        if (isHidden) continue;
        picked.push(t);
        seen.add(t.key);
      }
      const ck = String(state.currentKey || "");
      if (ck && ck !== "all" && !seen.has(ck)) {
        const cur = state.threadIndex.get(ck);
        if (cur) {
          picked.unshift(cur);
          while (picked.length > limit) picked.pop();
        }
      }
      list = picked;
    } else {
      // full list: honor showHidden flag
      list = items.filter((t) => {
        const isHidden = !!(hidden && typeof hidden.has === "function" && hidden.has(t.key));
        return !isHidden || showHidden;
      });
    }

    // Rail should never become "invisible" (e.g. user hides the last visible session and auto-switches to "all").
    // If there's nothing to show, keep a single "all" handle so hover can still reveal the full list.
    if (!includeAll && mode === "rail" && (!list || list.length === 0)) out.appendChild(_appendAll());
    else for (const t of list) out.appendChild(_appendThread(t));
    return out;
  };

  const existingRail = new Map();
  try {
    const btns = rail && rail.querySelectorAll ? rail.querySelectorAll("button.bookmark") : [];
    for (const b of btns) {
      const k = b && b.dataset ? String(b.dataset.key || "") : "";
      if (k) existingRail.set(k, b);
    }
  } catch (_) {}

  const existingPop = new Map();
  try {
    const btns = popList && popList.querySelectorAll ? popList.querySelectorAll("button.bookmark") : [];
    for (const b of btns) {
      const k = b && b.dataset ? String(b.dataset.key || "") : "";
      if (k) existingPop.set(k, b);
    }
  } catch (_) {}

  const railFrag = renderList(rail, existingRail, { includeAll: true, mode: "rail", limit: 5 });
  const popFrag = renderList(popList, existingPop, { includeAll: true, mode: "list", limit: 0 });

  try { if (rail) rail.replaceChildren(railFrag); } catch (_) { try { while (rail && rail.firstChild) rail.removeChild(rail.firstChild); rail && rail.appendChild(railFrag); } catch (_) {} }
  try { if (popList) popList.replaceChildren(popFrag); } catch (_) { try { while (popList && popList.firstChild) popList.removeChild(popList.firstChild); popList && popList.appendChild(popFrag); } catch (_) {} }
}
