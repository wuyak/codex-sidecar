import { flashToastAt } from "./utils/toast.js";

const _SOUND_IDS = ["soft-1", "soft-2", "soft-3"];
const _cache = new Map(); // id -> Audio

let _unlockHooked = false;
let _lastPlayMs = 0;
let _warnedBlocked = false;

function _sanitizeId(id) {
  const s = String(id || "").trim().toLowerCase();
  if (!s || s === "none") return "none";
  return _SOUND_IDS.includes(s) ? s : "none";
}

function _srcForId(id) {
  const sid = _sanitizeId(id);
  if (sid === "none") return "";
  return `/ui/music/${sid}.ogg`;
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
  const id = _sanitizeId(state && state.notifySound);
  const src = _srcForId(id);
  if (!src) return;
  if (_cache.has(id)) return;
  try {
    const a = new Audio(src);
    a.preload = "auto";
    a.load();
    _cache.set(id, a);
  } catch (_) {}
}

export function maybePlayNotifySound(dom, state) {
  const id = _sanitizeId(state && state.notifySound);
  const src = _srcForId(id);
  if (!src) return false;

  const now = Date.now();
  if (now - _lastPlayMs < 1500) return false;
  _lastPlayMs = now;

  try {
    // Use a fresh element each time to allow overlaps if needed; browser cache keeps it fast.
    const a = new Audio(src);
    a.volume = 0.28;
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => _toastBlocked(dom));
    return true;
  } catch (_) {
    return false;
  }
}

