function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.min(b, Math.max(a, x));
}

let _toastEl = null;
let _toastT = 0;

export function flashToastAt(x, y, text, opts = {}) {
  const msg = String(text || "").trim();
  if (!msg) return;
  const isLight = !!opts.isLight;
  const durationMs = Number.isFinite(Number(opts.durationMs)) ? Number(opts.durationMs) : 1300;

  let el = null;
  try {
    if (_toastEl && document.body && document.body.contains(_toastEl)) el = _toastEl;
  } catch (_) {
    el = null;
  }
  if (!el) {
    el = document.createElement("div");
    _toastEl = el;
    try { document.body.appendChild(el); } catch (_) {}
  }
  // Reuse the existing copy-toast style (fade + fixed positioning). Keep it singleton
  // to avoid overlapping duplicate toasts (e.g., “导出中…” + “已导出”).
  el.className = "copy-toast fixed" + (isLight ? " light" : "");
  el.textContent = msg;
  el.style.left = "0px";
  el.style.top = "0px";
  try {
    const rect = el.getBoundingClientRect();
    const pad = 12;
    const dx = 14;
    const dy = 14;
    let left = Number(x || 0) + dx;
    let top = Number(y || 0) + dy;
    if (left + rect.width + pad > window.innerWidth) left = Number(x || 0) - rect.width - dx;
    if (top + rect.height + pad > window.innerHeight) top = window.innerHeight - rect.height - pad;
    left = clamp(left, pad, Math.max(pad, window.innerWidth - rect.width - pad));
    top = clamp(top, pad, Math.max(pad, window.innerHeight - rect.height - pad));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  } catch (_) {}
  if (_toastT) { try { clearTimeout(_toastT); } catch (_) {} }
  _toastT = setTimeout(() => {
    _toastT = 0;
    try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (_) {}
  }, Math.max(300, durationMs));
}
