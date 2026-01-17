import { flashToastAt } from "./utils/toast.js";

const _SOUND_VARIANTS = {
  "soft-1-low": { base: "soft-1", volume: 0.18 },
  "soft-1": { base: "soft-1", volume: 0.28 },
  "soft-1-high": { base: "soft-1", volume: 0.42 },
  "soft-2-low": { base: "soft-2", volume: 0.18 },
  "soft-2": { base: "soft-2", volume: 0.28 },
  "soft-2-high": { base: "soft-2", volume: 0.42 },
  "soft-3-low": { base: "soft-3", volume: 0.18 },
  "soft-3": { base: "soft-3", volume: 0.28 },
  "soft-3-high": { base: "soft-3", volume: 0.42 },
};
const _cache = new Map(); // base -> Audio

let _unlockHooked = false;
let _lastPlayMs = 0;
let _warnedBlocked = false;

function _sanitizeId(id) {
  const s = String(id || "").trim().toLowerCase();
  if (!s || s === "none") return "none";
  return (s in _SOUND_VARIANTS) ? s : "none";
}

function _resolve(id) {
  const sid = _sanitizeId(id);
  if (sid === "none") return { base: "", volume: 0 };
  const spec = _SOUND_VARIANTS[sid];
  if (!spec) return { base: "", volume: 0 };
  const base = String(spec.base || "").trim().toLowerCase();
  const volume = Math.max(0.01, Math.min(1, Number(spec.volume) || 0.28));
  return { base, volume };
}

function _srcForId(id) {
  const r = _resolve(id);
  if (!r.base) return "";
  return `/ui/music/${r.base}.ogg`;
}

function _toastBlocked(dom) {
  if (_warnedBlocked) return;
  _warnedBlocked = true;
  const btn = (dom && (dom.translateToggleBtn || dom.configToggleBtn)) ? (dom.translateToggleBtn || dom.configToggleBtn) : null;
  if (!btn || !btn.getBoundingClientRect) return;
  try {
    const r = btn.getBoundingClientRect();
    flashToastAt(r.left + r.width / 2, r.top + r.height / 2, "提示音被浏览器阻止：请点击页面后再试", { isLight: true, durationMs: 1800 });
  } catch (_) {}
}

export function initSound(dom, state) {
  if (_unlockHooked) return;
  _unlockHooked = true;

  const unlock = () => {
    try { preloadNotifySound(state); } catch (_) {}
  };
  try { window.addEventListener("pointerdown", unlock, { once: true, capture: true }); } catch (_) {}
  try { window.addEventListener("keydown", unlock, { once: true, capture: true }); } catch (_) {}
}

export function preloadNotifySound(state) {
  const r = _resolve(state && state.notifySound);
  if (!r.base) return;
  const src = _srcForId(r.base);
  if (!src) return;
  if (_cache.has(r.base)) return;
  try {
    const a = new Audio(src);
    a.preload = "auto";
    a.load();
    _cache.set(r.base, a);
  } catch (_) {}
}

export function maybePlayNotifySound(dom, state) {
  const r = _resolve(state && state.notifySound);
  const src = _srcForId(r.base);
  if (!src) return false;

  const now = Date.now();
  if (now - _lastPlayMs < 1500) return false;
  _lastPlayMs = now;

  try {
    // Use a fresh element each time to allow overlaps if needed; browser cache keeps it fast.
    const a = new Audio(src);
    a.volume = r.volume || 0.28;
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => _toastBlocked(dom));
    return true;
  } catch (_) {
    return false;
  }
}
