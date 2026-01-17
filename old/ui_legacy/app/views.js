function _touchLru(state, key) {
  if (!state || typeof state !== "object") return;
  if (!Array.isArray(state.viewLru)) state.viewLru = [];
  const k = String(key || "");
  if (!k) return;
  const idx = state.viewLru.indexOf(k);
  if (idx >= 0) state.viewLru.splice(idx, 1);
  state.viewLru.push(k);
}

function _evictIfNeeded(dom, state, activeKey) {
  const max = Number(state && state.viewMax);
  const viewMax = Number.isFinite(max) && max > 0 ? max : 4;
  const cache = (state && state.viewCache && typeof state.viewCache.get === "function") ? state.viewCache : null;
  if (!cache) return;
  if (!Array.isArray(state.viewLru)) state.viewLru = [];
  const keep = String(activeKey || "");

  while (cache.size > viewMax && state.viewLru.length) {
    const victim = state.viewLru.shift();
    if (!victim) continue;
    if (victim === keep) { state.viewLru.push(victim); continue; }
    const v = cache.get(victim);
    cache.delete(victim);
    try { if (state.sseByKey && typeof state.sseByKey.delete === "function") state.sseByKey.delete(victim); } catch (_) {}
    try { if (state.sseOverflow && typeof state.sseOverflow.delete === "function") state.sseOverflow.delete(victim); } catch (_) {}
    if (v && v.el && v.el.parentNode) {
      try { v.el.parentNode.removeChild(v.el); } catch (_) {}
    }
  }
}

export function initViews(dom, state) {
  if (!dom || !state) return;
  if (state.listHost && state.viewCache && state.activeList) return;

  const host = dom.list;
  state.listHost = host;
  if (!state.viewCache || typeof state.viewCache.get !== "function") state.viewCache = new Map();
  if (!Array.isArray(state.viewLru)) state.viewLru = [];

  // Create the initial view for currentKey and make it the active list container.
  const key = String(state.currentKey || "all");
  const el = document.createElement("div");
  el.className = "list-view";
  el.dataset.key = key;
  state.viewCache.set(key, {
    key,
    el,
    rowIndex: state.rowIndex || new Map(),
    callIndex: state.callIndex || new Map(),
    timeline: Array.isArray(state.timeline) ? state.timeline : [],
    lastRenderedMs: state.lastRenderedMs,
    scrollY: 0,
  });
  _touchLru(state, key);
  if (host) host.appendChild(el);

  state.activeList = el;
  state.activeViewKey = key;
  dom.list = el;
}

export function activateView(dom, state, key) {
  if (!dom || !state) return { needsRefresh: true };
  if (!state.listHost || !state.viewCache || typeof state.viewCache.get !== "function") initViews(dom, state);

  const k = String(key || "all");
  const cache = state.viewCache;
  const host = state.listHost || dom.list;

  // Persist scroll position of previous view.
  try {
    const prevKey = String(state.activeViewKey || state.currentKey || "");
    const prev = cache.get(prevKey);
    if (prev) prev.scrollY = Number(window.scrollY) || 0;
    if (prev) prev.lastRenderedMs = state.lastRenderedMs;
  } catch (_) {}

  let v = cache.get(k);
  let needsRefresh = false;
  if (!v) {
    const el = document.createElement("div");
    el.className = "list-view";
    el.dataset.key = k;
    v = {
      key: k,
      el,
      rowIndex: new Map(),
      callIndex: new Map(),
      timeline: [],
      lastRenderedMs: NaN,
      scrollY: 0,
    };
    cache.set(k, v);
    needsRefresh = true;
    if (host) host.appendChild(el);
  }
  _touchLru(state, k);
  _evictIfNeeded(dom, state, k);

  // Switch visible container.
  if (state.activeList && state.activeList !== v.el) {
    try { state.activeList.style.display = "none"; } catch (_) {}
  }
  state.activeList = v.el;
  state.activeViewKey = k;
  try { v.el.style.display = ""; } catch (_) {}
  dom.list = v.el;

  // Wire view-local indexes into state for downstream renderers.
  state.rowIndex = v.rowIndex;
  state.callIndex = v.callIndex;
  state.timeline = v.timeline;
  state.lastRenderedMs = v.lastRenderedMs;

  // Restore scroll position (best-effort).
  try {
    const y = Number(v.scrollY) || 0;
    window.scrollTo(0, y);
  } catch (_) {}

  return { needsRefresh };
}

export function clearViews(dom, state) {
  if (!dom || !state) return;
  const host = state.listHost || dom.list;
  if (host) {
    try { while (host.firstChild) host.removeChild(host.firstChild); } catch (_) {}
  }
  state.viewCache = new Map();
  state.viewLru = [];
  state.activeList = null;
  state.activeViewKey = "";
  dom.list = host;
  state.listHost = host;

  // Re-init an empty view for the current selection.
  initViews(dom, state);
  activateView(dom, state, String(state.currentKey || "all"));
}
