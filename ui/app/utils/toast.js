function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.min(b, Math.max(a, x));
}

export function flashToastAt(x, y, text, opts = {}) {
  const msg = String(text || "").trim();
  if (!msg) return;
  const isLight = !!opts.isLight;
  const durationMs = Number.isFinite(Number(opts.durationMs)) ? Number(opts.durationMs) : 1300;

  const el = document.createElement("div");
  // Reuse the existing copy-toast style (fade + fixed positioning).
  el.className = "copy-toast fixed" + (isLight ? " light" : "");
  el.textContent = msg;
  el.style.left = "0px";
  el.style.top = "0px";
  document.body.appendChild(el);
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
  setTimeout(() => {
    try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (_) {}
  }, Math.max(300, durationMs));
}

