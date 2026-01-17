import { looksLikeCodeLine } from "./heuristics";

export function splitLeadingCodeBlock(text: unknown): { code: string; rest: string } {
  const src = String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!src.includes("\n")) return { code: "", rest: src };
  // 用户已显式用 fenced code block 时，保持原 Markdown。
  if (/^\s*```/m.test(src)) return { code: "", rest: src };

  const lines = src.split("\n");
  let matches = 0;
  let end = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = String(lines[i] ?? "");
    const t = raw.trimEnd();
    if (!t.trim()) {
      end = i + 1;
      continue;
    }
    if (looksLikeCodeLine(t)) {
      matches += 1;
      end = i + 1;
      continue;
    }
    // 确保不是误判：至少 3 行“代码/日志”才切分。
    if (matches >= 3) break;
    return { code: "", rest: src };
  }

  if (matches < 3) return { code: "", rest: src };
  const code = lines.slice(0, end).join("\n").trimEnd();
  const rest = lines.slice(end).join("\n").trim();
  return { code, rest };
}

