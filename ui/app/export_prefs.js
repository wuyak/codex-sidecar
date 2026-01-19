export const LS_EXPORT_PREFS = "codex_sidecar_export_prefs_v1";
const _LS_EXPORT_QUICK_LEGACY = "codex_sidecar_export_quick_v1";
const _LS_EXPORT_TRANSLATE_LEGACY = "codex_sidecar_export_translate_v1";

function _boolFromAny(v, fallback) {
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return fallback;
}

function _normalizePrefs(p, fallback) {
  const fb = (fallback && typeof fallback === "object") ? fallback : { quick: true, translate: true };
  const o = (p && typeof p === "object") ? p : {};
  return {
    quick: _boolFromAny(o.quick, _boolFromAny(fb.quick, true)),
    translate: _boolFromAny(o.translate, _boolFromAny(fb.translate, true)),
  };
}

function _readLegacyDefaults() {
  try {
    if (typeof localStorage === "undefined") return { quick: true, translate: true };
    const quick = _boolFromAny(localStorage.getItem(_LS_EXPORT_QUICK_LEGACY), true);
    const translate = _boolFromAny(localStorage.getItem(_LS_EXPORT_TRANSLATE_LEGACY), true);
    return { quick, translate };
  } catch (_) {
    return { quick: true, translate: true };
  }
}

let _cache = null;

function _loadMap() {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = String(localStorage.getItem(LS_EXPORT_PREFS) || "").trim();
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    return obj;
  } catch (_) {
    return {};
  }
}

function _saveMap(map) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(LS_EXPORT_PREFS, JSON.stringify(map || {}));
  } catch (_) {}
}

export function getExportPrefsForKey(key) {
  const k = String(key || "").trim();
  if (!k || k === "all") return _readLegacyDefaults();
  if (_cache == null) _cache = _loadMap();
  const hit = _cache && typeof _cache === "object" ? _cache[k] : null;
  if (hit && typeof hit === "object") return _normalizePrefs(hit, _readLegacyDefaults());
  return _readLegacyDefaults();
}

export function setExportPrefsForKey(key, prefs) {
  const k = String(key || "").trim();
  if (!k || k === "all") return _readLegacyDefaults();
  if (_cache == null) _cache = _loadMap();
  const next = _normalizePrefs(prefs, _readLegacyDefaults());
  try {
    _cache[k] = next;
    _saveMap(_cache);
  } catch (_) {}
  return next;
}

export function clearExportPrefsForKey(key) {
  const k = String(key || "").trim();
  if (!k || k === "all") return;
  if (_cache == null) _cache = _loadMap();
  try {
    delete _cache[k];
    _saveMap(_cache);
  } catch (_) {}
}

