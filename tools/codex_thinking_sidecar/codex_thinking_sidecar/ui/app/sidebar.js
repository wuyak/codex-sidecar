import { colorForKey, keyOf, shortId } from "./utils.js";

export function isSidebarCollapsed() {
  try { return document.body.classList.contains("sidebar-collapsed"); } catch (_) { return false; }
}

export function setSidebarCollapsed(dom, v) {
  try { document.body.classList.toggle("sidebar-collapsed", !!v); } catch (_) {}
  try { if (dom.sidebarToggleBtn) dom.sidebarToggleBtn.textContent = v ? "⟫" : "⟪"; } catch (_) {}
}

function rolloutStampFromFile(filePath) {
  try {
    const base = (filePath || "").split("/").slice(-1)[0] || "";
    const m = base.match(new RegExp("^rollout-(\\d{4}-\\d{2}-\\d{2})T(\\d{2}-\\d{2}-\\d{2})-"));
    if (!m) return "";
    return `${m[1]} ${String(m[2] || "").replace(/-/g, ":")}`;
  } catch (e) {
    return "";
  }
}

function threadLabel(t) {
  const stamp = rolloutStampFromFile(t.file || "");
  const idPart = t.thread_id ? shortId(t.thread_id) : shortId(((t.file || "").split("/").slice(-1)[0]) || (t.key || ""));
  if (stamp && idPart) return `${stamp} · ${idPart}`;
  return idPart || stamp || "unknown";
}

export function clearTabs(dom) {
  const tabs = dom.tabs;
  if (!tabs) return;
  while (tabs.firstChild) tabs.removeChild(tabs.firstChild);
}

export function upsertThread(state, msg) {
  const key = keyOf(msg);
  const prev = state.threadIndex.get(key) || { key, thread_id: msg.thread_id || "", file: msg.file || "", count: 0, last_ts: "" };
  prev.count = (prev.count || 0) + 1;
  const ts = msg.ts || "";
  if (ts && (!prev.last_ts || ts > prev.last_ts)) prev.last_ts = ts;
  state.threadIndex.set(key, prev);
}

export function renderTabs(dom, state, onSelectKey) {
  const tabs = dom.tabs;
  if (!tabs) return;
  const collapsed = isSidebarCollapsed();
  const items = Array.from(state.threadIndex.values()).sort((a, b) => (b.last_ts || "").localeCompare(a.last_ts || ""));
  clearTabs(dom);

  const allBtn = document.createElement("button");
  allBtn.className = "tab" + (state.currentKey === "all" ? " active" : "");
  allBtn.textContent = collapsed ? "≡" : "全部";
  allBtn.title = "全部";
  allBtn.onclick = () => onSelectKey("all");
  tabs.appendChild(allBtn);

  for (const t of items) {
    const btn = document.createElement("button");
    btn.className = "tab" + (state.currentKey === t.key ? " active" : "");
    const clr = colorForKey(t.key || "");
    const label = threadLabel(t);
    if (collapsed) {
      btn.textContent = "●";
      try {
        btn.style.color = clr.fg;
        btn.style.borderColor = clr.border;
        if (state.currentKey === t.key) {
          btn.style.background = clr.bgActive;
          btn.style.color = "#fff";
        } else {
          btn.style.background = "#fff";
        }
      } catch (_) {}
      const full = t.thread_id || t.file || t.key || "";
      btn.title = `${label} (${t.count || 0})${full ? "\n" + full : ""}`;
    } else {
      try { btn.style.borderColor = clr.border; } catch (_) {}
      const dot = document.createElement("span");
      dot.className = "tab-dot";
      try { dot.style.background = clr.fg; } catch (_) {}
      const labelSpan = document.createElement("span");
      labelSpan.textContent = label;
      const small = document.createElement("small");
      small.textContent = `(${t.count || 0})`;
      btn.appendChild(dot);
      btn.appendChild(labelSpan);
      btn.appendChild(small);
      btn.title = t.thread_id || t.file || t.key;
    }
    btn.onclick = () => onSelectKey(t.key);
    tabs.appendChild(btn);
  }
}

