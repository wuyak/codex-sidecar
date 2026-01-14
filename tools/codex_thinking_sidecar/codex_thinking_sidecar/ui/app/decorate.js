import { copyToClipboard } from "./utils.js";

function clamp(n, a, b) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.min(b, Math.max(a, x));
}

function flashCopiedAt(x, y, isLight = false) {
  const el = document.createElement("div");
  el.className = "copy-toast fixed" + (isLight ? " light" : "");
  el.textContent = "已复制";
  el.style.left = "0px";
  el.style.top = "0px";
  document.body.appendChild(el);
  try {
    const rect = el.getBoundingClientRect();
    const pad = 12;
    const dx = 14;
    const dy = 14;
    let left = Number(x || 0) + dx;
    let top = Number(y || 0) + dy;
    if (left + rect.width + pad > window.innerWidth) left = Number(x || 0) - rect.width - dx;
    if (top + rect.height + pad > window.innerHeight) top = window.innerHeight - rect.height - pad;
    left = clamp(left, pad, Math.max(pad, window.innerWidth - rect.width - pad));
    top = clamp(top, pad, Math.max(pad, window.innerHeight - rect.height - pad));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  } catch (_) {}
  setTimeout(() => {
    try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (_) {}
  }, 1300);
}

function hasActiveSelection() {
  try {
    const sel = window.getSelection && window.getSelection();
    if (!sel) return false;
    if (sel.type === "Range") return true;
    const s = String(sel.toString() || "").trim();
    return !!s;
  } catch (_) {
    return false;
  }
}

function toggleToolDetailsFromPre(pre) {
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
    btn.click();
    return true;
  } catch (_) {
    return false;
  }
}

function wireHoldCopy(el, opts) {
  if (!el || el.__wiredPress) return;
  el.__wiredPress = true;

  let startX = 0;
  let startY = 0;
  let startAt = 0;
  let moved = false;
  let longFired = false;

  const onDown = (e) => {
    try {
      // Only left click / primary touch.
      if (e && typeof e.button === "number" && e.button !== 0) return;
    } catch (_) {}
    try {
      if (opts && opts.ignoreSelector && e && e.target && e.target.closest) {
        if (e.target.closest(String(opts.ignoreSelector))) return;
      }
    } catch (_) {}
    moved = false;
    longFired = false;
    startX = Number(e && e.clientX) || 0;
    startY = Number(e && e.clientY) || 0;
    startAt = Date.now();
  };

  const onMove = (e) => {
    if (!startAt) return;
    const x = Number(e && e.clientX) || 0;
    const y = Number(e && e.clientY) || 0;
    const dx = x - startX;
    const dy = y - startY;
    if ((dx * dx + dy * dy) > (6 * 6)) {
      moved = true;
    }
  };

  const onUp = async () => {
    if (!startAt) return;
    const dt = Date.now() - startAt;
    startAt = 0;
    if (moved) return;
    if (dt < 420) return;
    if (hasActiveSelection()) return;
    longFired = true;
    try {
      const txt = (opts && typeof opts.getText === "function") ? opts.getText() : (el.textContent || "");
      const ok = await copyToClipboard(txt || "");
      if (ok) {
        flashCopiedAt(startX, startY, !!(opts && opts.toastIsLight));
        try { el.classList.add("copied"); } catch (_) {}
        setTimeout(() => { try { el.classList.remove("copied"); } catch (_) {} }, 750);
      }
    } catch (_) {}
  };

  const onCancel = () => {
    startAt = 0;
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onCancel);
  el.addEventListener("pointerleave", onCancel);

  el.addEventListener("click", (e) => {
    try {
      if (longFired) { longFired = false; e.preventDefault(); e.stopPropagation(); return; }
      if (moved) return;
      if (hasActiveSelection()) return;
      if (opts && typeof opts.onTap === "function") opts.onTap(e);
    } catch (_) {}
  });
}

function decorateToolCards(root) {
  if (!root || !root.querySelectorAll) return;
  const cards = root.querySelectorAll("div.tool-card");
  for (const card of cards) {
    try {
      if (!card) continue;
      try {
        wireHoldCopy(card, {
          ignoreSelector: "pre,div.md,button,a,input,textarea,select,summary",
          toastIsLight: true,
          getText: () => {
            const parts = [];
            const nodes = card.querySelectorAll("pre.code, div.md, pre");
            for (const el of nodes) {
              try {
                if (!el) continue;
                if (el.closest && el.closest(".hidden")) continue;
                if (el.tagName === "DIV" && el.classList && el.classList.contains("md")) {
                  const t = String(el.innerText || el.textContent || "").trim();
                  if (t) parts.push(t);
                } else if (el.tagName === "PRE") {
                  const t = String(el.textContent || "").trimEnd();
                  if (t) parts.push(t);
                }
              } catch (_) {}
            }
            return parts.join("\n\n").trim();
          },
          onTap: null,
        });
      } catch (_) {}
    } catch (_) {}
  }
}

function decoratePreBlocks(root) {
  if (!root || !root.querySelectorAll) return;
  const pres = root.querySelectorAll("pre");
  for (const pre of pres) {
    try {
      if (!pre || !pre.parentElement) continue;
      if (pre.parentElement.classList && pre.parentElement.classList.contains("pre-wrap")) continue;
      const wasHidden = pre.classList && pre.classList.contains("hidden");
      const wrap = document.createElement("div");
      wrap.className = "pre-wrap";
      if (wasHidden) {
        wrap.classList.add("hidden");
        try { pre.classList.remove("hidden"); } catch (_) {}
      }
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);
      const isCode = !!(pre.classList && pre.classList.contains("code"));
      wireHoldCopy(pre, {
        getText: () => pre.textContent || "",
        toastIsLight: !isCode,
        onTap: isCode ? () => toggleToolDetailsFromPre(pre) : null,
      });
    } catch (_) {}
  }
}

function decorateMdBlocks(root) {
  if (!root || !root.querySelectorAll) return;
  const blocks = root.querySelectorAll("div.md");
  for (const md of blocks) {
    try {
      if (!md || !md.parentElement) continue;
      if (md.parentElement.classList && md.parentElement.classList.contains("pre-wrap")) continue;
      const wrap = document.createElement("div");
      wrap.className = "pre-wrap";
      md.parentNode.insertBefore(wrap, md);
      wrap.appendChild(md);
      wireHoldCopy(md, {
        getText: () => md.innerText || md.textContent || "",
        toastIsLight: true,
        onTap: null,
      });
    } catch (_) {}
  }
}

function wireToolToggles(root) {
  if (!root || !root.querySelectorAll) return;
  const btns = root.querySelectorAll("button.tool-toggle[data-target]");
  for (const btn of btns) {
    try {
      if (btn.__wired) continue;
      btn.__wired = true;
      btn.onclick = (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
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
      };
    } catch (_) {}
  }
}

export function decorateRow(row) {
  // cleanup legacy per-block copy buttons if any existed (older UI versions)
  try {
    const olds = row.querySelectorAll ? row.querySelectorAll(".copy-btn") : [];
    for (const b of olds) { try { if (b && b.parentNode) b.parentNode.removeChild(b); } catch (_) {} }
  } catch (_) {}
  decoratePreBlocks(row);
  decorateMdBlocks(row);
  decorateToolCards(row);
  wireToolToggles(row);
}
