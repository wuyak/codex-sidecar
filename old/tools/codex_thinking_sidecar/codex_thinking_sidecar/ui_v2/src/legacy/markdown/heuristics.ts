export function looksLikeCodeLine(ln: unknown): boolean {
  const t = String(ln ?? "").trim();
  if (!t) return false;
  if (/^(Added|Edited|Deleted|Created|Updated|Removed)\s+/.test(t)) return true;
  if (/^\d+\s*[+-]\s/.test(t)) return true; // e.g. "1 +import ..."
  if (/^\*\*\*\s+(Begin Patch|Add File|Update File|Delete File):\s+/.test(t)) return true;
  if (/^diff --git\s+/.test(t)) return true;
  if (/^@@\s/.test(t) || t.startsWith("@@")) return true;
  if (/^[+-](?!\s)/.test(t)) return true; // "+foo" / "-bar" (avoid "- bullet")
  if (/^(import|from|export|function|const|let|var|class)\b/.test(t)) return true;
  if (/^(Traceback|Exception|Error:)\b/.test(t)) return true;
  return false;
}

