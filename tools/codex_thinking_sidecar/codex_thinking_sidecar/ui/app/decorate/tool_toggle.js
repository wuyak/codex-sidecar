export function toggleToolDetailsFromPre(pre) {
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

export function wireToolToggles(root) {
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

