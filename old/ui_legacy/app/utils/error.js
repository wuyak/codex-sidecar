export function fmtErr(e) {
  try {
    if (!e) return "unknown";
    if (typeof e === "string") return e;
    const msg = e.message ? String(e.message) : String(e);
    const st = e.stack ? String(e.stack) : "";
    return st ? `${msg}\n${st}` : msg;
  } catch (_) {
    return "unknown";
  }
}

