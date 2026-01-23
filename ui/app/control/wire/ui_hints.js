import { flashToastAt } from "../../utils/toast.js";

const clamp = (n, a, b) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.min(b, Math.max(a, x));
};

const syncPopupOpenClass = () => {
  try {
    const anyOpen = document && document.querySelector && document.querySelector("dialog.popup-dialog[open]");
    if (anyOpen) document.body.classList.add("popup-open");
    else document.body.classList.remove("popup-open");
  } catch (_) {}
};

export function toastFromEl(el, text, opts = {}) {
  const isLight = ("isLight" in opts) ? !!opts.isLight : true;
  const durationMs = Number.isFinite(Number(opts.durationMs)) ? Number(opts.durationMs) : 1100;
  try {
    const node = el && el.getBoundingClientRect ? el : null;
    const r = node ? node.getBoundingClientRect() : null;
    const x = r ? (r.left + r.width / 2) : (window.innerWidth / 2);
    const y = r ? (r.top + r.height / 2) : 24;
    flashToastAt(x, y, String(text || ""), { isLight, durationMs });
  } catch (_) {}
}

let uiHoverTipEl = null;

const ensureUiHoverTipEl = () => {
  try {
    if (uiHoverTipEl && document.body && document.body.contains(uiHoverTipEl)) return uiHoverTipEl;
  } catch (_) {}
  try {
    const el = document.createElement("div");
    el.className = "ui-hover-tip";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    uiHoverTipEl = el;
    return el;
  } catch (_) {
    uiHoverTipEl = null;
    return null;
  }
};

export function hideUiHoverTip() {
  const el = ensureUiHoverTipEl();
  if (!el) return;
  try { el.classList.remove("show"); } catch (_) {}
}

const placeUiHoverTip = (el, anchorEl, opts = {}) => {
  const anchor = anchorEl && typeof anchorEl.getBoundingClientRect === "function" ? anchorEl : null;
  if (!el || !anchor) return;
  const pad = Number.isFinite(Number(opts.pad)) ? Number(opts.pad) : 10;
  const gap = Number.isFinite(Number(opts.gap)) ? Number(opts.gap) : 6;
  const insetX = Number.isFinite(Number(opts.insetX)) ? Number(opts.insetX) : 12;
  const prefer = String(opts.prefer || "below").trim().toLowerCase(); // below|above

  const r = anchor.getBoundingClientRect();
  const tr = el.getBoundingClientRect();
  const vw = window.innerWidth || 0;
  const vh = window.innerHeight || 0;

  let left = r.left + insetX;
  left = clamp(left, pad, Math.max(pad, vw - pad - tr.width));

  const below = r.bottom + gap;
  const above = r.top - gap - tr.height;
  let top = below;
  if (prefer === "above" || (below + tr.height) > (vh - pad)) top = above;
  top = clamp(top, pad, Math.max(pad, vh - pad - tr.height));

  try { el.style.left = `${left}px`; } catch (_) {}
  try { el.style.top = `${top}px`; } catch (_) {}
};

export function showUiHoverTip(anchorEl, text, opts = {}) {
  const msg = String(text || "").trim();
  if (!msg) return;
  const el = ensureUiHoverTipEl();
  if (!el) return;
  try { el.textContent = msg; } catch (_) {}
  try { el.style.left = "0px"; el.style.top = "0px"; el.style.visibility = "hidden"; } catch (_) {}
  try { el.classList.add("show"); } catch (_) {}
  try { placeUiHoverTip(el, anchorEl, opts); } catch (_) {}
  try { el.style.visibility = ""; } catch (_) {}
  try { el.classList.add("show"); } catch (_) {}
}

export function openPopupNearEl(dlg, anchorEl, opts = {}) {
  const dialog = dlg && typeof dlg.show === "function" ? dlg : null;
  const anchor = anchorEl && typeof anchorEl.getBoundingClientRect === "function" ? anchorEl : null;
  if (!dialog || !anchor) return false;

  const pad = Number.isFinite(Number(opts.pad)) ? Number(opts.pad) : 12;
  const gap = Number.isFinite(Number(opts.gap)) ? Number(opts.gap) : 10;
  const prefer = String(opts.prefer || "left").trim().toLowerCase(); // left|right
  const align = String(opts.align || "start").trim().toLowerCase(); // start|center|end

  // Avoid flicker: show hidden first, then position.
  let prevVis = "";
  try { prevVis = String(dialog.style.visibility || ""); } catch (_) {}
  try { dialog.style.visibility = "hidden"; } catch (_) {}
  try { dialog.style.left = "0px"; dialog.style.top = "0px"; } catch (_) {}
  try { if (dialog.open) dialog.close(); } catch (_) {}
  try { dialog.show(); } catch (_) { return false; }
  syncPopupOpenClass();

  let cleanup = null;
  try {
    const ar = anchor.getBoundingClientRect();
    const dr = dialog.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;

    let left = 0;
    if (prefer === "right") left = ar.right + gap;
    else left = ar.left - dr.width - gap;

    let top = 0;
    if (align === "end") top = ar.bottom - dr.height;
    else if (align === "center") top = ar.top + (ar.height - dr.height) / 2;
    else top = ar.top;

    // If our first choice is off-screen, try the other side.
    if (left < pad && prefer !== "right") left = ar.right + gap;
    if ((left + dr.width + pad) > vw && prefer === "right") left = ar.left - dr.width - gap;

    left = clamp(left, pad, Math.max(pad, vw - dr.width - pad));
    top = clamp(top, pad, Math.max(pad, vh - dr.height - pad));

    try { dialog.style.left = `${left}px`; } catch (_) {}
    try { dialog.style.top = `${top}px`; } catch (_) {}
  } catch (_) {}

  try { dialog.style.visibility = prevVis || "visible"; } catch (_) {}

  // Close when clicking outside (popover-like).
  try {
    const onDown = (e) => {
      try {
        if (!dialog.open) return;
        const t = e && e.target ? e.target : null;
        if (!t) return;
        if (dialog.contains && dialog.contains(t)) return;
        if (anchor.contains && anchor.contains(t)) return;
        try { dialog.close(); } catch (_) {}
      } catch (_) {}
    };
    const onClose = () => {
      try { document.removeEventListener("pointerdown", onDown, true); } catch (_) {}
      try { syncPopupOpenClass(); } catch (_) {}
    };
    cleanup = onClose;
    try { document.addEventListener("pointerdown", onDown, true); } catch (_) {}
    try { dialog.addEventListener("close", onClose, { once: true }); } catch (_) {}
  } catch (_) {}

  // Safety: if dialog is removed or throws, ensure listeners don't linger.
  void cleanup;
  return true;
}
