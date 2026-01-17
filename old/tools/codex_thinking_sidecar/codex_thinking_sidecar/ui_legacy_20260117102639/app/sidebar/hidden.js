const _LS_HIDDEN = "codex_sidecar_hidden_threads_v1";
const _LS_SHOW_HIDDEN = "codex_sidecar_show_hidden_threads_v1";

function _sanitizeKey(k) {
  return String(k || "").trim();
}

export function loadHiddenThreads() {
  try {
    const raw = localStorage.getItem(_LS_HIDDEN);
    const arr = JSON.parse(raw || "[]");
    if (!Array.isArray(arr)) return new Set();
    const s = new Set();
    for (const x of arr) {
      const k = _sanitizeKey(x);
      if (k) s.add(k);
    }
    return s;
  } catch (_) {
    return new Set();
  }
}

export function saveHiddenThreads(set) {
  try {
    const arr = Array.from(set || []).map(_sanitizeKey).filter(Boolean);
    localStorage.setItem(_LS_HIDDEN, JSON.stringify(arr));
  } catch (_) {}
}

export function loadShowHiddenFlag() {
  try {
    return localStorage.getItem(_LS_SHOW_HIDDEN) === "1";
  } catch (_) {
    return false;
  }
}

export function saveShowHiddenFlag(on) {
  try { localStorage.setItem(_LS_SHOW_HIDDEN, on ? "1" : "0"); } catch (_) {}
}

