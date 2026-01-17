import { decorateRow } from "./core.js";

let _scheduled = false;
let _queue = [];

function _nowMs() {
  try {
    // Node 18+ and modern browsers.
    if (typeof performance !== "undefined" && performance && typeof performance.now === "function") return performance.now();
  } catch (_) {}
  return Date.now();
}

function _drain(deadlineMs) {
  const budget = Number.isFinite(Number(deadlineMs)) ? Number(deadlineMs) : 10;
  const start = _nowMs();
  while (_queue.length) {
    const row = _queue.pop();
    if (!row || row.nodeType !== 1) continue;
    try { row.__decorateQueued = false; } catch (_) {}
    // Skip detached rows (e.g. view evicted before drain).
    try { if (row.isConnected === false) continue; } catch (_) {}
    try { decorateRow(row); } catch (_) {}
    if ((_nowMs() - start) >= budget) break;
  }
  if (_queue.length) _scheduleDrain();
}

function _scheduleDrain() {
  if (_scheduled) return;
  _scheduled = true;
  const run = (deadline) => {
    _scheduled = false;
    let ms = 10;
    try {
      if (deadline && typeof deadline.timeRemaining === "function") {
        ms = Math.max(6, Math.min(18, Number(deadline.timeRemaining()) || 10));
      }
    } catch (_) {}
    _drain(ms);
  };
  try {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 180 });
      return;
    }
  } catch (_) {}
  setTimeout(() => run(null), 0);
}

export function queueDecorateRow(row) {
  if (!row || row.nodeType !== 1) return;
  try { if (row.__decorateQueued) return; } catch (_) {}
  try { row.__decorateQueued = true; } catch (_) {}
  _queue.push(row);
  _scheduleDrain();
}

