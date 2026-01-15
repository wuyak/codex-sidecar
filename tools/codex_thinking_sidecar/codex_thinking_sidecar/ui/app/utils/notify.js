function _clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.min(b, Math.max(a, x));
}

const _items = new Map(); // key -> { el, timer }

function _ensureContainer() {
  let host = null;
  try { host = document.getElementById("cornerNotify"); } catch (_) { host = null; }
  if (host) return host;
  host = document.createElement("div");
  host.id = "cornerNotify";
  host.className = "corner-notify";
  document.body.appendChild(host);
  return host;
}

function _escape(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function _renderToast({ title, detail, level }) {
  const t = String(title || "").trim();
  const d = String(detail || "").trim();
  const lv = String(level || "info").trim().toLowerCase();
  const cls = (lv === "warn" || lv === "error") ? "warn" : (lv === "success" ? "success" : "info");
  const parts = [];
  parts.push(`<div class="corner-toast ${cls}">`);
  if (t) parts.push(`<div class="corner-title">${_escape(t)}</div>`);
  if (d) parts.push(`<div class="corner-detail">${_escape(d)}</div>`);
  parts.push(`</div>`);
  return parts.join("");
}

export function dismissCorner(key) {
  const k = String(key || "").trim();
  if (!k) return;
  const cur = _items.get(k);
  if (!cur) return;
  try { if (cur.timer) clearTimeout(cur.timer); } catch (_) {}
  try { if (cur.el && cur.el.parentNode) cur.el.parentNode.removeChild(cur.el); } catch (_) {}
  _items.delete(k);
}

export function notifyCorner(key, title, detail, opts = {}) {
  const k = String(key || "").trim();
  if (!k) return null;
  const ttlMs = Number.isFinite(Number(opts.ttlMs)) ? Number(opts.ttlMs) : 2400;
  const sticky = !!opts.sticky || ttlMs <= 0;
  const level = String(opts.level || "info").trim().toLowerCase();

  const host = _ensureContainer();
  let cur = _items.get(k) || null;
  if (cur && cur.el) {
    try { if (cur.timer) clearTimeout(cur.timer); } catch (_) {}
    try {
      const wrap = document.createElement("div");
      wrap.innerHTML = _renderToast({ title, detail, level });
      const el = wrap.firstElementChild;
      if (!el) throw new Error("empty_toast");
      if (typeof cur.el.replaceWith === "function") cur.el.replaceWith(el);
      else if (cur.el.parentNode) cur.el.parentNode.replaceChild(el, cur.el);
      cur.el = el;
    } catch (_) {
      // If replacement fails, fall back to recreate.
      try { if (cur.el && cur.el.parentNode) cur.el.parentNode.removeChild(cur.el); } catch (_) {}
      cur = null;
    }
  }
  if (!cur) {
    const wrap = document.createElement("div");
    wrap.innerHTML = _renderToast({ title, detail, level });
    const el = wrap.firstElementChild;
    if (!el) return null;
    host.appendChild(el);
    cur = { el, timer: 0 };
    _items.set(k, cur);
  }
  if (!sticky) {
    cur.timer = setTimeout(() => dismissCorner(k), _clamp(ttlMs, 300, 60 * 1000));
  }
  return cur.el || null;
}
