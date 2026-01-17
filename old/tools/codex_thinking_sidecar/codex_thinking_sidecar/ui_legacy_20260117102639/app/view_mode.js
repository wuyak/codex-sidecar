import { flashToastAt } from "./utils/toast.js";

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
}

function _toastFromButton(dom, text) {
  const btn = dom && dom.quickViewBtn ? dom.quickViewBtn : null;
  if (!btn || !btn.getBoundingClientRect) return;
  try {
    const r = btn.getBoundingClientRect();
    flashToastAt(r.left + r.width / 2, r.top + r.height / 2, text, { isLight: true, durationMs: 1200 });
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
  if (!opts.silent) {
    _toastFromButton(dom, m === "quick" ? "快速浏览：已开启" : "快速浏览：已关闭");
  }
  return m;
}

export function toggleViewMode(dom, state) {
  const cur = _sanitize(state && state.viewMode);
  return setViewMode(dom, state, cur === "quick" ? "full" : "quick");
}
