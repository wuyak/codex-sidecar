import { closeBookmarkDrawer } from "../../ui.js";
import { offlineKeyFromRel } from "../../../offline.js";
import { saveOfflineShowList, upsertOfflineShow } from "../../../offline_show.js";

const normalizeRelForImport = (raw) => {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  // Strip accidental wrapping quotes from copy/paste.
  try {
    const a = s.startsWith("\"") && s.endsWith("\"");
    const b = s.startsWith("'") && s.endsWith("'");
    if (a || b) s = s.slice(1, -1).trim();
  } catch (_) {}
  // Normalize separators + strip file:// prefix (if any).
  s = s.replace(/^file:\/*/i, "");
  s = s.replaceAll("\\", "/");

  // Best-effort: extract canonical rel from absolute paths like:
  // - /home/.../.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
  // - \\wsl.localhost\\...\\.codex\\sessions\\YYYY\\MM\\DD\\rollout-*.jsonl
  try {
    const m = s.match(/(?:^|\/)(sessions\/\d{4}\/\d{2}\/\d{2}\/rollout-[^\/]+\.jsonl)\b/i);
    if (m && m[1]) return String(m[1]).replaceAll("\\", "/");
  } catch (_) {}

  // Fallback: take the tail after the last "/sessions/".
  try {
    const lower = s.toLowerCase();
    let idx = lower.lastIndexOf("/sessions/");
    if (idx >= 0) idx += 1; // keep "sessions/..."
    else idx = lower.lastIndexOf("sessions/");
    if (idx >= 0) s = s.slice(idx);
  } catch (_) {}

  while (s.startsWith("/")) s = s.slice(1);
  return s;
};

export function createOpenOfflineRel(dom, state, helpers = {}) {
  const h = (helpers && typeof helpers === "object") ? helpers : {};
  const onSelectKey = typeof h.onSelectKey === "function" ? h.onSelectKey : (async () => {});
  const renderTabs = typeof h.renderTabs === "function" ? h.renderTabs : (() => {});
  const renderBookmarkDrawerList = typeof h.renderBookmarkDrawerList === "function" ? h.renderBookmarkDrawerList : (() => {});
  const setImportError = typeof h.setImportError === "function" ? h.setImportError : (() => {});

  return async (rel, meta = {}) => {
    let rel0 = normalizeRelForImport(rel);
    while (rel0.startsWith("/")) rel0 = rel0.slice(1);
    if (!rel0) return;
    // Echo back normalized rel so the user can see what's actually imported.
    try {
      const el = dom && dom.importRel ? dom.importRel : null;
      if (el && typeof el.value === "string") el.value = rel0;
    } catch (_) {}

    if (!rel0.startsWith("sessions/") || !/\/rollout-[^\/]+\.jsonl$/i.test(rel0)) {
      try { setImportError("请输入 sessions/**/rollout-*.jsonl（可直接粘贴完整路径）"); } catch (_) {}
      return;
    }
    const file = String(meta.file || "").trim();
    const tid = String(meta.thread_id || meta.threadId || "").trim();
    try { setImportError(""); } catch (_) {}
    try {
      const next = upsertOfflineShow(state.offlineShow, { rel: rel0, file, thread_id: tid });
      state.offlineShow = next;
      saveOfflineShowList(next);
    } catch (_) {}
    try { renderTabs(); } catch (_) {}
    try { renderBookmarkDrawerList(); } catch (_) {}
    const key = offlineKeyFromRel(rel0);
    await onSelectKey(key);
    try { if (dom && dom.importDialog && dom.importDialog.open) dom.importDialog.close(); } catch (_) {}
    closeBookmarkDrawer(dom);
  };
}

