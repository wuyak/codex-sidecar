const LS_QUICK_VIEW_BLOCKS = "codex_sidecar_quick_view_blocks_v1";
const KNOWN_QUICK_BLOCKS = new Set(["user_message", "assistant_message", "reasoning_summary", "tool_gate", "tool_call", "tool_output", "update_plan"]);
const DEFAULT_QUICK_BLOCKS = new Set(["user_message", "assistant_message", "reasoning_summary", "tool_gate", "update_plan"]);

function sanitizeQuickBlocks(raw) {
  const src = raw instanceof Set ? Array.from(raw) : (Array.isArray(raw) ? raw : []);
  const out = new Set();
  for (const x of src) {
    const k = String(x || "").trim();
    if (!k) continue;
    if (!KNOWN_QUICK_BLOCKS.has(k)) continue;
    out.add(k);
  }
  return out.size > 0 ? out : null;
}

function loadQuickBlocksFromLocalStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = String(localStorage.getItem(LS_QUICK_VIEW_BLOCKS) || "").trim();
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (Array.isArray(obj)) return sanitizeQuickBlocks(obj);
    if (obj && typeof obj === "object" && Array.isArray(obj.enabled)) return sanitizeQuickBlocks(obj.enabled);
  } catch (_) {}
  return null;
}

export function getQuickBlocks(state) {
  try {
    const raw = state && state.quickViewBlocks ? state.quickViewBlocks : null;
    const fromState = sanitizeQuickBlocks(raw);
    if (fromState) return fromState;
  } catch (_) {}
  try {
    const fromLs = loadQuickBlocksFromLocalStorage();
    if (fromLs) return fromLs;
  } catch (_) {}
  return new Set(DEFAULT_QUICK_BLOCKS);
}

