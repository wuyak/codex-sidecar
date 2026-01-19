import { flashToastAt } from "./utils/toast.js";

const _LS_KEY = "codex_sidecar_quick_view_blocks_v1";
const _STYLE_ID = "quickViewCustomStyle";

const _BLOCKS = [
  { id: "user_message", label: "用户输入", selector: ".row.kind-user_message" },
  { id: "assistant_message", label: "回答", selector: ".row.kind-assistant_message" },
  { id: "reasoning_summary", label: "思考摘要", selector: ".row.kind-reasoning_summary" },
  { id: "tool_gate", label: "终端确认", selector: ".row.kind-tool_gate" },
  { id: "tool_call", label: "工具调用", selector: ".row.kind-tool_call:not(.tool-update_plan)" },
  { id: "tool_output", label: "工具输出", selector: ".row.kind-tool_output" },
  { id: "update_plan", label: "更新计划", selector: ".row.tool-update_plan" },
];

const _DEFAULT_V1 = new Set(["user_message", "assistant_message", "reasoning_summary", "update_plan"]);
const _DEFAULT = new Set(["user_message", "assistant_message", "reasoning_summary", "tool_gate", "update_plan"]);

function _knownIds() {
  return new Set(_BLOCKS.map((b) => b.id));
}

function _setError(dom, msg) {
  try { if (dom && dom.quickBlocksErrorText) dom.quickBlocksErrorText.textContent = String(msg || ""); } catch (_) {}
}

function _sanitizeEnabled(raw) {
  const known = _knownIds();
  const out = new Set();
  const arr = Array.isArray(raw) ? raw : [];
  for (const it of arr) {
    const k = String(it || "").trim();
    if (!k) continue;
    if (!known.has(k)) continue;
    out.add(k);
  }
  if (out.size <= 0) return new Set(_DEFAULT);
  return out;
}

function _setEquals(a, b) {
  const sa = a instanceof Set ? a : new Set();
  const sb = b instanceof Set ? b : new Set();
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

function _loadEnabled() {
  try {
    const raw = localStorage.getItem(_LS_KEY);
    if (!raw) return new Set(_DEFAULT);
    const obj = JSON.parse(raw);
    let enabled = null;
    let v = 0;
    if (Array.isArray(obj)) {
      enabled = _sanitizeEnabled(obj);
    } else if (obj && typeof obj === "object" && Array.isArray(obj.enabled)) {
      enabled = _sanitizeEnabled(obj.enabled);
      v = Number(obj.v) || 0;
    }
    if (!enabled) return new Set(_DEFAULT);

    // Migration: old default didn't include tool_gate. If user never customized (still exactly old default),
    // auto-enable tool_gate so the "默认" reflects current expectations.
    try {
      const shouldUpgrade = _setEquals(enabled, _DEFAULT_V1) && !enabled.has("tool_gate");
      if (shouldUpgrade) {
        const next = new Set(enabled);
        next.add("tool_gate");
        try {
          localStorage.setItem(_LS_KEY, JSON.stringify({ v: Math.max(2, v || 0), enabled: Array.from(next) }));
        } catch (_) {}
        return next;
      }
    } catch (_) {}

    return enabled;
  } catch (_) {
    return new Set(_DEFAULT);
  }
}

function _saveEnabled(enabled) {
  try {
    const arr = Array.from(enabled || []);
    localStorage.setItem(_LS_KEY, JSON.stringify({ v: 1, enabled: arr }));
    return true;
  } catch (_) {
    return false;
  }
}

function _ensureStyleEl() {
  try {
    const exist = document.getElementById(_STYLE_ID);
    if (exist && exist.tagName === "STYLE") return exist;
  } catch (_) {}
  try {
    const el = document.createElement("style");
    el.id = _STYLE_ID;
    document.head.appendChild(el);
    return el;
  } catch (_) {
    return null;
  }
}

function _applyQuickStyle(enabled) {
  const el = _ensureStyleEl();
  if (!el) return;
  const on = enabled instanceof Set ? enabled : new Set();
  const lines = [];
  // Override the default quick-view filter so every block can be toggled on/off.
  // Keep topbar / empty placeholder always visible.
  lines.push(`body.quick-view.quick-custom .row { display: none; }`);
  lines.push(`body.quick-view.quick-custom #topbar.row { display: flex; }`);
  lines.push(`body.quick-view.quick-custom .row.row-empty { display: block; }`);
  for (const b of _BLOCKS) {
    if (!on.has(b.id)) continue;
    lines.push(`body.quick-view.quick-custom ${b.selector} { display: block; }`);
  }
  try { el.textContent = lines.join("\n"); } catch (_) {}
}

function _updateSummary(dom, enabled) {
  const known = _knownIds();
  const on = enabled instanceof Set ? enabled : new Set();
  const total = _BLOCKS.length;
  const selected = Array.from(on).filter((x) => known.has(x)).length;
  try {
    if (dom && dom.quickBlocksSummary) dom.quickBlocksSummary.textContent = `已选 ${selected}/${total}`;
  } catch (_) {}
}

function _render(dom, state, enabled) {
  const list = dom && dom.quickBlockList ? dom.quickBlockList : null;
  if (!list) return;

  try { list.innerHTML = ""; } catch (_) {}

  const on = enabled instanceof Set ? enabled : new Set();
  _updateSummary(dom, on);

  for (const b of _BLOCKS) {
    const row = document.createElement("label");
    row.className = "qk-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "qk-check";
    input.checked = on.has(b.id);
    input.dataset.qk = b.id;
    const mark = document.createElement("span");
    mark.className = "qk-mark";
    mark.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "qk-name";
    name.textContent = b.label;
    const meta = document.createElement("span");
    meta.className = "meta qk-kind";
    meta.textContent = b.id;
    row.appendChild(input);
    row.appendChild(mark);
    row.appendChild(name);
    row.appendChild(meta);
    list.appendChild(row);

    input.addEventListener("change", () => {
      const id = String(input.dataset.qk || "").trim();
      if (!id) return;
      _setError(dom, "");
      if (input.checked) on.add(id);
      else on.delete(id);
      _applyQuickStyle(on);
      try { if (state && state.quickViewBlocks) state.quickViewBlocks = new Set(on); } catch (_) {}
      const ok = _saveEnabled(on);
      if (!ok) _setError(dom, "保存失败：无法写入本机 localStorage");
      _updateSummary(dom, on);
    });
  }
}

export function initQuickViewSettings(dom, state) {
  // Enable custom quick-view filters. If this init fails, CSS fallback still works.
  try { document.body.classList.add("quick-custom"); } catch (_) {}

  const enabled = _loadEnabled();
  try { if (state) state.quickViewBlocks = new Set(enabled); } catch (_) {}
  _applyQuickStyle(enabled);
  _render(dom, state, enabled);

  if (dom && dom.quickBlocksResetBtn) {
    dom.quickBlocksResetBtn.addEventListener("click", () => {
      const next = new Set(_DEFAULT);
      _setError(dom, "");
      try { if (state) state.quickViewBlocks = new Set(next); } catch (_) {}
      _applyQuickStyle(next);
      const ok = _saveEnabled(next);
      if (!ok) _setError(dom, "保存失败：无法写入本机 localStorage");
      _render(dom, state, next);
      try {
        const r = dom.quickBlocksResetBtn.getBoundingClientRect();
        flashToastAt(r.left + r.width / 2, r.top + r.height / 2, "已恢复默认", { isLight: true, durationMs: 1100 });
      } catch (_) {}
    });
  }
}
