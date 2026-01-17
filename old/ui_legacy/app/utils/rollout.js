const _ROLLOUT_STAMP_RE = /^rollout-(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})-/;

export function rolloutStampFromFile(filePath) {
  try {
    const base = String(filePath || "").split("/").slice(-1)[0] || "";
    const m = base.match(_ROLLOUT_STAMP_RE);
    if (!m) return "";
    return `${m[1]} ${String(m[2] || "").replace(/-/g, ":")}`;
  } catch (_) {
    return "";
  }
}

