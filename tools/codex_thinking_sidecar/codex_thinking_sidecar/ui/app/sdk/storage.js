// 存储：SDK 选中会话（localStorage）

export const _LS_THREAD_ID = "codex_sidecar_sdk_thread_id_v1";

export function _readStoredThreadId() {
  try {
    const v = String(localStorage.getItem(_LS_THREAD_ID) || "").trim();
    return v;
  } catch (_) {
    return "";
  }
}

export function _writeStoredThreadId(threadId) {
  const v = String(threadId || "").trim();
  try { localStorage.setItem(_LS_THREAD_ID, v); } catch (_) {}
}
