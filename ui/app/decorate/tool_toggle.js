import { stabilizeClickWithin } from "../utils/anchor.js";

export function toggleToolDetailsFromPre(pre, ev) {
  try {
    const row = pre && pre.closest ? pre.closest(".row") : null;
    if (!row || !row.querySelector) return false;
    const id = (pre && pre.getAttribute) ? String(pre.getAttribute("id") || "") : "";
    let btn = null;
    if (id) {
      btn = row.querySelector(`button.tool-toggle[data-target="${id}"]`);
      if (!btn) btn = row.querySelector(`button.tool-toggle[data-swap="${id}"]`);
    }
    if (!btn) {
      const all = row.querySelectorAll("button.tool-toggle[data-target]");
      if (all && all.length === 1) btn = all[0];
    }
    if (!btn) return false;
    const y = Number(ev && ev.clientY) || 0;
    const targetId = btn.getAttribute ? String(btn.getAttribute("data-target") || "") : "";
    const swapId = btn.getAttribute ? String(btn.getAttribute("data-swap") || "") : "";
    let targetWrap = null;
    let swapWrap = null;
    if (targetId) {
      try { const el = document.getElementById(targetId); targetWrap = (el && el.closest) ? (el.closest(".pre-wrap") || el) : el; } catch (_) {}
    }
    if (swapId) {
      try { const el = document.getElementById(swapId); swapWrap = (el && el.closest) ? (el.closest(".pre-wrap") || el) : el; } catch (_) {}
    }
    btn.click();
    try {
      // Keep the click landing inside the visible code block after toggle (avoid "click misses" due to height changes).
      let anchor = null;
      if (swapWrap && swapWrap.classList && !swapWrap.classList.contains("hidden")) anchor = swapWrap;
      else if (targetWrap && targetWrap.classList && !targetWrap.classList.contains("hidden")) anchor = targetWrap;
      else anchor = (pre && pre.closest) ? (pre.closest(".pre-wrap") || row) : row;
      stabilizeClickWithin(anchor, y);
    } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

export function wireToolToggles(root) {
  if (!root || !root.querySelectorAll) return;
  const btns = root.querySelectorAll("button.tool-toggle[data-target]");
  for (const btn of btns) {
    try {
      if (btn.__wired) continue;
      btn.__wired = true;
      btn.onclick = (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const y = Number(e && e.clientY) || 0;
        const id = btn.getAttribute("data-target") || "";
        if (!id) return;
        let el = null;
        try { el = document.getElementById(id); } catch (_) {}
        if (!el) return;
        let elWrap = el;
        try { elWrap = (el.closest && el.closest(".pre-wrap")) ? el.closest(".pre-wrap") : el; } catch (_) {}
        const swapId = btn.getAttribute("data-swap") || "";
        let swapEl = null;
        if (swapId) {
          try { swapEl = document.getElementById(swapId); } catch (_) {}
        }
        let swapWrap = swapEl;
        try { swapWrap = (swapEl && swapEl.closest && swapEl.closest(".pre-wrap")) ? swapEl.closest(".pre-wrap") : swapEl; } catch (_) {}

        const willHide = !elWrap.classList.contains("hidden");
        if (willHide) elWrap.classList.add("hidden");
        else elWrap.classList.remove("hidden");
        if (swapWrap) {
          if (willHide) swapWrap.classList.remove("hidden");
          else swapWrap.classList.add("hidden");
        }
        btn.textContent = willHide ? "详情" : "收起";
        try {
          const anchor = (swapWrap && swapWrap.classList && !swapWrap.classList.contains("hidden"))
            ? swapWrap
            : elWrap;
          stabilizeClickWithin(anchor || row || elWrap || btn, y);
        } catch (_) {}
      };
    } catch (_) {}
  }
}
