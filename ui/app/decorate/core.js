import { wireHoldCopy } from "./copy_hold.js";
import { toggleToolDetailsFromPre, wireToolToggles } from "./tool_toggle.js";
import { renderMathInMd } from "../math.js";

function _textForCopyFromMd(md) {
  if (!md || md.nodeType !== 1) return "";
  try {
    const clone = md.cloneNode(true);

    // Replace KaTeX blocks with their TeX annotation so copy preserves "$$...$$" instead of MathML noise.
    const replaceWithTeX = (node, displayMode) => {
      try {
        const ann = node && node.querySelector ? node.querySelector('annotation[encoding="application/x-tex"]') : null;
        const tex = ann ? String(ann.textContent || "").trim() : "";
        if (!tex) return null;
        if (displayMode) return `\n$$\n${tex}\n$$\n`;
        return `$${tex}$`;
      } catch (_) {
        return null;
      }
    };

    // Display math: replace the outer wrapper to avoid duplicates.
    const displays = clone.querySelectorAll ? clone.querySelectorAll(".katex-display") : [];
    for (const d of displays) {
      const rep = replaceWithTeX(d, true);
      if (!rep) continue;
      try { d.replaceWith(document.createTextNode(rep)); } catch (_) {}
    }

    // Inline math: any remaining .katex not inside a display wrapper.
    const inlines = clone.querySelectorAll ? clone.querySelectorAll(".katex") : [];
    for (const k of inlines) {
      try {
        if (k.closest && k.closest(".katex-display")) continue;
      } catch (_) {}
      const rep = replaceWithTeX(k, false);
      if (!rep) continue;
      try { k.replaceWith(document.createTextNode(rep)); } catch (_) {}
    }

    // Prefer innerText to preserve list/newline formatting similar to what's visible.
    return String(clone.innerText || clone.textContent || "").trim();
  } catch (_) {
    return String(md.innerText || md.textContent || "").trim();
  }
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
        getText: () => _textForCopyFromMd(md),
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
