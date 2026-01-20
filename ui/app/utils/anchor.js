export function stabilizeClickWithin(el, clientY, opts = {}) {
  const y = Number(clientY);
  if (!Number.isFinite(y)) return;
  if (!el || typeof el.getBoundingClientRect !== "function") return;

  const pad = Number.isFinite(Number(opts.pad)) ? Number(opts.pad) : 12;

  requestAnimationFrame(() => {
    try {
      if (!el || typeof el.getBoundingClientRect !== "function") return;
      const r = el.getBoundingClientRect();
      if (!r || !Number.isFinite(r.top) || !Number.isFinite(r.bottom) || (r.bottom <= r.top)) return;

      let dy = 0;
      if (y < (r.top + pad)) {
        const desiredTop = y - pad;
        dy = r.top - desiredTop;
      } else if (y > (r.bottom - pad)) {
        const desiredBottom = y + pad;
        dy = r.bottom - desiredBottom;
      }
      if (dy && Number.isFinite(dy)) window.scrollBy(0, dy);
    } catch (_) {}
  });
}

export function stabilizeToggleNoDrift(anchorEl, mutate, opts = {}) {
  const el = anchorEl;
  const fn = (typeof mutate === "function") ? mutate : null;
  if (!el || typeof el.getBoundingClientRect !== "function") {
    try { if (fn) fn(); } catch (_) {}
    return;
  }

  let top0 = NaN;
  try { top0 = Number(el.getBoundingClientRect().top); } catch (_) { top0 = NaN; }
  const seq = (el.__stbSeq = (Number(el.__stbSeq) || 0) + 1);

  try { if (fn) fn(); } catch (_) {}

  const minDy = Number.isFinite(Number(opts.minDy)) ? Number(opts.minDy) : 1;
  const maxDy = Number.isFinite(Number(opts.maxDy)) ? Number(opts.maxDy) : (Number(window.innerHeight) || 0);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        if (!el || el.__stbSeq !== seq) return;
        if (el.isConnected === false) return;
        const top1 = Number(el.getBoundingClientRect().top);
        const dy = top1 - top0;
        if (!Number.isFinite(dy)) return;
        if (Math.abs(dy) < minDy) return;
        if (maxDy > 0 && Math.abs(dy) > maxDy) return;
        window.scrollBy(0, dy);
      } catch (_) {}
    });
  });
}
