export function keyOf(msg: { thread_id?: string; file?: string } | null | undefined): string {
  if (!msg) return "unknown";
  return (msg.thread_id || msg.file || "unknown").toString();
}

export function shortId(s: string): string {
  if (!s) return "";
  if (s.length <= 10) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

const ROLLOUT_STAMP_RE = /^rollout-(\d{4}-\d{2}-\d{2})T(\d{2}-\d{2}-\d{2})-/;

export function rolloutStampFromFile(filePath: string): string {
  try {
    const base = (filePath || "").split("/").slice(-1)[0] || "";
    const m = base.match(ROLLOUT_STAMP_RE);
    if (!m) return "";
    return `${m[1]} ${String(m[2] || "").replace(/-/g, ":")}`;
  } catch (_) {
    return "";
  }
}

