export function statusIcon(status) {
  const s = String(status || "").toLowerCase();
  // Prefer terminal-like symbols (better scanability than "done/run/todo").
  if (s === "completed" || s === "done") return "✔";
  if (s === "in_progress" || s === "running") return "↻";
  if (s === "pending" || s === "todo") return "○";
  if (s === "canceled" || s === "cancelled") return "↷";
  if (s === "failed" || s === "error") return "✖";
  return "·";
}
