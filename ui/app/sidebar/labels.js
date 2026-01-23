const _LABELS_KEY = "codex_sidecar_thread_labels_v1";
let _labelsCache = null;

function _loadLabels() {
  if (_labelsCache) return _labelsCache;
  try {
    const raw = localStorage.getItem(_LABELS_KEY) || "";
    const obj = raw ? JSON.parse(raw) : {};
    if (obj && typeof obj === "object") _labelsCache = obj;
    else _labelsCache = {};
  } catch (_) {
    _labelsCache = {};
  }
  return _labelsCache;
}

function _saveLabels(obj) {
  _labelsCache = obj || {};
  try { localStorage.setItem(_LABELS_KEY, JSON.stringify(_labelsCache)); } catch (_) {}
}

export function getCustomLabel(key) {
  const k = String(key || "").trim();
  if (!k) return "";
  const obj = _loadLabels();
  const v = (obj && typeof obj === "object") ? obj[k] : "";
  return String(v || "").trim();
}

export function setCustomLabel(key, label) {
  const k = String(key || "").trim();
  if (!k) return;
  const v = String(label || "").trim();
  const obj = { ..._loadLabels() };
  if (!v) delete obj[k];
  else obj[k] = v;
  _saveLabels(obj);
}

