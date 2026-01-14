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

export function keyOf(msg) {
  return (msg.thread_id || msg.file || "unknown");
}

export function shortId(s) {
  if (!s) return "";
  if (s.length <= 10) return s;
  return s.slice(0, 6) + "…" + s.slice(-4);
}

export function hashHue(s) {
  const str = String(s ?? "");
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 360;
}

export function colorForKey(key) {
  const hue = hashHue(key);
  return {
    fg: `hsl(${hue} 85% 42%)`,
    border: `hsla(${hue} 85% 42% / .45)`,
    bgActive: `hsl(${hue} 85% 38%)`,
    dotBg: `hsla(${hue} 85% 42% / .18)`,
  };
}

export function escapeHtml(s) {
  const str = String(s ?? "");
  return str.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    if (ch === "'") return "&#39;";
    return ch;
  });
}

export function safeJsonParse(s) {
  const raw = String(s ?? "").trim();
  if (!raw) return null;
  if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export function safeDomId(s) {
  const raw = String(s ?? "");
  if (!raw) return "";
  return raw.replace(/[^a-z0-9_-]/gi, "_");
}

export function extractJsonOutputString(s) {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  const obj = safeJsonParse(raw);
  if (obj && typeof obj === "object") {
    if (typeof obj.output === "string") return String(obj.output || "");
    if (typeof obj.stdout === "string") return String(obj.stdout || "");
    if (typeof obj.message === "string") return String(obj.message || "");
  }
  return "";
}

export async function copyToClipboard(text) {
  const t = String(text ?? "");
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch (_) {}
  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "readonly");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return !!ok;
  } catch (_) {
    return false;
  }
}

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
