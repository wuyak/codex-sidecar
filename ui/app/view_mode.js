const _LS_KEY = "codex_sidecar_view_mode";

function _sanitize(mode) {
  const m = String(mode || "").trim().toLowerCase();
  return (m === "quick") ? "quick" : "full";
}

function _applyClass(mode) {
  try {
    document.body.classList.toggle("quick-view", mode === "quick");
  } catch (_) {}
}

function _applyButton(dom, mode) {
  const btn = dom && dom.quickViewBtn ? dom.quickViewBtn : null;
  if (!btn || !btn.classList) return;
  try {
    btn.classList.toggle("active", mode === "quick");
  } catch (_) {}
  try {
    const text = `精简显示：${mode === "quick" ? "已开启" : "已关闭"}（长按打开精简显示设置）`;
    btn.setAttribute("aria-label", text);
    btn.removeAttribute("title");
  } catch (_) {}
}

export function initViewMode(dom, state) {
  let mode = "full";
  try { mode = _sanitize(localStorage.getItem(_LS_KEY)); } catch (_) {}
  if (state) state.viewMode = mode;
  _applyClass(mode);
  _applyButton(dom, mode);
}

export function setViewMode(dom, state, mode, opts = {}) {
  const m = _sanitize(mode);
  if (state) state.viewMode = m;
  _applyClass(m);
  _applyButton(dom, m);
  try { localStorage.setItem(_LS_KEY, m); } catch (_) {}
  return m;
}

export function toggleViewMode(dom, state) {
  const cur = _sanitize(state && state.viewMode);
  return setViewMode(dom, state, cur === "quick" ? "full" : "quick");
}
