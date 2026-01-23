export function formatTs(ts) {
  if (!ts && ts !== 0) return { utc: "", local: "" };
  try {
    const raw = ts;
    let d = null;
    let n = null;
    if (typeof raw === "number") n = raw;
    else {
      const s = String(raw).trim();
      if (/^\d+(\.\d+)?$/.test(s)) n = Number(s);
    }
    if (Number.isFinite(n)) {
      // Codex JSONL 的 timestamp 常见为 epoch seconds；浏览器 Date 需要毫秒。
      const ms = (n < 1e12) ? Math.round(n * 1000) : Math.round(n);
      d = new Date(ms);
    } else {
      d = new Date(raw);
    }
    if (!d || isNaN(d.getTime())) return { utc: String(ts), local: "" };
    const bj = d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
    return { utc: String(ts), local: bj };
  } catch (e) {
    return { utc: String(ts), local: "" };
  }
}

export function tsToMs(ts) {
  if (!ts && ts !== 0) return NaN;
  try {
    const raw = ts;
    let n = null;
    if (typeof raw === "number") n = raw;
    else {
      const s = String(raw).trim();
      if (/^\d+(\.\d+)?$/.test(s)) n = Number(s);
    }
    if (Number.isFinite(n)) {
      const ms = (n < 1e12) ? Math.round(n * 1000) : Math.round(n);
      return ms;
    }
    const ms = Date.parse(String(raw));
    return Number.isFinite(ms) ? ms : NaN;
  } catch (_) {
    return NaN;
  }
}

