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

let _ctx = null; // AudioContext
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

function _getAudioCtx() {
  if (_ctx) return _ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _ctx = new AC();
    return _ctx;
  } catch (_) {
    _ctx = null;
    return null;
  }
}

function _resumeCtx() {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === "suspended" && typeof ctx.resume === "function") ctx.resume();
  } catch (_) {}
}

function _playSynth(base, volume) {
  const ctx = _getAudioCtx();
  if (!ctx) return false;
  try { _resumeCtx(); } catch (_) {}

  const now = ctx.currentTime || 0;
  const v = Math.max(0.01, Math.min(1, Number(volume) || 0.28));

  const tone = (t0, { freq, dur, type = "sine", gain = 1.0 }) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter ? ctx.createBiquadFilter() : null;
    osc.type = type;
    osc.frequency.value = Math.max(80, Number(freq) || 440);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * (Number(gain) || 1.0)), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.03, Number(dur) || 0.08));
    if (f) {
      // Soften harshness a bit.
      f.type = "lowpass";
      f.frequency.value = 3800;
      osc.connect(f);
      f.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + Math.max(0.06, Number(dur) || 0.08) + 0.02);
  };

  // Three tasteful, UI-like synth tones (no external assets required).
  if (base === "soft-1") {
    tone(now + 0.00, { freq: 880, dur: 0.08, type: "sine", gain: 0.90 });
  } else if (base === "soft-2") {
    tone(now + 0.00, { freq: 660, dur: 0.07, type: "triangle", gain: 0.85 });
    tone(now + 0.06, { freq: 990, dur: 0.06, type: "triangle", gain: 0.60 });
  } else if (base === "soft-3") {
    tone(now + 0.00, { freq: 523.25, dur: 0.10, type: "sine", gain: 0.80 });
    tone(now + 0.08, { freq: 659.25, dur: 0.12, type: "sine", gain: 0.70 });
  } else {
    tone(now + 0.00, { freq: 880, dur: 0.08, type: "sine", gain: 0.90 });
  }
  return true;
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
    try { _resumeCtx(); } catch (_) {}
    try { preloadNotifySound(state); } catch (_) {}
  };
  try { window.addEventListener("pointerdown", unlock, { once: true, capture: true }); } catch (_) {}
  try { window.addEventListener("keydown", unlock, { once: true, capture: true }); } catch (_) {}
}

export function preloadNotifySound(state) {
  const r = _resolve(state && state.notifySound);
  if (!r.base) return;
  // Prefer synth sounds; no preload needed (and avoid creating AudioContext without a user gesture).
  if (_ctx) return;
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
  if (!src && !r.base) return false;

  const now = Date.now();
  if (now - _lastPlayMs < 1500) return false;
  _lastPlayMs = now;

  try {
    if (_ctx && _playSynth(r.base, r.volume || 0.28)) return true;
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
