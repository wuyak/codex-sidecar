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

