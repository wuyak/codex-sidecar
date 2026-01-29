const _LS_HIDDEN = "codex_sidecar_hidden_threads_v1";
const _LS_SHOW_HIDDEN = "codex_sidecar_show_hidden_threads_v1";
const _LS_HIDDEN_CHILDREN_BY_PARENT = "codex_sidecar_hidden_children_by_parent_v1";

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
    try { window.dispatchEvent(new CustomEvent("hidden-threads-changed")); } catch (_) {}
  } catch (_) {}
}

export function loadHiddenChildrenByParent() {
  try {
    const raw = localStorage.getItem(_LS_HIDDEN_CHILDREN_BY_PARENT);
    const obj = JSON.parse(raw || "{}");
    if (!obj || typeof obj !== "object") return {};
    const out = {};
    for (const [pk0, arr0] of Object.entries(obj)) {
      const pk = _sanitizeKey(pk0);
      if (!pk) continue;
      const arr = Array.isArray(arr0) ? arr0 : [];
      const kids = arr.map(_sanitizeKey).filter(Boolean);
      if (kids.length) out[pk] = kids;
    }
    return out;
  } catch (_) {
    return {};
  }
}

export function saveHiddenChildrenByParent(map) {
  try { localStorage.setItem(_LS_HIDDEN_CHILDREN_BY_PARENT, JSON.stringify(map || {})); } catch (_) {}
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
