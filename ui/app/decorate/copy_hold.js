import { copyToClipboard } from "../utils.js";

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.min(b, Math.max(a, x));
}

function flashCopiedAt(x, y, isLight = false) {
  const el = document.createElement("div");
  el.className = "copy-toast fixed" + (isLight ? " light" : "");
  el.textContent = "已复制";
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
  }, 1300);
}

function hasActiveSelection() {
  try {
    const sel = window.getSelection && window.getSelection();
    if (!sel) return false;
    if (sel.type === "Range") return true;
    const s = String(sel.toString() || "").trim();
    return !!s;
  } catch (_) {
    return false;
  }
}

export function wireHoldCopy(el, opts) {
  if (!el || el.__wiredPress) return;
  el.__wiredPress = true;

  let startX = 0;
  let startY = 0;
  let startAt = 0;
  let moved = false;
  let longFired = false;

  const onDown = (e) => {
    try {
      // Only left click / primary touch.
      if (e && typeof e.button === "number" && e.button !== 0) return;
    } catch (_) {}
    try {
      if (opts && opts.ignoreSelector && e && e.target && e.target.closest) {
        if (e.target.closest(String(opts.ignoreSelector))) return;
      }
    } catch (_) {}
    moved = false;
    longFired = false;
    startX = Number(e && e.clientX) || 0;
    startY = Number(e && e.clientY) || 0;
    startAt = Date.now();
  };

  const onMove = (e) => {
    if (!startAt) return;
    const x = Number(e && e.clientX) || 0;
    const y = Number(e && e.clientY) || 0;
    const dx = x - startX;
    const dy = y - startY;
    if ((dx * dx + dy * dy) > (6 * 6)) {
      moved = true;
    }
  };

  const onUp = async () => {
    if (!startAt) return;
    const dt = Date.now() - startAt;
    startAt = 0;
    if (moved) return;
    if (dt < 420) return;
    if (hasActiveSelection()) return;
    longFired = true;
    try {
      const txt = (opts && typeof opts.getText === "function") ? opts.getText() : (el.textContent || "");
      const ok = await copyToClipboard(txt || "");
      if (ok) {
        flashCopiedAt(startX, startY, !!(opts && opts.toastIsLight));
        try { el.classList.add("copied"); } catch (_) {}
        setTimeout(() => { try { el.classList.remove("copied"); } catch (_) {} }, 750);
      }
    } catch (_) {}
  };

  const onCancel = () => {
    startAt = 0;
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onCancel);
  el.addEventListener("pointerleave", onCancel);

  el.addEventListener("click", (e) => {
    try {
      if (longFired) { longFired = false; e.preventDefault(); e.stopPropagation(); return; }
      if (moved) return;
      if (hasActiveSelection()) return;
      if (opts && typeof opts.onTap === "function") opts.onTap(e);
    } catch (_) {}
  });
}

