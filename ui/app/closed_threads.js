const _LS_CLOSED = "codex_sidecar_closed_threads_v1";
const _LS_CLOSED_PID = "codex_sidecar_closed_threads_pid_v1";
const _MAX_ITEMS = 200;
const _MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7d
const _DIALOG_KINDS = ["assistant_message", "user_message", "reasoning_summary"];

function _now() {
  return Date.now();
}

function _sanitizeKey(k) {
  const s = String(k || "").trim();
  if (!s) return "";
  // Thread key is either uuid thread_id or file path; both can be long.
  return s.length > 1024 ? s.slice(0, 1024) : s;
}

function _sanitizeInfo(v) {
  const o = (v && typeof v === "object") ? v : {};
  const at_seq = Number(o.at_seq) || 0;
  const at_count = Number(o.at_count) || 0;
  const at_ts = String(o.at_ts || "");
  const at_ms = Number(o.at_ms) || 0;
  const kk = (o.at_kinds && typeof o.at_kinds === "object") ? o.at_kinds : {};
  const at_kinds = {
    assistant_message: Number(kk.assistant_message) || 0,
    user_message: Number(kk.user_message) || 0,
    reasoning_summary: Number(kk.reasoning_summary) || 0,
  };
  return { at_seq, at_count, at_ts, at_ms, at_kinds };
}

function _dialogKindsFromThread(t) {
  const tt = (t && typeof t === "object") ? t : {};
  const kk = (tt.kinds && typeof tt.kinds === "object") ? tt.kinds : {};
  return {
    assistant_message: Number(kk.assistant_message) || 0,
    user_message: Number(kk.user_message) || 0,
    reasoning_summary: Number(kk.reasoning_summary) || 0,
  };
}

function _hasNewDialogKinds(curKinds, atKinds) {
  const cur = (curKinds && typeof curKinds === "object") ? curKinds : {};
  const at = (atKinds && typeof atKinds === "object") ? atKinds : {};
  for (const k of _DIALOG_KINDS) {
    const c = Number(cur[k]) || 0;
    const a = Number(at[k]) || 0;
    if (c > a) return true;
  }
  return false;
}

export function loadClosedThreads() {
  try {
    const raw = localStorage.getItem(_LS_CLOSED);
    if (!raw) return new Map();
    const obj = JSON.parse(raw);
    const items = (obj && typeof obj === "object") ? (obj.items || obj) : null;
    if (!items || typeof items !== "object") return new Map();
    const out = new Map();
    for (const [k0, v] of Object.entries(items)) {
      const k = _sanitizeKey(k0);
      if (!k) continue;
      out.set(k, _sanitizeInfo(v));
    }
    return out;
  } catch (_) {
    return new Map();
  }
}

export function saveClosedThreads(map) {
  const m = map && typeof map.get === "function" ? map : new Map();
  const entries = [];
  for (const [k0, v] of m.entries()) {
    const k = _sanitizeKey(k0);
    if (!k) continue;
    const info = _sanitizeInfo(v);
    const at_ms = info.at_ms || 0;
    entries.push([k, { ...info, at_ms }]);
  }
  entries.sort((a, b) => (Number(b[1].at_ms) || 0) - (Number(a[1].at_ms) || 0));
  const keep = entries.slice(0, _MAX_ITEMS);
  const obj = { v: 1, items: Object.fromEntries(keep) };
  try { localStorage.setItem(_LS_CLOSED, JSON.stringify(obj)); } catch (_) {}
}

export function resetClosedThreadsOnProcessChange(state, pid) {
  const curPid = String(pid == null ? "" : pid).trim();
  if (!curPid) return { ok: false, changed: false, reason: "no_pid" };

  let prevPid = "";
  try { prevPid = String(localStorage.getItem(_LS_CLOSED_PID) || "").trim(); } catch (_) { prevPid = ""; }

  const changed = !!(prevPid && prevPid !== curPid);
  if (changed) {
    try {
      const m = (state && state.closedThreads && typeof state.closedThreads.clear === "function")
        ? state.closedThreads
        : null;
      if (m) m.clear();
    } catch (_) {}
    try { saveClosedThreads(new Map()); } catch (_) {}
  }
  try { localStorage.setItem(_LS_CLOSED_PID, curPid); } catch (_) {}
  return { ok: true, changed };
}

export function pruneClosedThreads(state) {
  const closed = (state && state.closedThreads && typeof state.closedThreads.entries === "function")
    ? state.closedThreads
    : null;
  const idx = (state && state.threadIndex && typeof state.threadIndex.get === "function")
    ? state.threadIndex
    : null;
  if (!closed || !idx) return;

  const now = _now();
  let changed = false;
  for (const [k0, info0] of closed.entries()) {
    const k = _sanitizeKey(k0);
    if (!k) { try { closed.delete(k0); changed = true; } catch (_) {} continue; }
    const hadKinds = !!(info0 && typeof info0 === "object" && Object.prototype.hasOwnProperty.call(info0, "at_kinds"));
    const info = _sanitizeInfo(info0);
    const t = idx.get(k);
    if (t && typeof t === "object") {
      const lastTs = String((t && t.last_ts) ? t.last_ts : "");
      const atTs = String(info.at_ts || "");
      const curKinds = _dialogKindsFromThread(t);

      // Migration: legacy entries may lack at_ts or at_kinds. Snapshot baseline so replay won't pop it back.
      if (!atTs && lastTs) {
        try { closed.set(k, { ...info, at_ts: lastTs, at_ms: info.at_ms || now, at_kinds: info.at_kinds || curKinds }); } catch (_) {}
        changed = true;
        continue;
      }
      if (!hadKinds) {
        try {
          closed.set(k, { ...info, at_ms: info.at_ms || now, at_kinds: curKinds, at_ts: atTs || lastTs });
        } catch (_) {}
        changed = true;
        continue;
      }

      // Unclose when any meaningful content advances beyond the baseline.
      // Note: tool_gate does not bump last_seq/count in upsertThread, so it won't wake cleared sessions.
      const curSeq = Math.max(0, Number(t && t.last_seq) || 0);
      const curCount = Math.max(0, Number(t && t.count) || 0);
      const atSeq = Math.max(0, Number(info.at_seq) || 0);
      const atCount = Math.max(0, Number(info.at_count) || 0);
      const hasNew = (curSeq > atSeq)
        || (curCount > atCount)
        || (lastTs && atTs && lastTs > atTs)
        || _hasNewDialogKinds(curKinds, info.at_kinds);
      if (hasNew) {
        try { closed.delete(k0); } catch (_) {}
        changed = true;
      } else if (!info.at_ms) {
        try { closed.set(k, { ...info, at_ms: now, at_kinds: info.at_kinds }); } catch (_) {}
        changed = true;
      }
    } else {
      const at = Number(info.at_ms) || 0;
      if (at && (now - at) > _MAX_AGE_MS) {
        try { closed.delete(k0); } catch (_) {}
        changed = true;
      }
    }
  }
  if (changed) saveClosedThreads(closed);
}
