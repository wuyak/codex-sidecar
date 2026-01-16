export function statusIcon(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed" || s === "done") return "done";
  if (s === "in_progress" || s === "running") return "run";
  if (s === "pending" || s === "todo") return "todo";
  if (s === "canceled" || s === "cancelled") return "skip";
  if (s === "failed" || s === "error") return "fail";
  return "-";
}
