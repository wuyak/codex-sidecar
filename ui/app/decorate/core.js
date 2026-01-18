import { wireHoldCopy } from "./copy_hold.js";
import { toggleToolDetailsFromPre, wireToolToggles } from "./tool_toggle.js";
import { renderMathInMd } from "../math.js";

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
        onTap: isCode ? (e) => toggleToolDetailsFromPre(pre, e) : null,
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
      try { renderMathInMd(md); } catch (_) {}
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
