import { copyToClipboard } from "./utils.js";

function decoratePreBlocks(root) {
  if (!root || !root.querySelectorAll) return;
  const pres = root.querySelectorAll("pre");
  for (const pre of pres) {
    try {
      if (!pre || !pre.parentElement) continue;
      if (pre.parentElement.classList && pre.parentElement.classList.contains("pre-wrap")) continue;
      const wrap = document.createElement("div");
      wrap.className = "pre-wrap";
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
        btn.textContent = ok ? "✓" : "!";
        setTimeout(() => { btn.textContent = icon; }, 650);
      };
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(btn);
      wrap.appendChild(pre);
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
        const swapId = btn.getAttribute("data-swap") || "";
        let swapEl = null;
        if (swapId) {
          try { swapEl = document.getElementById(swapId); } catch (_) {}
        }
        const willHide = !el.classList.contains("hidden");
        if (willHide) el.classList.add("hidden");
        else el.classList.remove("hidden");
        if (swapEl) {
          if (willHide) swapEl.classList.remove("hidden");
          else swapEl.classList.add("hidden");
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

