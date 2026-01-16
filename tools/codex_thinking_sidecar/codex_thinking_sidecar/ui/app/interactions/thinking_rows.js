import { flashToastAt } from "../utils/toast.js";
import { stabilizeClickWithin } from "../utils/anchor.js";
import { buildThinkingMetaRight } from "../thinking/meta.js";

function _defaultThinkMode(hasZh) {
  return hasZh ? "zh" : "en";
}

function _setThinkModeOverride(state, mid, mode, hasZh) {
  const k = String(mid || "").trim();
  const m = String(mode || "").trim().toLowerCase();
  if (!k) return;
  const next = (m === "en" || m === "zh") ? m : _defaultThinkMode(!!hasZh);
  const def = _defaultThinkMode(!!hasZh);
  try {
    if (!state.thinkModeById || typeof state.thinkModeById.get !== "function") state.thinkModeById = new Map();
    if (!Array.isArray(state.thinkModeOrder)) state.thinkModeOrder = [];

    if (next === def) state.thinkModeById.delete(k);
    else state.thinkModeById.set(k, next);
    state.thinkModeOrder.push(k);
    const max = Number(state.thinkModeMax) || 600;
    if (state.thinkModeById.size > max) {
      while (state.thinkModeById.size > max && state.thinkModeOrder.length) {
        const victim = state.thinkModeOrder.shift();
        if (!victim) continue;
        if (state.thinkModeById.has(victim) && state.thinkModeById.size > max) state.thinkModeById.delete(victim);
      }
    }
  } catch (_) {}
}

function _getRowThinkMode(row) {
  if (!row || !row.classList) return "en";
  return row.classList.contains("think-mode-zh") ? "zh" : "en";
}

function _hasZhReady(row) {
  try {
    const zhEl = row.querySelector ? row.querySelector(".think-zh") : null;
    const txt = zhEl ? String(zhEl.textContent || "") : "";
    return !!txt.trim();
  } catch (_) {
    return false;
  }
}

function _getCachedZhClean(state, mid) {
  const id = String(mid || "").trim();
  if (!id) return "";
  try {
    const cache = (state && state.mdCache && typeof state.mdCache.get === "function") ? state.mdCache : null;
    if (!cache) return "";
    const v = cache.get(`md:${id}:think_zh`);
    if (v && typeof v === "object" && typeof v.text === "string") return String(v.text || "");
  } catch (_) {}
  return "";
}

function _hasActiveSelection() {
  try {
    const sel = window.getSelection && window.getSelection();
    if (!sel) return false;
    if (sel.type === "Range") return true;
    const s = String(sel.toString() || "").trim();
    return !!s;
  } catch (_) {}
  return false;
}

function _updateThinkingMetaRight(state, row, mid) {
  if (!row) return;
  const metaRight = row.querySelector ? row.querySelector(".meta-right") : null;
  if (!metaRight) return;
  const hasZh = _hasZhReady(row);
  const err = String((row.dataset && row.dataset.translateError) ? row.dataset.translateError : "").trim();
  const inFlight = !!(state.translateInFlight && typeof state.translateInFlight.has === "function" && state.translateInFlight.has(mid));
  const isAgent = !!(row && row.classList && row.classList.contains("kind-agent_reasoning"));
  const translateMode = isAgent ? "manual" : ((String(state.translateMode || "").toLowerCase() === "manual") ? "manual" : "auto");
  const provider = String(state.translatorProvider || "").trim().toLowerCase();
  try {
    metaRight.innerHTML = buildThinkingMetaRight({ mid, provider, hasZh, err, translateMode, inFlight });
  } catch (_) {}
}

async function _postRetranslate(mid) {
  const id = String(mid || "").trim();
  if (!id) return { ok: false, error: "missing_id" };
  try {
    const resp = await fetch("/api/control/retranslate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    let obj = null;
    try { obj = await resp.json(); } catch (_) { obj = null; }
    const ok = !!(resp && resp.ok && obj && obj.ok !== false && obj.queued !== false);
    const err = String((obj && obj.error) ? obj.error : (resp && !resp.ok ? `http_status=${resp.status}` : "") || "").trim();
    return { ok, error: err };
  } catch (_) {
    return { ok: false, error: "request_failed" };
  }
}

export function wireThinkingRowActions(dom, state) {
  const host = state && state.listHost ? state.listHost : (dom && dom.list ? dom.list : null);
  if (!host || !host.addEventListener) return;

  host.addEventListener("click", async (e) => {
    if (!e || !e.target) return;
    if (_hasActiveSelection()) return;

    // Do not hijack link clicks inside markdown.
    try { if (e.target.closest && e.target.closest("a")) return; } catch (_) {}

    // 1) Explicit translate button (always available).
    const btn = e.target.closest ? e.target.closest("[data-think-act='retranslate']") : null;
    if (btn) {
      const mid = String(btn.dataset && btn.dataset.mid ? btn.dataset.mid : "").trim();
      if (!mid) return;
      const row = btn.closest ? btn.closest(".row") : null;
      const hadZh = !!(row && _hasZhReady(row));
      const oldZh = hadZh ? _getCachedZhClean(state, mid) : "";
      try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
      try {
        const p = String(state.translatorProvider || "").trim().toLowerCase();
        if (p === "none") {
          flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "未启用翻译（Provider=none）", { isLight: true });
          return;
        }
      } catch (_) {}
      const alreadyInFlight = !!(state.translateInFlight && typeof state.translateInFlight.has === "function" && state.translateInFlight.has(mid));
      let addedInFlight = false;
      try {
        if (!state.translateInFlight || typeof state.translateInFlight.add !== "function") state.translateInFlight = new Set();
        if (!alreadyInFlight) {
          state.translateInFlight.add(mid);
          addedInFlight = true;
        }
      } catch (_) {}
      _updateThinkingMetaRight(state, row, mid);
      const r = await _postRetranslate(mid);
      if (!r.ok) {
        const err = String(r.error || "unknown_error");
        try { if (addedInFlight) state.translateInFlight.delete(mid); } catch (_) {}
        try { if (row && row.dataset) row.dataset.translateError = err; } catch (_) {}
        _updateThinkingMetaRight(state, row, mid);
        flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, `重译失败：${err}`, { isLight: true });
      } else {
        // “重译完成”提示：仅在用户点击过“重译”且该条已有译文时触发（避免首次翻译刷屏）。
        if (hadZh) {
          try {
            if (!state.retranslatePending || typeof state.retranslatePending.set !== "function") state.retranslatePending = new Map();
            state.retranslatePending.set(mid, { oldZh, x: Number(e.clientX) || 0, y: Number(e.clientY) || 0 });
          } catch (_) {}
        }
      }
      return;
    }

    // 2) Clicking the thinking block:
    // - manual mode: trigger translation when ZH is missing
    // - after ZH ready: toggle EN/ZH
    const think = e.target.closest ? e.target.closest(".think") : null;
    if (!think) return;
    const row = think.closest ? think.closest(".row") : null;
    if (!row || !row.classList) return;
    if (!(row.classList.contains("kind-reasoning_summary") || row.classList.contains("kind-agent_reasoning"))) return;
    const mid = String((row.dataset && row.dataset.msgId) ? row.dataset.msgId : "").trim();
    if (!mid) return;

    const hasZh = _hasZhReady(row);
    if (!hasZh) {
      const isAgent = !!(row && row.classList && row.classList.contains("kind-agent_reasoning"));
      const tmode = isAgent ? "manual" : ((String(state.translateMode || "").toLowerCase() === "manual") ? "manual" : "auto");
      if (tmode !== "manual") {
        const err = String((row.dataset && row.dataset.translateError) ? row.dataset.translateError : "").trim();
        flashToastAt(
          Number(e.clientX) || 0,
          Number(e.clientY) || 0,
          err ? "翻译失败，点“翻译/重试”重发" : "等待翻译…",
          { isLight: true },
        );
        return;
      }
      try {
        const p = String(state.translatorProvider || "").trim().toLowerCase();
        if (p === "none") {
          flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "未启用翻译（Provider=none）", { isLight: true });
          return;
        }
      } catch (_) {}
      const inFlight = !!(state.translateInFlight && typeof state.translateInFlight.has === "function" && state.translateInFlight.has(mid));
      if (inFlight) {
        flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, "正在翻译…", { isLight: true });
        return;
      }
      try {
        if (!state.translateInFlight || typeof state.translateInFlight.add !== "function") state.translateInFlight = new Set();
        state.translateInFlight.add(mid);
      } catch (_) {}
      _updateThinkingMetaRight(state, row, mid);
      const r = await _postRetranslate(mid);
      if (!r.ok) {
        const err = String(r.error || "unknown_error");
        try { state.translateInFlight.delete(mid); } catch (_) {}
        try { if (row && row.dataset) row.dataset.translateError = err; } catch (_) {}
        _updateThinkingMetaRight(state, row, mid);
        flashToastAt(Number(e.clientX) || 0, Number(e.clientY) || 0, `翻译失败：${err}`, { isLight: true });
      }
      return;
    }

    // ZH ready: toggle EN/ZH.
    const cur = _getRowThinkMode(row);
    const next = (cur === "zh") ? "en" : "zh";
    _setThinkModeOverride(state, mid, next, true);
    try {
      row.classList.remove("think-mode-en", "think-mode-zh", "think-mode-both");
      row.classList.add(`think-mode-${next}`);
    } catch (_) {}
    _updateThinkingMetaRight(state, row, mid);
    try { stabilizeClickWithin(row, Number(e && e.clientY) || 0); } catch (_) {}
  });
}
