import { flashToastAt } from "./utils/toast.js";

const _cache = new Map(); // url -> Audio

let _unlockHooked = false;
let _lastPlayMs = 0;
let _warnedBlocked = false;

function _clamp(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

function _pickId(state, kind) {
  const k = String(kind || "assistant").trim().toLowerCase();
  if (k === "tool_gate") return String(state && state.notifySoundToolGate ? state.notifySoundToolGate : "none").trim() || "none";
  return String(state && state.notifySoundAssistant ? state.notifySoundAssistant : "none").trim() || "none";
}

function _resolveSpec(state, id) {
  const sid = String(id || "").trim();
  if (!sid || sid === "none") return null;

  try {
    const idx = (state && state.sfxIndex && typeof state.sfxIndex.get === "function") ? state.sfxIndex : null;
    const hit = idx ? idx.get(sid) : null;
    if (hit && typeof hit === "object") {
      const url = String(hit.url || "").trim();
      if (!url) return null;
      return {
        url,
        volume: _clamp(hit.volume, 0.0, 2.0, 1.0),
        rate: _clamp(hit.rate, 0.5, 2.0, 1.0),
      };
    }
  } catch (_) {}

  // Fallback: derive URL from id (when /api/sfx hasn't been loaded yet).
  if (sid.startsWith("builtin:")) {
    const name = sid.slice("builtin:".length).trim().toLowerCase();
    if (!name) return null;
    return { url: `/ui/sfx/builtin/${name}.wav`, volume: 1.0, rate: 1.0 };
  }
  if (sid.startsWith("file:")) {
    const name = sid.slice("file:".length).trim();
    if (!name) return null;
    return { url: `/api/sfx/file/${encodeURIComponent(name)}`, volume: 1.0, rate: 1.0 };
  }
  return null;
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

  // Browsers may block audio until a user gesture; preload after first interaction.
  const unlock = () => {
    try { preloadNotifySound(state); } catch (_) {}
  };
  try { window.addEventListener("pointerdown", unlock, { once: true, capture: true }); } catch (_) {}
  try { window.addEventListener("keydown", unlock, { once: true, capture: true }); } catch (_) {}
}

export function preloadNotifySound(state) {
  const ids = [];
  try { ids.push(_pickId(state, "assistant")); } catch (_) {}
  try { ids.push(_pickId(state, "tool_gate")); } catch (_) {}
  for (const id of ids) {
    const spec = _resolveSpec(state, id);
    if (!spec || !spec.url) continue;
    if (_cache.has(spec.url)) continue;
    try {
      const a = new Audio(spec.url);
      a.preload = "auto";
      a.load();
      _cache.set(spec.url, a);
    } catch (_) {}
  }
}

export function maybePlayNotifySound(dom, state, opts = {}) {
  const kind = String(opts && opts.kind ? opts.kind : "assistant").trim().toLowerCase();
  const force = !!(opts && opts.force);

  const id = _pickId(state, kind);
  const spec = _resolveSpec(state, id);
  if (!spec || !spec.url) return false;

  const now = Date.now();
  const minGapMs = 320;
  if (!force && (now - _lastPlayMs) < minGapMs) return false;
  _lastPlayMs = now;

  let a = null;
  try { a = _cache.get(spec.url) || null; } catch (_) { a = null; }
  if (!a) {
    try {
      a = new Audio(spec.url);
      _cache.set(spec.url, a);
    } catch (_) {
      return false;
    }
  }

  try { a.volume = _clamp(spec.volume, 0.0, 1.0, 1.0); } catch (_) {}
  try { a.playbackRate = _clamp(spec.rate, 0.5, 2.0, 1.0); } catch (_) {}
  try { a.currentTime = 0; } catch (_) {}

  try {
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => _toastBlocked(dom));
    return true;
  } catch (_) {
    _toastBlocked(dom);
    return false;
  }
}
