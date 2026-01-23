const parseYmdFromRel = (rel) => {
  const r = String(rel || "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = r.split("/");
  if (parts.length < 5) return null;
  if (parts[0] !== "sessions") return null;
  const y = String(parts[1] || "");
  const m = String(parts[2] || "");
  const d = String(parts[3] || "");
  if (!/^\d{4}$/.test(y)) return null;
  if (!/^\d{2}$/.test(m)) return null;
  if (!/^\d{2}$/.test(d)) return null;
  return { y, m, d };
};

export function buildImportIndex(files) {
  const list = Array.isArray(files) ? files : [];

  const byDate = new Map(); // YYYY-MM-DD -> items[]
  const countByMonth = new Map(); // YYYY-MM -> count
  const countByYear = new Map(); // YYYY -> count
  const other = [];
  let minT = null;
  let maxT = null;

  for (const it of list) {
    const rel = String((it && it.rel) ? it.rel : "").trim();
    if (!rel) continue;
    const ymd = parseYmdFromRel(rel);
    if (!ymd) { other.push(it); continue; }
    const { y, m, d } = ymd;
    const dayKey = `${y}-${m}-${d}`;
    const monthKey = `${y}-${m}`;
    const yearKey = String(y);

    if (!byDate.has(dayKey)) byDate.set(dayKey, []);
    try { byDate.get(dayKey).push(it); } catch (_) {}

    try { countByMonth.set(monthKey, Number(countByMonth.get(monthKey) || 0) + 1); } catch (_) {}
    try { countByYear.set(yearKey, Number(countByYear.get(yearKey) || 0) + 1); } catch (_) {}

    const dt = new Date(Number(y), Number(m) - 1, Number(d));
    const t = Number(dt.getTime());
    if (Number.isFinite(t)) {
      if (minT === null || t < minT) minT = t;
      if (maxT === null || t > maxT) maxT = t;
    }
  }

  const minDate = (minT === null) ? null : new Date(minT);
  const maxDate = (maxT === null) ? null : new Date(maxT);
  return { byDate, countByMonth, countByYear, minDate, maxDate, other };
}

