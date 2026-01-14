import { copyToClipboard } from "./utils.js";

function flashCopied(wrap, isLight = false) {
  if (!wrap || !wrap.appendChild) return;
  try {
    const old = wrap.querySelector(".copy-toast");
    if (old && old.parentNode) old.parentNode.removeChild(old);
  } catch (_) {}
  const el = document.createElement("div");
  el.className = "copy-toast" + (isLight ? " light" : "");
  el.textContent = "已复制";
  wrap.appendChild(el);
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

function wirePreClickAndLongPress(pre) {
  if (!pre || pre.__wiredPress) return;
  try {
    // 仅对“代码块”启用点击展开/长按复制，避免影响普通 <pre> 文本。
    if (!pre.classList || !pre.classList.contains("code")) return;
  } catch (_) {}
  pre.__wiredPress = true;

  let startX = 0;
  let startY = 0;
  let moved = false;
  let timer = 0;
  let longFired = false;

  const clear = () => {
    try { if (timer) clearTimeout(timer); } catch (_) {}
    timer = 0;
  };

  const onDown = (e) => {
    try {
      // Only left click / primary touch.
      if (e && typeof e.button === "number" && e.button !== 0) return;
    } catch (_) {}
    moved = false;
    longFired = false;
    startX = Number(e && e.clientX) || 0;
    startY = Number(e && e.clientY) || 0;
    clear();
    timer = setTimeout(async () => {
      timer = 0;
      if (moved) return;
      longFired = true;
      try {
        const ok = await copyToClipboard(pre.textContent || "");
        if (ok) {
          const wrap = (pre.closest && pre.closest(".pre-wrap")) ? pre.closest(".pre-wrap") : null;
          flashCopied(wrap, false);
          pre.classList.add("copied");
          setTimeout(() => { try { pre.classList.remove("copied"); } catch (_) {} }, 750);
        }
      } catch (_) {}
    }, 420);
  };

  const onMove = (e) => {
    if (!timer) return;
    const x = Number(e && e.clientX) || 0;
    const y = Number(e && e.clientY) || 0;
    const dx = x - startX;
    const dy = y - startY;
    if ((dx * dx + dy * dy) > (6 * 6)) {
      moved = true;
      clear();
    }
  };

  const onUp = () => { clear(); };
  const onCancel = () => { clear(); };

  pre.addEventListener("pointerdown", onDown);
  pre.addEventListener("pointermove", onMove);
  pre.addEventListener("pointerup", onUp);
  pre.addEventListener("pointercancel", onCancel);
  pre.addEventListener("pointerleave", onCancel);

  pre.addEventListener("click", (e) => {
    try {
      if (longFired) { longFired = false; e.preventDefault(); e.stopPropagation(); return; }
      if (moved) return;
      if (hasActiveSelection()) return;
      toggleToolDetailsFromPre(pre);
    } catch (_) {}
  });
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
      const btn = document.createElement("button");
      btn.type = "button";
      const isDark = pre.classList && pre.classList.contains("code");
      btn.className = "copy-btn" + (isDark ? "" : " light");
      const icon = "⧉";
      btn.textContent = icon;
      btn.title = "复制";
      btn.setAttribute("aria-label", "复制");
      btn.onclick = async (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const ok = await copyToClipboard(pre.textContent || "");
        if (ok) flashCopied(wrap, !isDark);
        btn.textContent = ok ? "✓" : "!";
        setTimeout(() => { btn.textContent = icon; }, 650);
      };
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(btn);
      wrap.appendChild(pre);
      wirePreClickAndLongPress(pre);
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
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn light";
      const icon = "⧉";
      btn.textContent = icon;
      btn.title = "复制";
      btn.setAttribute("aria-label", "复制");
      btn.onclick = async (e) => {
        try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
        const ok = await copyToClipboard(md.innerText || md.textContent || "");
        if (ok) flashCopied(wrap, true);
        btn.textContent = ok ? "✓" : "!";
        setTimeout(() => { btn.textContent = icon; }, 650);
      };
      md.parentNode.insertBefore(wrap, md);
      wrap.appendChild(btn);
      wrap.appendChild(md);
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
  decoratePreBlocks(row);
  decorateMdBlocks(row);
  wireToolToggles(row);
}
