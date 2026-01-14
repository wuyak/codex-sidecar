const statusText = document.getElementById("statusText");
      const debugText = document.getElementById("debugText");
      const cfgHome = document.getElementById("cfgHome");
      const watchHome = document.getElementById("watchHome");
      const autoStart = document.getElementById("autoStart");
      const followProc = document.getElementById("followProc");
      const onlyWhenProc = document.getElementById("onlyWhenProc");
      const procRegex = document.getElementById("procRegex");
      const replayLines = document.getElementById("replayLines");
      const includeAgent = document.getElementById("includeAgent");
      const displayMode = document.getElementById("displayMode");
      const pollInterval = document.getElementById("pollInterval");
      const scanInterval = document.getElementById("scanInterval");
      const translatorSel = document.getElementById("translator");
      const httpProfile = document.getElementById("httpProfile");
      const httpProfileAddBtn = document.getElementById("httpProfileAddBtn");
      const httpProfileRenameBtn = document.getElementById("httpProfileRenameBtn");
      const httpProfileDelBtn = document.getElementById("httpProfileDelBtn");
      const httpUrl = document.getElementById("httpUrl");
      const httpToken = document.getElementById("httpToken");
	      const httpTimeout = document.getElementById("httpTimeout");
	      const httpAuthEnv = document.getElementById("httpAuthEnv");
		      const saveBtn = document.getElementById("saveBtn");
		      const recoverBtn = document.getElementById("recoverBtn");
	      const sidebarToggleBtn = document.getElementById("sidebarToggleBtn");
	      const startBtn = document.getElementById("startBtn");
	      const stopBtn = document.getElementById("stopBtn");
	      const clearBtn = document.getElementById("clearBtn");
	      const configToggleBtn = document.getElementById("configToggleBtn");
	      const drawerOverlay = document.getElementById("drawerOverlay");
	      const drawer = document.getElementById("drawer");
	      const drawerCloseBtn = document.getElementById("drawerCloseBtn");
	      const shutdownBtn = document.getElementById("shutdownBtn");
	      const scrollTopBtn = document.getElementById("scrollTopBtn");
	      const scrollBottomBtn = document.getElementById("scrollBottomBtn");

      let httpProfiles = [];
      let httpSelected = "";

	      const tabs = document.getElementById("tabs");
	      const list = document.getElementById("list");
      let currentKey = "all";
      const threadIndex = new Map(); // key -> { key, thread_id, file, count, last_ts }
      const callIndex = new Map(); // call_id -> { tool_name, args_raw, args_obj }

	      function formatTs(ts) {
	        if (!ts) return { utc: "", local: "" };
	        try {
	          const d = new Date(ts);
	          if (isNaN(d.getTime())) return { utc: ts, local: "" };
	          // 默认按北京时间展示，减少跨时区/UTC 对照带来的视觉噪音。
	          const bj = d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
	          return { utc: ts, local: bj };
	        } catch (e) {
	          return { utc: ts, local: "" };
	        }
	      }

      function keyOf(msg) {
        return (msg.thread_id || msg.file || "unknown");
      }

      function shortId(s) {
        if (!s) return "";
        if (s.length <= 10) return s;
        return s.slice(0, 6) + "…" + s.slice(-4);
      }

      function escapeHtml(s) {
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

      function safeJsonParse(s) {
        const raw = String(s ?? "").trim();
        if (!raw) return null;
        if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
      }

      function safeDomId(s) {
        const raw = String(s ?? "");
        if (!raw) return "";
        return raw.replace(/[^a-z0-9_-]/gi, "_");
      }

      function extractJsonOutputString(s) {
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

      async function copyToClipboard(text) {
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

	      function decoratePreBlocks(root) {
        if (!root || !root.querySelectorAll) return;
        const pres = root.querySelectorAll("pre");
        for (const pre of pres) {
          try {
            if (!pre || !pre.parentElement) continue;
            if (pre.parentElement.classList && pre.parentElement.classList.contains("pre-wrap")) continue;
            const wrap = document.createElement("div");
            wrap.className = "pre-wrap";
	            const btn = document.createElement("button");
	            btn.type = "button";
	            const isDark = pre.classList && pre.classList.contains("code");
	            btn.className = "copy-btn" + (isDark ? "" : " light");
	            const icon = "⧉";
	            btn.textContent = icon;
	            btn.title = "复制";
	            btn.setAttribute("aria-label", "复制");
	            btn.onclick = async (e) => {
	              try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
	              const ok = await copyToClipboard(pre.textContent || "");
	              btn.textContent = ok ? "✓" : "!";
	              setTimeout(() => { btn.textContent = icon; }, 650);
	            };
            pre.parentNode.insertBefore(wrap, pre);
            wrap.appendChild(btn);
            wrap.appendChild(pre);
          } catch (_) {}
        }
      }

	      function decorateMdBlocks(root) {
        if (!root || !root.querySelectorAll) return;
        const blocks = root.querySelectorAll("div.md");
        for (const md of blocks) {
          try {
            if (!md || !md.parentElement) continue;
            if (md.parentElement.classList && md.parentElement.classList.contains("pre-wrap")) continue;
            const wrap = document.createElement("div");
            wrap.className = "pre-wrap";
	            const btn = document.createElement("button");
	            btn.type = "button";
	            btn.className = "copy-btn light";
	            const icon = "⧉";
	            btn.textContent = icon;
	            btn.title = "复制";
	            btn.setAttribute("aria-label", "复制");
	            btn.onclick = async (e) => {
	              try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
	              const ok = await copyToClipboard(md.innerText || md.textContent || "");
	              btn.textContent = ok ? "✓" : "!";
	              setTimeout(() => { btn.textContent = icon; }, 650);
	            };
            md.parentNode.insertBefore(wrap, md);
            wrap.appendChild(btn);
            wrap.appendChild(md);
          } catch (_) {}
        }
      }

      function wireToolToggles(root) {
        if (!root || !root.querySelectorAll) return;
        const btns = root.querySelectorAll("button.tool-toggle[data-target]");
        for (const btn of btns) {
          try {
            if (btn.__wired) continue;
            btn.__wired = true;
            btn.onclick = (e) => {
              try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
              const id = btn.getAttribute("data-target") || "";
              if (!id) return;
              let el = null;
              try { el = document.getElementById(id); } catch (_) {}
              if (!el) return;
              const swapId = btn.getAttribute("data-swap") || "";
              let swapEl = null;
              if (swapId) {
                try { swapEl = document.getElementById(swapId); } catch (_) {}
              }
              const willHide = !el.classList.contains("hidden");
              if (willHide) el.classList.add("hidden");
              else el.classList.remove("hidden");
              if (swapEl) {
                if (willHide) swapEl.classList.remove("hidden");
                else swapEl.classList.add("hidden");
              }
              btn.textContent = willHide ? "详情" : "收起";
            };
          } catch (_) {}
        }
      }

      function decorateRow(row) {
        decoratePreBlocks(row);
        decorateMdBlocks(row);
        wireToolToggles(row);
      }

	      function parseToolCallText(text) {
	        const lines = String(text ?? "").split("\n");
	        const known = ["shell_command", "apply_patch", "view_image", "update_plan", "web_search_call"];

	        let toolName = "";
	        for (const ln of lines) {
	          const t = String(ln ?? "").trim();
	          if (!t) continue;
	          toolName = t;
	          break;
	        }

	        let callId = "";
	        let callIdx = -1;
	        for (let i = 0; i < lines.length; i++) {
	          const t = String(lines[i] ?? "").trim();
	          if (!t) continue;
	          let m = t.match(/^call_id\s*[=:\uFF1A]\s*([^\s]+)\s*$/);
	          if (m) { callId = String(m[1] ?? "").trim(); callIdx = i; break; }
	          m = t.match(/call_id\s*[=:\uFF1A]\s*([A-Za-z0-9_-]+)/);
	          if (m) { callId = String(m[1] ?? "").trim(); callIdx = i; break; }
	        }

	        // If the first line isn't a plain tool name (rare variants), try to detect known tool names.
	        if (toolName && !known.includes(toolName) && (toolName.startsWith("tool_call") || toolName.includes("tool_call"))) {
	          for (const k of known) {
	            if (String(text ?? "").includes(k)) { toolName = k; break; }
	          }
	        }

	        let idx = 1;
	        if (callIdx >= 0) idx = callIdx + 1;
	        // Prefer the first JSON-ish line after call_id (useful for "原始参数" variants).
	        for (let i = idx; i < lines.length; i++) {
	          const t = String(lines[i] ?? "").trimStart();
	          if (!t) continue;
	          if (t === "原始参数" || t === "参数") continue;
	          if (t.startsWith("{") || t.startsWith("[")) { idx = i; break; }
	          // Otherwise keep idx as-is.
	          break;
	        }
	        const argsRaw = lines.slice(idx).join("\n").trimEnd();
	        return { toolName, callId, argsRaw };
	      }

	      function parseToolOutputText(text) {
	        const lines = String(text ?? "").split("\n");
        let callId = "";
        let idx = 0;
        if ((lines[0] || "").startsWith("call_id=")) {
          callId = (lines[0] || "").slice("call_id=".length).trim();
          idx = 1;
        }
        // Defensive: 某些输出可能重复带 call_id 行；去掉前导的 call_id 行。
        while ((lines[idx] || "").startsWith("call_id=")) idx += 1;
        const outputRaw = lines.slice(idx).join("\n");
	        return { callId, outputRaw };
	      }

      function statusIcon(status) {
        const s = String(status || "").toLowerCase();
        if (s === "completed" || s === "done") return "✅";
        if (s === "in_progress" || s === "running") return "▶";
        if (s === "pending" || s === "todo") return "⏳";
        if (s === "canceled" || s === "cancelled") return "🚫";
        if (s === "failed" || s === "error") return "❌";
        return "•";
      }

	      function summarizeCommand(cmd, maxLen = 96) {
	        const lines = String(cmd ?? "").split("\n");
	        const skip = (t) => {
	          const s = String(t || "").trim();
	          if (!s) return true;
	          if (s.startsWith("#!")) return true;
	          if (s.startsWith("#")) return true;
	          if (s.startsWith("set -")) return true; // 常见 bash prologue（如 set -euo pipefail）
	          return false;
	        };
	        let line = "";
	        for (const ln of lines) {
	          if (skip(ln)) continue;
	          line = String(ln || "").trim();
	          break;
	        }
	        if (!line) line = String(cmd ?? "").split("\n")[0].trim();
	        if (!line) return "";
	        if (line.length <= maxLen) return line;
	        return line.slice(0, Math.max(0, maxLen - 1)) + "…";
	      }
	
	      function commandPreview(cmd, maxLen = 220) {
	        const lines = String(cmd ?? "").split("\n");
	        const skip = (t) => {
	          const s = String(t || "").trim();
	          if (!s) return true;
	          if (s.startsWith("#!")) return true;
	          if (s.startsWith("#")) return true;
	          if (s.startsWith("set -")) return true;
	          return false;
	        };
	        const kept = [];
	        for (const ln of lines) {
	          if (skip(ln)) continue;
	          kept.push(String(ln || "").trim());
	        }
	        if (kept.length === 0) return summarizeCommand(cmd, maxLen);
	        let s = kept[0];
	        if (kept.length > 1) s += ` (… +${kept.length - 1} 行)`;
	        if (s.length <= maxLen) return s;
	        return s.slice(0, Math.max(0, maxLen - 1)) + "…";
	      }
	
	      function wrapWords(text, width = 78) {
	        const raw = String(text ?? "").trim();
	        if (!raw) return [];
	        const words = raw.split(/\s+/).filter(Boolean);
	        const out = [];
	        let line = "";
	        const push = () => { if (line) out.push(line); line = ""; };
	        for (const w of words) {
	          if (w.length > width) {
	            push();
	            for (let i = 0; i < w.length; i += width) out.push(w.slice(i, i + width));
	            continue;
	          }
	          if (!line) { line = w; continue; }
	          if ((line + " " + w).length <= width) line += " " + w;
	          else { push(); line = w; }
	        }
	        push();
	        return out;
	      }
	
	      function normalizeNonEmptyLines(s) {
	        const lines = String(s ?? "").split("\n");
	        // trim leading/trailing empties
	        let a = 0;
	        let b = lines.length;
	        while (a < b && !String(lines[a] || "").trim()) a++;
	        while (b > a && !String(lines[b - 1] || "").trim()) b--;
	        return lines.slice(a, b).map(x => String(x ?? "").replace(/\s+$/g, ""));
	      }
	
	      function excerptLines(lines, maxLines = 6) {
	        const xs = Array.isArray(lines) ? lines : [];
	        if (xs.length <= maxLines) return { lines: xs, truncated: false };
	        const head = xs.slice(0, 3);
	        const tail = xs.slice(-3);
	        return { lines: head.concat(["…（展开查看更多）"], tail), truncated: true };
	      }
	
	      function wrapCommandForDisplay(cmdOne, width = 78) {
	        const raw = String(cmdOne ?? "").trim();
	        if (!raw) return [];
	        const words = raw.split(/\s+/).filter(Boolean);
	        const splitTokens = (xs, sep) => {
	          const out = [];
	          let cur = [];
	          for (const w of xs) {
	            if (w === sep) {
	              if (cur.length) out.push(cur);
	              cur = [w];
	              continue;
	            }
	            cur.push(w);
	          }
	          if (cur.length) out.push(cur);
	          return out;
	        };

	        // Prefer breaking at control operators/pipes for readability.
	        let segs = [words];
	        for (const sep of ["||", "&&", "|"]) {
	          const next = [];
	          for (const seg of segs) {
	            if (seg.includes(sep)) next.push(...splitTokens(seg, sep));
	            else next.push(seg);
	          }
	          segs = next;
	        }

	        const lines = [];
	        for (const seg of segs) {
	          const s = seg.join(" ").trim();
	          if (!s) continue;
	          const wrapped = wrapWords(s, width);
	          for (const w of wrapped) lines.push(w);
	        }
	        if (lines.length) return lines;
	        return wrapWords(raw, width);
	      }
	
	      function wrapTreeContent(line, width = 74) {
	        const raw = String(line ?? "");
	        if (!raw) return [];
	        if (raw.length <= width) return [raw];
	        const out = [];
	        let rest = raw;
	        while (rest.length > width) {
	          let cut = rest.lastIndexOf(" ", width);
	          if (cut < 12) cut = width;
	          out.push(rest.slice(0, cut));
	          rest = rest.slice(cut).replace(/^\s+/, "");
	        }
	        if (rest) out.push(rest);
	        return out;
	      }

	      function normalizeTreeLine(line) {
	        const s = String(line ?? "");
	        // Reduce ugly indentation for typical `nl -ba` / line-numbered outputs.
	        if (/^\s+\d+(\s|$)/.test(s)) return s.replace(/^\s+/, "");
	        return s;
	      }
	
	      function countEscapedNewlines(s) {
	        try {
	          const m = String(s ?? "").match(/\n/g);
	          return m ? m.length : 0;
	        } catch (_) {
	          return 0;
	        }
	      }
	
	      function formatRgOutput(lines, maxHits = 1) {
	        const xs = Array.isArray(lines) ? lines : [];
	        const out = [];
	        let used = 0;
	        for (const ln of xs) {
	          if (used >= maxHits) break;
	          const m = String(ln ?? "").match(/^(.+?):(\d+):(.*)$/);
	          if (m && m[1] && String(m[1]).includes("/")) {
	            const path = String(m[1] || "");
	            const rest = String(m[3] || "");
	            const parts = path.split("/");
	            const base = parts.pop() || path;
	            const dir = (parts.join("/") + "/") || path;
	            out.push(dir);
	            out.push(`${base}:`);
	            const n = countEscapedNewlines(rest);
	            if (n > 0) out.push(`… +${n} lines`);
	          } else {
	            out.push(String(ln ?? ""));
	          }
	          used += 1;
	        }
	        const remaining = xs.length - used;
	        if (remaining > 0) out.push(`… +${remaining} matches`);
	        return out;
	      }
	
	      function summarizeOutputLines(lines, maxLines = 6) {
	        const xs = Array.isArray(lines) ? lines : [];
	        const clipped = xs.map((ln) => {
	          const s = String(ln ?? "");
	          if (s.length <= 240) return s;
	          return s.slice(0, 239) + "…";
	        });
	        if (clipped.length <= maxLines) return clipped;
	        const head = clipped.slice(0, maxLines);
	        const remaining = clipped.length - maxLines;
	        return head.concat([`… +${remaining} lines`]);
	      }
	
	      function formatShellRun(cmdFull, outputBody, exitCode) {
	        const cmdOne = commandPreview(cmdFull, 400);
	        const outAll = normalizeNonEmptyLines(outputBody);
	        const cmdWrap = wrapCommandForDisplay(cmdOne, 78);
	        const firstCmd = String(cmdOne ?? "").trim();
	        const isRg = /^rg\b/.test(firstCmd);
	        const pick = (outAll.length > 0)
	          ? (isRg ? formatRgOutput(outAll, 1) : summarizeOutputLines(outAll, 6))
	          : [];
	        const lines = [];
	        if (cmdWrap.length > 0) {
	          lines.push(`• Ran ${cmdWrap[0]}`);
	          for (let i = 1; i < cmdWrap.length; i++) lines.push(`  │ ${cmdWrap[i]}`);
	        } else {
	          lines.push("• Ran shell_command");
	        }
	        if (pick.length > 0) {
	          const p0 = wrapTreeContent(normalizeTreeLine(pick[0]), 74);
	          if (p0.length > 0) {
	            lines.push(`  └ ${p0[0]}`);
	            for (let j = 1; j < p0.length; j++) lines.push(`     ${p0[j]}`);
	          } else {
	            lines.push("  └ (no output)");
	          }
	          for (let i = 1; i < pick.length; i++) {
	            const ps = wrapTreeContent(normalizeTreeLine(pick[i]), 74);
	            for (const seg of ps) lines.push(`     ${seg}`);
	          }
	        } else if (exitCode !== null && exitCode !== 0) {
	          lines.push("  └ (no output)");
	        } else {
	          lines.push("  └ (no output)");
	        }
	        return lines.join("\n");
	      }

	      function formatShellRunExpanded(cmdFull, outputBody, exitCode) {
	        const cmdOne = commandPreview(cmdFull, 400);
	        const outAll = normalizeNonEmptyLines(outputBody);
	        const cmdWrap = wrapCommandForDisplay(cmdOne, 78);
	        const firstCmd = String(cmdOne ?? "").trim();
	        const isRg = /^rg\b/.test(firstCmd);
	        const pick = (outAll.length > 0)
	          ? (isRg ? formatRgOutput(outAll, 6) : summarizeOutputLines(outAll, 24))
	          : [];
	        const lines = [];
	        if (cmdWrap.length > 0) {
	          lines.push(`• Ran ${cmdWrap[0]}`);
	          for (let i = 1; i < cmdWrap.length; i++) lines.push(`  │ ${cmdWrap[i]}`);
	        } else {
	          lines.push("• Ran shell_command");
	        }
	        if (pick.length > 0) {
	          const p0 = wrapTreeContent(normalizeTreeLine(pick[0]), 74);
	          if (p0.length > 0) {
	            lines.push(`  └ ${p0[0]}`);
	            for (let j = 1; j < p0.length; j++) lines.push(`     ${p0[j]}`);
	          } else {
	            lines.push("  └ (no output)");
	          }
	          for (let i = 1; i < pick.length; i++) {
	            const ps = wrapTreeContent(normalizeTreeLine(pick[i]), 74);
	            for (const seg of ps) lines.push(`     ${seg}`);
	          }
	        } else if (exitCode !== null && exitCode !== 0) {
	          lines.push("  └ (no output)");
	        } else {
	          lines.push("  └ (no output)");
	        }
	        return lines.join("\n");
	      }

	      function summarizeApplyPatchFiles(argsRaw) {
	        const lines = String(argsRaw ?? "").split("\n");
	        const out = [];
	        const rx = /^\*\*\*\s+(Add File|Update File|Delete File):\s+(.+)$/;
	        for (const ln of lines) {
	          const m = String(ln ?? "").match(rx);
	          if (!m) continue;
	          const path = String(m[2] ?? "").trim();
	          if (!path) continue;
	          out.push(path);
	        }
	        return Array.from(new Set(out));
	      }

	      function extractApplyPatchOutputText(outputBody) {
	        const raw = String(outputBody ?? "").trim();
	        if (!raw) return "";
	        const obj = safeJsonParse(raw);
	        if (obj && typeof obj === "object" && typeof obj.output === "string") return String(obj.output || "");
	        return raw;
	      }

	      function formatOutputTree(headerLine, lines, maxLines = 12) {
	        const xs = Array.isArray(lines) ? lines : normalizeNonEmptyLines(String(lines ?? ""));
	        const pick = summarizeOutputLines(xs, maxLines);
	        const out = [];
	        out.push(headerLine || "• Output");
	        if (pick.length === 0) {
	          out.push("  └ (no output)");
	          return out.join("\n");
	        }
	        const p0 = wrapTreeContent(normalizeTreeLine(pick[0]), 74);
	        if (p0.length > 0) {
	          out.push(`  └ ${p0[0]}`);
	          for (let j = 1; j < p0.length; j++) out.push(`     ${p0[j]}`);
	        } else {
	          out.push("  └ (no output)");
	        }
	        for (let i = 1; i < pick.length; i++) {
	          const ps = wrapTreeContent(normalizeTreeLine(pick[i]), 74);
	          for (const seg of ps) out.push(`     ${seg}`);
	        }
	        return out.join("\n");
	      }

	      function formatApplyPatchRun(argsRaw, outputBody, maxLines = 10) {
	        const files = summarizeApplyPatchFiles(argsRaw);
	        const fileNote = (files.length === 1) ? ` (${files[0]})` : (files.length > 1 ? ` (${files.length} files)` : "");
	        const text = extractApplyPatchOutputText(outputBody);
	        const lines = normalizeNonEmptyLines(text);
	        return formatOutputTree(`• Applied patch${fileNote}`, lines, maxLines);
	      }
	
	      function isCodexEditSummary(text) {
	        const s = String(text ?? "");
	        return /(^|\n)•\s+(Edited|Added|Deleted|Created|Updated|Removed)\s+/m.test(s);
	      }
	
	      function joinWrappedExcerptLines(lines) {
	        const xs = Array.isArray(lines) ? lines.map(x => String(x ?? "")) : [];
	        const out = [];
	        for (const ln of xs) {
	          const t = String(ln ?? "");
	          const isContinuation = /^\s{6,}\S/.test(t) && !/^\s*\d+\s/.test(t) && !/^\s*\(\+/.test(t) && !/^\s*•\s+/.test(t);
	          if (isContinuation && out.length > 0) {
	            out[out.length - 1] = `${out[out.length - 1]} ${t.trim()}`;
	          } else {
	            out.push(t);
	          }
	        }
	        return out;
	      }
	
	      function parseCodexEditSummary(text) {
	        const lines = String(text ?? "").split("\n");
	        const sections = [];
	        let cur = null;
	        const flush = () => { if (cur) sections.push(cur); cur = null; };
	        for (const ln of lines) {
	          const m = ln.match(/^•\s+(Edited|Added|Deleted|Created|Updated|Removed)\s+(.+?)\s*$/);
	          if (m) {
	            flush();
	            cur = { action: m[1], path: m[2], stats: "", excerpt: [] };
	            continue;
	          }
	          if (cur && !cur.stats && /^\(\+\d+\s+-\d+\)\s*$/.test(String(ln || "").trim())) {
	            cur.stats = String(ln || "").trim();
	            continue;
	          }
	          if (cur) cur.excerpt.push(ln);
	        }
	        flush();
	        return sections;
	      }
	
	      function actionZh(action) {
	        const a = String(action || "");
	        if (a === "Edited") return "修改";
	        if (a === "Added" || a === "Created") return "新增";
	        if (a === "Deleted" || a === "Removed") return "删除";
	        if (a === "Updated") return "更新";
	        return a;
	      }
	
	      function diffClassForLine(ln) {
	        const s = String(ln ?? "");
	        // Unified diff / patches
	        if (s.startsWith("@@")) return "diff-ellipsis";
	        if (s.startsWith("+") && !s.startsWith("+++")) return "diff-add";
	        if (s.startsWith("-") && !s.startsWith("---")) return "diff-del";
	        const m = s.match(/^\s*\d+\s+([+-])\s/);
	        if (m) return (m[1] === "+") ? "diff-add" : "diff-del";
	        if (s.includes("⋮") || s.includes("…")) return "diff-ellipsis";
	        return "";
	      }

	      function renderDiffText(text) {
	        const lines = String(text ?? "").split("\n");
	        return renderDiffBlock(lines);
	      }
	
	      function renderDiffBlock(lines) {
	        const xs = Array.isArray(lines) ? lines : [];
	        const html = [];
	        for (const ln of xs) {
	          const cls = diffClassForLine(ln);
	          html.push(`<span class="diff-line ${cls}">${escapeHtml(ln)}</span>`);
	        }
	        // Each line is already a block; avoid inserting extra newlines that become blank lines.
	        return html.join("");
	      }
	
		      function renderCodexEditSummary(text) {
		        const sections = parseCodexEditSummary(text);
		        if (!sections.length) return "";
		        const blocks = [];
		        for (const sec of sections) {
		          const exJoined = joinWrappedExcerptLines(sec.excerpt);
		          const exLines = normalizeNonEmptyLines(exJoined.join("\n"));
		          const shown = excerptLines(exLines, 14).lines;
		          const actionLabel = actionZh(sec.action);
		          blocks.push(`
		            <div class="tool-card">
		              <div class="change-head">
		                <span class="pill">${escapeHtml(actionLabel)}</span>
		                <code>${escapeHtml(sec.path)}</code>
		                ${sec.stats ? `<span class="meta">${escapeHtml(sec.stats)}</span>` : ``}
		              </div>
		              <pre class="code">${renderDiffBlock(shown)}</pre>
		            </div>
		          `);
		        }
		        return blocks.join("\n");
		      }

	      function extractExitCode(outputRaw) {
	        const lines = String(outputRaw ?? "").split("\n");
	        for (const ln of lines) {
	          if (ln.startsWith("Exit code:")) {
	            const v = ln.split(":", 2)[1] || "";
	            const n = parseInt(v.trim(), 10);
	            return Number.isFinite(n) ? n : null;
	          }
	        }
	        return null;
	      }
	
	      function extractWallTime(outputRaw) {
	        const lines = String(outputRaw ?? "").split("\n");
	        for (const ln of lines) {
	          if (ln.startsWith("Wall time:")) {
	            const v = ln.split(":", 2)[1] || "";
	            return v.trim();
	          }
	        }
	        return "";
	      }
	
	      function extractOutputBody(outputRaw) {
	        const lines = String(outputRaw ?? "").split("\n");
	        for (let i = 0; i < lines.length; i++) {
	          if ((lines[i] || "").trim() === "Output:") {
	            const body = lines.slice(i + 1).join("\n");
	            return body.replace(/^\n+/, "");
	          }
	        }
	        return String(outputRaw ?? "");
	      }

      function firstMeaningfulLine(s) {
        const lines = String(s ?? "").split("\n");
        for (const ln of lines) {
          const t = ln.trim();
          if (!t) continue;
          if (t.startsWith("call_id=")) continue;
          return t;
        }
        return "";
      }

      function renderInlineMarkdown(text) {
        const raw = String(text ?? "");
        if (!raw) return "";
        const parts = raw.split("`");
        const out = [];
        for (let i = 0; i < parts.length; i++) {
          const seg = parts[i] ?? "";
          if ((i % 2) === 1) {
            out.push(`<code>${escapeHtml(seg)}</code>`);
          } else {
            let h = escapeHtml(seg);
            h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
            out.push(h);
          }
        }
        return out.join("");
      }

		      function renderMarkdown(md) {
		        const src = String(md ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
		        const lines = src.split("\n");
		        const blocks = [];
		        let inCode = false;
	        let codeLines = [];
	        let para = [];
	        let list = null; // { type: "ul"|"ol", items: string[] }

	        const flushPara = () => {
	          if (!para.length) return;
	          const text = para.join(" ").replace(/\s+/g, " ").trim();
	          para = [];
	          if (!text) return;
	          blocks.push(`<p>${renderInlineMarkdown(text)}</p>`);
	        };

	        const flushList = () => {
	          if (!list || !Array.isArray(list.items) || list.items.length === 0) { list = null; return; }
	          const tag = (list.type === "ol") ? "ol" : "ul";
	          const lis = list.items.map((it) => `<li>${renderInlineMarkdown(it)}</li>`).join("");
	          blocks.push(`<${tag}>${lis}</${tag}>`);
	          list = null;
	        };

        const flushCode = () => {
          const body = codeLines.join("\n").replace(/\n+$/g, "");
          codeLines = [];
          blocks.push(`<pre class="code">${escapeHtml(body)}</pre>`);
        };

        for (let i = 0; i < lines.length; i++) {
          const ln = String(lines[i] ?? "");
          const t = ln.trimEnd();

          const fence = t.match(/^\s*```/);
	          if (fence) {
	            if (inCode) {
	              flushCode();
	              inCode = false;
	            } else {
	              flushPara();
	              flushList();
	              inCode = true;
	            }
	            continue;
	          }

          if (inCode) {
            codeLines.push(ln);
            continue;
          }

	          if (!t.trim()) {
	            flushPara();
	            flushList();
	            continue;
	          }

	          const bh = t.match(/^\s*\*\*([^*]+)\*\*\s*$/);
	          if (bh) {
	            flushPara();
	            flushList();
	            const text = String(bh[1] ?? "").trim();
	            blocks.push(`<h3>${renderInlineMarkdown(text)}</h3>`);
	            continue;
	          }

	          const h = t.match(/^\s*(#{1,3})\s+(.*)$/);
	          if (h) {
	            flushPara();
	            flushList();
	            const level = Math.min(3, Math.max(1, (h[1] || "").length));
	            const text = String(h[2] ?? "").trim();
	            blocks.push(`<h${level}>${renderInlineMarkdown(text)}</h${level}>`);
	            continue;
	          }

	          const li = t.match(/^\s*(?:[-*]|[•◦])\s+(.*)$/);
	          if (li) {
	            flushPara();
	            if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
	            list.items.push(String(li[1] ?? "").trim());
	            continue;
	          }

	          const oli = t.match(/^\s*\d+[.)]\s+(.*)$/);
	          if (oli) {
	            flushPara();
	            if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
	            list.items.push(String(oli[1] ?? "").trim());
	            continue;
	          }

	          flushList();
	          para.push(t.trim());
	        }

	        if (inCode) flushCode();
		        flushPara();
		        flushList();
		        return blocks.join("\n");
		      }

	      function cleanThinkingText(md) {
	        const src = String(md ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	        const lines = src.split("\n");
	        const out = [];
	        let inCode = false;
	        let blankRun = 0;

	        const isFence = (s) => /^\s*```/.test(String(s ?? "").trimEnd());

	        for (let i = 0; i < lines.length; i++) {
	          const raw = String(lines[i] ?? "");
	          const trimmedEnd = raw.replace(/\s+$/g, "");
	          const t = trimmedEnd.trim();

	          if (isFence(trimmedEnd)) {
	            out.push(trimmedEnd);
	            inCode = !inCode;
	            blankRun = 0;
	            continue;
	          }

	          if (inCode) {
	            out.push(raw);
	            continue;
	          }

	          // 删除仅包含 "_" 的噪音分隔行（避免破坏变量名/路径等正常下划线）。
	          if (t && /^_+$/.test(t)) continue;

	          // 修复类似 "……_" / "..._" 的孤立结尾下划线（多见于上游 Markdown 断行/翻译残留）。
	          let ln = trimmedEnd.replace(/(……|…|\.{3})\s*_+(\s*)$/g, "$1$2");

	          // 连续空行压缩为最多 1 行（代码块内不处理）。
	          if (!ln.trim()) {
	            blankRun++;
	            if (blankRun > 1) continue;
	            out.push("");
	            continue;
	          }
	          blankRun = 0;
	          out.push(ln);
	        }
	        return out.join("\n");
	      }

      function rolloutStampFromFile(filePath) {
        try {
          const base = (filePath || "").split("/").slice(-1)[0] || "";
          const m = base.match(new RegExp("^rollout-(\\d{4}-\\d{2}-\\d{2})T(\\d{2}-\\d{2}-\\d{2})-"));
          if (!m) return "";
          return `${m[1]} ${String(m[2] || "").replace(/-/g, ":")}`;
        } catch (e) {
          return "";
        }
      }

      function threadLabel(t) {
        const stamp = rolloutStampFromFile(t.file || "");
        const idPart = t.thread_id ? shortId(t.thread_id) : shortId(((t.file || "").split("/").slice(-1)[0]) || (t.key || ""));
        if (stamp && idPart) return `${stamp} · ${idPart}`;
        return idPart || stamp || "unknown";
      }

      function clearList() {
        while (list.firstChild) list.removeChild(list.firstChild);
      }

      function clearTabs() {
        while (tabs.firstChild) tabs.removeChild(tabs.firstChild);
      }

      function upsertThread(msg) {
        const key = keyOf(msg);
        const prev = threadIndex.get(key) || { key, thread_id: msg.thread_id || "", file: msg.file || "", count: 0, last_ts: "" };
        prev.count = (prev.count || 0) + 1;
        const ts = msg.ts || "";
        if (ts && (!prev.last_ts || ts > prev.last_ts)) prev.last_ts = ts;
        threadIndex.set(key, prev);
      }

      function renderTabs() {
        const collapsed = isSidebarCollapsed();
        const items = Array.from(threadIndex.values()).sort((a,b) => (b.last_ts || "").localeCompare(a.last_ts || ""));
        clearTabs();
        const allBtn = document.createElement("button");
        allBtn.className = "tab" + (currentKey === "all" ? " active" : "");
        allBtn.textContent = collapsed ? "≡" : "全部";
        allBtn.title = "全部";
        allBtn.onclick = async () => { currentKey = "all"; await refreshList(); };
        tabs.appendChild(allBtn);

        for (const t of items) {
          const btn = document.createElement("button");
          btn.className = "tab" + (currentKey === t.key ? " active" : "");
          const label = threadLabel(t);
          if (collapsed) {
            btn.textContent = "●";
            const full = t.thread_id || t.file || t.key || "";
            btn.title = `${label} (${t.count || 0})${full ? "\n" + full : ""}`;
          } else {
            const labelSpan = document.createElement("span");
            labelSpan.textContent = label;
            const small = document.createElement("small");
            small.textContent = `(${t.count || 0})`;
            btn.appendChild(labelSpan);
            btn.appendChild(document.createTextNode(" "));
            btn.appendChild(small);
            btn.title = t.thread_id || t.file || t.key;
          }
          btn.onclick = async () => { currentKey = t.key; await refreshList(); };
          tabs.appendChild(btn);
        }
      }

	      function render(msg) {
	        const row = document.createElement("div");
	        const t = formatTs(msg.ts || "");
	        const kind = msg.kind || "";
	        const kindClass = String(kind || "").replace(/[^a-z0-9_-]/gi, "-");
	        row.className = "row" + (kindClass ? ` kind-${kindClass}` : "");
	        try {
	          const fullId = msg.thread_id || msg.file || "";
	          row.title = fullId ? `${kind} ${fullId}` : String(kind || "");
	        } catch (e) {}
	        const sid = msg.thread_id ? shortId(msg.thread_id) : (msg.file ? shortId((msg.file.split("/").slice(-1)[0] || msg.file)) : "");
        const mode = (displayMode.value || "both");
        const isThinking = (kind === "reasoning_summary" || kind === "agent_reasoning");
        const showEn = !isThinking ? true : (mode !== "zh");
        const showZh = !isThinking ? false : (mode !== "en");
        const zhText = (typeof msg.zh === "string") ? msg.zh : "";
        const hasZh = !!zhText.trim();

        const autoscroll = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 80);

	        let body = "";
	        let metaLeftExtra = "";
	        let metaRightExtra = "";
		        if (kind === "tool_output") {
		          const parsed = parseToolOutputText(msg.text || "");
		          const callId = parsed.callId || "";
		          const outputRaw = parsed.outputRaw || "";
			          const meta = callId ? callIndex.get(callId) : null;
			          const toolName = meta && meta.tool_name ? String(meta.tool_name) : "";
			          if (toolName === "update_plan") return; // update_plan 已在 tool_call 里优雅展示，避免重复
				          const exitCode = extractExitCode(outputRaw);
				          const outputBody = extractOutputBody(outputRaw);
				          const cmdFull = (meta && meta.args_obj && toolName === "shell_command") ? String(meta.args_obj.command || "") : "";
				          const argsRaw = (meta && meta.args_raw) ? String(meta.args_raw || "") : "";
		          const detailsId = ("tool_" + safeDomId((msg.id || callId || "") + "_details"));
		          const summaryId = ("tool_" + safeDomId((msg.id || callId || "") + "_summary"));

		          let runShort = "";
		          let expandedText = "";
		          let expandedHtml = "";

		          if (toolName === "shell_command" && cmdFull) {
		            metaLeftExtra = `<span class="pill">工具输出</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
		            runShort = formatShellRun(cmdFull, outputBody, exitCode);
		            const runLong = formatShellRunExpanded(cmdFull, outputBody, exitCode);
		            if (runLong && runLong !== runShort) expandedText = runLong;
			          } else if (toolName === "apply_patch") {
			            metaLeftExtra = `<span class="pill">工具输出</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
			            runShort = formatApplyPatchRun(argsRaw, outputBody, 8);
			            expandedText = String(argsRaw || "").trim();
			            if (!expandedText) {
			              expandedText = formatApplyPatchRun(argsRaw, outputBody, 120);
			            }
			            if (expandedText.trim()) expandedHtml = renderDiffText(expandedText);
			          } else if (toolName === "view_image") {
		            metaLeftExtra = `<span class="pill">工具输出</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
		            const p = (meta && meta.args_obj) ? String(meta.args_obj.path || "") : "";
		            const base = (p.split(/[\\/]/).pop() || "").trim();
		            const first = firstMeaningfulLine(outputBody) || "attached local image";
		            runShort = `• ${first}${base ? `: ${base}` : ``}`;
		          } else {
		            if (toolName) metaLeftExtra = `<span class="pill">工具输出</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
		            else metaLeftExtra = `<span class="pill">工具输出</span><span class="pill">未知工具</span>`;
		            const header = `• ${toolName || "tool_output"}`;
		            const jsonOut = extractJsonOutputString(outputBody);
		            const lines = normalizeNonEmptyLines(jsonOut || outputBody);
		            runShort = formatOutputTree(header, lines, 10);
		            const runLong = formatOutputTree(header, lines, 120);
		            if (runLong && runLong !== runShort) expandedText = runLong;
		          }

		          if (!String(runShort || "").trim()) {
		            const header = `• ${toolName || "tool_output"}`;
		            runShort = formatOutputTree(header, normalizeNonEmptyLines(outputBody), 10);
		          }

		          const hasDetails = !!String(expandedText || "").trim();
		          const detailsHtml = hasDetails ? `<pre id="${escapeHtml(detailsId)}" class="code hidden">${expandedHtml ? expandedHtml : escapeHtml(expandedText)}</pre>` : ``;
		          if (hasDetails) metaRightExtra = `<button class="tool-toggle" type="button" data-target="${escapeHtml(detailsId)}" data-swap="${escapeHtml(summaryId)}">详情</button>`;
			          body = `
			            <div class="tool-card">
			              ${runShort ? `<pre id="${escapeHtml(summaryId)}" class="code">${escapeHtml(runShort)}</pre>` : ``}
			              ${detailsHtml}
			            </div>
			          `;
			        } else if (kind === "tool_call") {
		          const parsed = parseToolCallText(msg.text || "");
		          const toolName = parsed.toolName || "tool_call";
		          const callId = parsed.callId || "";
		          const argsRaw = parsed.argsRaw || "";
		          const argsObj = safeJsonParse(argsRaw);
		          if (callId) callIndex.set(callId, { tool_name: toolName, args_raw: argsRaw, args_obj: argsObj });
		          // Avoid duplicate clutter: tool_output already renders the useful summary for these.
		          if (toolName === "shell_command" || toolName === "view_image" || toolName === "apply_patch") return;

	          if (toolName === "update_plan" && argsObj && typeof argsObj === "object") {
	            const explanation = (typeof argsObj.explanation === "string") ? argsObj.explanation : "";
	            const plan = Array.isArray(argsObj.plan) ? argsObj.plan : [];
	            const items = [];
	            for (const it of plan) {
	              if (!it || typeof it !== "object") continue;
	              const st = statusIcon(it.status);
	              const step = String(it.step || "").trim();
	              if (!step) continue;
	              items.push(`- ${st} ${step}`);
	            }
	            const md = [
	              "**更新计划**",
	              ...(items.length ? items : ["- （无变更）"]),
	              ...(explanation.trim() ? ["", "**说明**", explanation.trim()] : []),
	            ].join("\n");
	            metaLeftExtra = `<span class="pill">更新计划</span><span class="pill">${escapeHtml(String(items.length || 0))} 项</span>`;
	            body = `<div class="md">${renderMarkdown(md)}</div>`;
	          } else if (toolName === "shell_command" && argsObj && typeof argsObj === "object") {
	            const wd = String(argsObj.workdir || "").trim();
	            const cmd = String(argsObj.command || "");
	            const timeoutMs = argsObj.timeout_ms;
	            const cmdSummary = summarizeCommand(cmd) || "shell_command";
	            body = `
	              <details class="tool-card">
	                <summary class="meta">执行命令（点击展开）: <code>${escapeHtml(cmdSummary)}</code></summary>
	                <div class="tool-meta">
	                  <span class="pill">工具：<code>shell_command</code></span>
	                  ${callId ? `<span class="pill">call_id：<code>${escapeHtml(callId)}</code></span>` : ``}
	                  ${wd ? `<span class="pill">workdir：<code>${escapeHtml(wd)}</code></span>` : ``}
	                  ${Number.isFinite(Number(timeoutMs)) ? `<span class="pill">timeout_ms：<code>${escapeHtml(timeoutMs)}</code></span>` : ``}
	                </div>
	                <pre class="code">${escapeHtml(cmd)}</pre>
	                <details>
	                  <summary class="meta">原始参数</summary>
	                  <pre>${escapeHtml(argsRaw)}</pre>
	                </details>
	              </details>
	            `;
	          } else {
	            metaLeftExtra = `<span class="pill">工具调用</span><span class="pill"><code>${escapeHtml(toolName)}</code></span>`;
	            const pretty = argsObj ? JSON.stringify(argsObj, null, 2) : argsRaw;
	            body = `
	              <details class="tool-card">
	                <summary class="meta">工具调用（点击展开）: <code>${escapeHtml(toolName)}</code></summary>
	                <div class="tool-meta">
	                  <span class="pill">工具：<code>${escapeHtml(toolName)}</code></span>
	                  ${callId ? `<span class="pill">call_id：<code>${escapeHtml(callId)}</code></span>` : ``}
	                </div>
	                <pre>${escapeHtml(pretty || "")}</pre>
	              </details>
	            `;
	          }
	        } else if (kind === "user_message") {
	          metaLeftExtra = `<span class="pill">用户输入</span>`;
	          body = `<div class="md">${renderMarkdown(msg.text || "")}</div>`;
	        } else if (kind === "assistant_message") {
	          metaLeftExtra = `<span class="pill">回答</span>`;
	          const txt = String(msg.text || "");
	          if (isCodexEditSummary(txt)) {
	            body = renderCodexEditSummary(txt) || `<pre>${escapeHtml(txt)}</pre>`;
	          } else {
	            body = `<div class="md">${renderMarkdown(txt)}</div>`;
	          }
		        } else if (isThinking) {
		          const enText = showEn ? cleanThinkingText(msg.text || "") : "";
		          const zhClean = (showZh && hasZh) ? cleanThinkingText(zhText) : "";
		          const hasZhClean = !!String(zhClean || "").trim();

		          const pills = [];
		          if (showEn) pills.push(`<span class="pill">思考（EN）</span>`);
		          if (showZh && hasZhClean) pills.push(`<span class="pill">思考（ZH）</span>`);
		          metaLeftExtra = pills.join("");
		          const enHtml = showEn ? `<div class="md">${renderMarkdown(enText)}</div>` : "";
		          const zhHtml = (showZh && hasZhClean) ? `<div class="md think-split">${renderMarkdown(zhClean)}</div>` : "";
		          body = `${enHtml}${zhHtml}` || `<div class="meta">（空）</div>`;
	        } else {
	          // Fallback for unknown kinds.
	          body = `<pre>${escapeHtml(msg.text || "")}</pre>`;
	        }

	        row.innerHTML = `
	          <div class="meta meta-line">
	            <div class="meta-left">
	              <span class="timestamp">${escapeHtml(t.local || t.utc)}</span>
	              ${metaLeftExtra || ""}
	            </div>
	            <div class="meta-right">
	              ${metaRightExtra || ""}
	            </div>
	          </div>
	          ${body}
	        `;
	        decorateRow(row);
	        list.appendChild(row);
	        if (autoscroll) window.scrollTo(0, document.body.scrollHeight);
	      }

      function renderEmpty() {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `<div class="meta">暂无数据（或仍在回放中）：先等待 2-5 秒；如仍为空，请确认 sidecar 的 <code>--codex-home</code> 指向包含 <code>sessions/**/rollout-*.jsonl</code> 的目录，然后在 Codex 里发一条消息。也可以打开 <code>/api/messages</code> 验证是否已采集到数据。</div>`;
        list.appendChild(row);
      }

	      function setStatus(s) {
	        statusText.textContent = s || "";
	      }

	      function isSidebarCollapsed() {
	        try { return document.body.classList.contains("sidebar-collapsed"); } catch (_) { return false; }
	      }

	      function setSidebarCollapsed(v) {
	        try { document.body.classList.toggle("sidebar-collapsed", !!v); } catch (_) {}
	        try { if (sidebarToggleBtn) sidebarToggleBtn.textContent = v ? "⟫" : "⟪"; } catch (_) {}
	      }

	      function openDrawer() {
	        try {
	          if (drawerOverlay) drawerOverlay.classList.remove("hidden");
	          if (drawer) drawer.classList.remove("hidden");
	        } catch (_) {}
	      }

	      function closeDrawer() {
	        try {
	          if (drawerOverlay) drawerOverlay.classList.add("hidden");
	          if (drawer) drawer.classList.add("hidden");
	        } catch (_) {}
	      }

	      function setDebug(s) {
	        if (!debugText) return;
	        debugText.textContent = s || "";
	      }

      function fmtErr(e) {
        try {
          if (!e) return "unknown";
          if (typeof e === "string") return e;
          const msg = e.message ? String(e.message) : String(e);
          const st = e.stack ? String(e.stack) : "";
          return st ? `${msg}
${st}` : msg;
        } catch (_) {
          return "unknown";
        }
      }

      function showHttpFields(show) {
        const els = [httpProfile, httpProfileAddBtn, httpProfileDelBtn, httpUrl, httpToken, httpTimeout, httpAuthEnv];
        for (const el of els) {
          el.disabled = !show;
          el.style.opacity = show ? "1" : "0.5";
        }
      }

      function normalizeHttpProfiles(tc) {
        const profiles = Array.isArray(tc.profiles) ? tc.profiles.filter(p => p && typeof p === "object") : [];
        let selected = (typeof tc.selected === "string") ? tc.selected : "";

        // Backwards-compat: old config used {url, timeout_s, auth_env}.
        if (profiles.length === 0 && (tc.url || tc.timeout_s || tc.auth_env)) {
          profiles.push({
            name: "默认",
            url: tc.url || "",
            token: tc.token || "",
            timeout_s: (tc.timeout_s ?? 3),
            auth_env: tc.auth_env || "",
          });
          selected = "默认";
        }

        if (!selected && profiles.length > 0) selected = profiles[0].name || "默认";
        return { profiles, selected };
      }

      function readHttpInputs() {
        return {
          url: httpUrl.value || "",
          token: httpToken.value || "",
          timeout_s: Number(httpTimeout.value || 3),
          auth_env: httpAuthEnv.value || "",
        };
      }

      function upsertSelectedProfileFromInputs() {
        if (!httpSelected) return;
        const cur = readHttpInputs();
        let found = false;
        httpProfiles = httpProfiles.map(p => {
          if (p && p.name === httpSelected) {
            found = true;
            return { ...p, ...cur, name: httpSelected };
          }
          return p;
        });
        if (!found) {
          httpProfiles.push({ name: httpSelected, ...cur });
        }
      }

      function applyProfileToInputs(name) {
        const p = httpProfiles.find(x => x && x.name === name);
        if (!p) return;
        httpUrl.value = p.url || "";
        httpToken.value = p.token || "";
        httpTimeout.value = p.timeout_s ?? 3;
        httpAuthEnv.value = p.auth_env || "";
      }

      function refreshHttpProfileSelect() {
        httpProfile.innerHTML = "";
        for (const p of httpProfiles) {
          if (!p || typeof p !== "object") continue;
          const opt = document.createElement("option");
          opt.value = p.name || "";
          opt.textContent = p.name || "";
          httpProfile.appendChild(opt);
        }
        if (httpSelected) httpProfile.value = httpSelected;
        if (!httpProfile.value && httpProfiles.length > 0) {
          httpSelected = httpProfiles[0].name || "";
          httpProfile.value = httpSelected;
        }
      }

	      async function api(method, url, body) {
	        const opts = { method, cache: "no-store", headers: { "Content-Type": "application/json; charset=utf-8" } };
	        if (body !== undefined) opts.body = JSON.stringify(body);
	        const resp = await fetch(url, opts);
	        return await resp.json();
	      }

	      function countValidHttpProfiles(profiles) {
	        const xs = Array.isArray(profiles) ? profiles : [];
	        let score = 0;
	        for (const p of xs) {
	          if (!p || typeof p !== "object") continue;
	          const name = String(p.name || "").trim();
	          const url = String(p.url || "").trim();
	          if (!name || !url) continue;
	          if (!(url.startsWith("http://") || url.startsWith("https://"))) continue;
	          score += 1;
	        }
	        return score;
	      }

	      async function loadControl() {
	        const ts = Date.now();
	        let debugLines = [];
	        setDebug("");

        // 1) Translators（容错：接口失败时仍展示默认三项，避免“下拉为空”）
        let translators = [
          { id: "stub", label: "Stub（占位）" },
          { id: "none", label: "None（不翻译）" },
          { id: "http", label: "HTTP（通用适配器）" },
        ];
        try {
          const tr = await fetch(`/api/translators?t=${ts}`, { cache: "no-store" }).then(r => r.json());
          const remote = Array.isArray(tr.translators) ? tr.translators : (Array.isArray(tr) ? tr : []);
          if (remote.length > 0) translators = remote;
        } catch (e) {
          debugLines.push(`[warn] /api/translators: ${fmtErr(e)}`);
        }
        try {
          translatorSel.innerHTML = "";
          for (const t of translators) {
            const opt = document.createElement("option");
            opt.value = t.id || t.name || "";
            opt.textContent = t.label || t.id || t.name || "";
            translatorSel.appendChild(opt);
          }
        } catch (e) {
          debugLines.push(`[error] render translators: ${fmtErr(e)}`);
        }

	        // 2) Config
	        let cfg = {};
	        let recovery = {};
	        try {
	          const c = await fetch(`/api/config?t=${ts}`, { cache: "no-store" }).then(r => r.json());
	          cfg = c.config || c || {};
	          recovery = (c && typeof c === "object") ? (c.recovery || {}) : {};
	        } catch (e) {
	          debugLines.push(`[error] /api/config: ${fmtErr(e)}`);
	          cfg = {};
	          recovery = {};
	        }

        // 3) Apply config to UI（尽量继续，不让某个字段报错导致整体“全无”）
	        try {
	          cfgHome.value = cfg.config_home || "";
          watchHome.value = cfg.watch_codex_home || "";
          autoStart.value = cfg.auto_start ? "1" : "0";
          followProc.value = cfg.follow_codex_process ? "1" : "0";
          onlyWhenProc.value = (cfg.only_follow_when_process === false) ? "0" : "1";
          procRegex.value = cfg.codex_process_regex || "codex";
          replayLines.value = cfg.replay_last_lines ?? 0;
          includeAgent.value = cfg.include_agent_reasoning ? "1" : "0";
          displayMode.value = (localStorage.getItem("codex_sidecar_display_mode") || "both");
          pollInterval.value = cfg.poll_interval ?? 0.5;
          scanInterval.value = cfg.file_scan_interval ?? 2.0;
          {
            const want = cfg.translator_provider || "stub";
            translatorSel.value = want;
            if (translatorSel.value !== want) translatorSel.value = "stub";
          }
	          const tc = cfg.translator_config || {};
	          {
	            const normalized = normalizeHttpProfiles(tc || {});
	            httpProfiles = normalized.profiles;
	            httpSelected = normalized.selected;
	            refreshHttpProfileSelect();
	            if (httpSelected) applyProfileToInputs(httpSelected);
	          }
	          showHttpFields((translatorSel.value || "") === "http");
	        } catch (e) {
	          debugLines.push(`[error] apply config: ${fmtErr(e)}`);
	        }

	        // 3.1) 提示恢复：Profiles 为空但存在可恢复备份（仅提示一次）
	        try {
	          if (!window.__sidecarRecoveryPrompted) window.__sidecarRecoveryPrompted = false;
	          const provider = String(cfg.translator_provider || "").trim().toLowerCase();
	          const canRecover = !!(recovery && typeof recovery === "object" && recovery.available);
	          const valid = countValidHttpProfiles(httpProfiles);
	          if (!window.__sidecarRecoveryPrompted && provider === "http" && valid <= 0 && canRecover) {
	            window.__sidecarRecoveryPrompted = true;
	            if (confirm("检测到翻译 HTTP Profiles 为空，但本机备份中存在可恢复配置。是否现在恢复？")) {
	              await api("POST", "/api/config/recover", {});
	              // 重新加载一次（避免 UI 状态与后端不一致）
	              await loadControl();
	              return;
	            }
	          }
	        } catch (e) {}

        // 4) Status（运行态提示）
        try {
          const st = await fetch(`/api/status?t=${ts}`, { cache: "no-store" }).then(r => r.json());
          let hint = "";
          if (st.env && st.env.auth_env) {
            hint = st.env.auth_env_set ? `（已检测到 ${st.env.auth_env}）` : `（未设置环境变量 ${st.env.auth_env}）`;
          }
          const w = (st && st.watcher) ? st.watcher : {};
          const cur = w.current_file || "";
          const mode = w.follow_mode || "";
          const detected = (w.codex_detected === "1");
          const pids = w.codex_pids || "";
          const procFile = w.process_file || "";
          let detail = "";
          if (mode === "idle") detail = "（等待 Codex 进程）";
          else if (mode === "process") detail = pids ? `（process | pid:${pids}）` : "（process）";
          else if (mode === "fallback") detail = detected && pids ? `（fallback | pid:${pids}）` : "（fallback）";
          else if (mode) detail = `(${mode})`;
	          if (st.running) {
	            if (cur) setStatus(`运行中：${cur} ${detail} ${hint}`.trim());
	            else setStatus(`运行中：${detail} ${hint}`.trim());
	          } else {
	            setStatus(`未运行 ${hint}`.trim());
	          }
	          try {
	            if (startBtn) startBtn.disabled = !!st.running;
	            if (stopBtn) stopBtn.disabled = !st.running;
	          } catch (_) {}
	        } catch (e) {
	          debugLines.push(`[warn] /api/status: ${fmtErr(e)}`);
	        }

	        // 5) Debug summary（不打印 token/url）
	        try {
	          const profNames = (httpProfiles || []).map(p => (p && p.name) ? String(p.name) : "").filter(Boolean);
	          const cfgHomePath = String(cfg.config_home || "").replace(/\/+$/, "");
	          const cfgFile = cfgHomePath ? `${cfgHomePath}/config.json` : "";
	          const rAvail = (recovery && typeof recovery === "object" && recovery.available) ? "yes" : "no";
	          const rSrc = (recovery && typeof recovery === "object" && recovery.source) ? String(recovery.source || "") : "";
	          debugLines.unshift(
	            `config_home: ${cfg.config_home || ""}`,
	            `watch_codex_home: ${cfg.watch_codex_home || ""}`,
	            `config_file: ${cfgFile}`,
	            `recovery_available: ${rAvail}${rSrc ? " (" + rSrc + ")" : ""}`,
	            `translator_provider: ${cfg.translator_provider || ""}`,
	            `http_profiles: ${profNames.length}${profNames.length ? " (" + profNames.join(", ") + ")" : ""}`,
	            `http_selected: ${httpSelected || ""}`,
	          );
	        } catch (e) {
	          debugLines.push(`[warn] debug: ${fmtErr(e)}`);
	        }
        if (debugLines.length) setDebug(debugLines.join("\n"));
      }

	      async function saveConfig() {
	        const provider = translatorSel.value || "stub";
	        let wasRunning = false;
        try {
          const st = await fetch(`/api/status?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json());
          wasRunning = !!(st && st.running);
        } catch (e) {}
	        if (provider === "http") {
	          if (!httpSelected && httpProfiles.length > 0) httpSelected = httpProfiles[0].name || "";
	          if (!httpSelected) httpSelected = "默认";
	          upsertSelectedProfileFromInputs();
	          refreshHttpProfileSelect();
	        }
	        if (provider === "http") {
	          // Guard: do not allow saving empty/invalid profiles (protect against accidental wipe).
	          const valid = countValidHttpProfiles(httpProfiles);
	          if (valid <= 0) {
	            // Try recover first if available
	            try {
	              const c = await fetch(`/api/config?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json());
	              const rec = (c && typeof c === "object") ? (c.recovery || {}) : {};
	              if (rec && rec.available) {
	                if (confirm("当前没有可用的 HTTP Profiles。是否从本机备份恢复？")) {
	                  await api("POST", "/api/config/recover", {});
	                  await loadControl();
	                  setStatus("已恢复配置");
	                  return;
	                }
	              }
	            } catch (e) {}
	            alert("请至少保留 1 个可用的 HTTP Profile（需要 name + http/https URL），或切换翻译 Provider。");
	            return;
	          }
	        }
	        const patch = {
	          watch_codex_home: watchHome.value || "",
          auto_start: autoStart.value === "1",
          follow_codex_process: followProc.value === "1",
          only_follow_when_process: onlyWhenProc.value === "1",
          codex_process_regex: (procRegex.value || "codex").trim(),
          replay_last_lines: Number(replayLines.value || 0),
          include_agent_reasoning: includeAgent.value === "1",
          poll_interval: Number(pollInterval.value || 0.5),
          file_scan_interval: Number(scanInterval.value || 2.0),
          translator_provider: provider,
        };
	        if (provider === "http") {
	          patch.translator_config = { profiles: httpProfiles, selected: httpSelected };
	        }
	        const saved = await api("POST", "/api/config", patch);
	        if (saved && saved.ok === false) {
	          const err = String(saved.error || "");
	          if (err === "empty_http_profiles") {
	            alert("保存被拒绝：HTTP Profiles 为空/不可用。可点击“恢复配置”从备份找回。");
	          } else {
	            alert(`保存失败：${err || "unknown_error"}`);
	          }
	          return;
	        }
	        if (wasRunning) {
	          // Config changes only take effect on watcher restart; prompt to apply immediately.
	          if (confirm("已保存配置。需要重启监听使新配置生效吗？")) {
	            await api("POST", "/api/control/stop");
	            await api("POST", "/api/control/start");
	          }
        }
        if (!wasRunning && patch.auto_start) {
          // 让“自动开始”在保存后即可生效（无需手动点开始）。
          await api("POST", "/api/control/start");
        }
        await loadControl();
        setStatus("已保存配置");
      }

      async function recoverConfig() {
        if (!confirm("将从本机配置备份尝试恢复翻译 Profiles，并覆盖当前翻译配置。是否继续？")) return;
        try {
          const r = await api("POST", "/api/config/recover", {});
          await loadControl();
          const src = (r && r.source) ? `（${r.source}）` : "";
          setStatus(`已恢复配置${src}`);
        } catch (e) {
          const msg = `恢复失败：${fmtErr(e)}`;
          setStatus(msg);
          setDebug(msg);
        }
      }

      async function startWatch() {
        const r = await api("POST", "/api/control/start");
        await loadControl();
        setStatus(r.running ? "已开始监听" : "开始监听失败");
      }

      async function stopWatch() {
        const r = await api("POST", "/api/control/stop");
        await loadControl();
        setStatus(r.running ? "停止监听失败" : "已停止监听");
      }

      async function clearView() {
        await api("POST", "/api/control/clear");
        threadIndex.clear();
        callIndex.clear();
        currentKey = "all";
        await refreshList();
        setStatus("已清空显示");
      }

	      async function refreshList() {
	        try {
	          let url = "/api/messages";
          // 当前 key 为 thread_id 时，走服务端过滤；否则退化为前端过滤（例如 key=file/unknown）
          if (currentKey !== "all") {
            const t = threadIndex.get(currentKey);
            if (t && t.thread_id) {
              url = `/api/messages?thread_id=${encodeURIComponent(t.thread_id)}`;
            }
          }
          const resp = await fetch(url);
	          const data = await resp.json();
	          const msgs = (data.messages || []);
	          callIndex.clear();
	          clearList();
	          const filtered = currentKey === "all" ? msgs : msgs.filter(m => keyOf(m) === currentKey);
	          // Pre-index tool_call so tool_output can always resolve tool_name even if order is odd.
	          for (const m of filtered) {
	            try {
	              if (!m || m.kind !== "tool_call") continue;
	              const parsed = parseToolCallText(m.text || "");
	              const toolName = parsed.toolName || "";
	              const callId = parsed.callId || "";
	              const argsRaw = parsed.argsRaw || "";
	              const argsObj = safeJsonParse(argsRaw);
	              if (callId) callIndex.set(callId, { tool_name: toolName, args_raw: argsRaw, args_obj: argsObj });
	            } catch (_) {}
	          }
	          if (filtered.length === 0) renderEmpty();
	          else for (const m of filtered) render(m);
	        } catch (e) {
	          clearList();
	          renderEmpty();
        }
        renderTabs();
      }

      async function bootstrap() {
        try {
          // 先加载 thread 列表（若为空也没关系），再加载消息列表。
          try {
            const tr = await fetch("/api/threads");
            const td = await tr.json();
            const threads = td.threads || [];
            for (const t of threads) threadIndex.set(t.key, t);
          } catch (e) {}
          await refreshList();
        } catch (e) {
          clearList();
          renderEmpty();
        }
      }

      setSidebarCollapsed(false);
      if (sidebarToggleBtn) sidebarToggleBtn.addEventListener("click", () => {
        setSidebarCollapsed(!isSidebarCollapsed());
        renderTabs();
      });

      translatorSel.addEventListener("change", () => {
        showHttpFields((translatorSel.value || "") === "http");
      });

	      if (configToggleBtn) configToggleBtn.addEventListener("click", () => {
	        try {
	          if (drawer && !drawer.classList.contains("hidden")) closeDrawer();
	          else openDrawer();
	        } catch (_) { openDrawer(); }
	      });
	      if (drawerOverlay) drawerOverlay.addEventListener("click", () => { closeDrawer(); });
	      if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", () => { closeDrawer(); });
	      window.addEventListener("keydown", (e) => {
	        try {
	          if (e && e.key === "Escape") closeDrawer();
	        } catch (_) {}
	      });

	      displayMode.addEventListener("change", async () => {
	        localStorage.setItem("codex_sidecar_display_mode", displayMode.value || "both");
	        await refreshList();
	      });
      httpProfile.addEventListener("change", () => {
        upsertSelectedProfileFromInputs();
        httpSelected = httpProfile.value || "";
        if (httpSelected) applyProfileToInputs(httpSelected);
      });
      httpProfileAddBtn.addEventListener("click", () => {
        upsertSelectedProfileFromInputs();
        const name = (prompt("新 Profile 名称（用于在下拉中切换）") || "").trim();
        if (!name) return;
        if (httpProfiles.some(p => p && p.name === name)) {
          alert("该名称已存在");
          return;
        }
        httpProfiles.push({ name, ...readHttpInputs() });
        httpSelected = name;
        refreshHttpProfileSelect();
        httpProfile.value = httpSelected;
      });
      httpProfileRenameBtn.addEventListener("click", () => {
        upsertSelectedProfileFromInputs();
        if (!httpSelected) return;
        const name = (prompt("将当前 Profile 重命名为：", httpSelected) || "").trim();
        if (!name || name === httpSelected) return;
        if (httpProfiles.some(p => p && p.name === name)) {
          alert("该名称已存在");
          return;
        }
        httpProfiles = httpProfiles.map(p => (p && p.name === httpSelected) ? { ...p, name } : p);
        httpSelected = name;
        refreshHttpProfileSelect();
        httpProfile.value = httpSelected;
      });
      httpProfileDelBtn.addEventListener("click", () => {
        if (!httpSelected) return;
        if (!confirm(`删除 Profile：${httpSelected} ?`)) return;
        httpProfiles = httpProfiles.filter(p => !(p && p.name === httpSelected));
        httpSelected = httpProfiles.length > 0 ? (httpProfiles[0].name || "") : "";
        refreshHttpProfileSelect();
        if (httpSelected) applyProfileToInputs(httpSelected);
        else {
          httpUrl.value = "";
          httpTimeout.value = 3;
          httpAuthEnv.value = "";
        }
      });
		      saveBtn.addEventListener("click", async () => { await saveConfig(); });
		      recoverBtn.addEventListener("click", async () => { await recoverConfig(); });
		      startBtn.addEventListener("click", async () => { await startWatch(); });
		      stopBtn.addEventListener("click", async () => { await stopWatch(); });
		      clearBtn.addEventListener("click", async () => { await clearView(); });
		      if (shutdownBtn) shutdownBtn.addEventListener("click", async () => {
		        if (!confirm("确定要退出 sidecar 进程？（将停止监听并关闭服务）")) return;
		        setStatus("正在退出 sidecar…");
		        try { await api("POST", "/api/control/shutdown", {}); } catch (e) {}
		        closeDrawer();
		        setStatus("已发送退出请求（服务将停止）。");
		      });
		      if (scrollTopBtn) scrollTopBtn.addEventListener("click", () => { window.scrollTo({ top: 0, behavior: "smooth" }); });
		      if (scrollBottomBtn) scrollBottomBtn.addEventListener("click", () => { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); });

      let bootAutoStarted = false;
      async function maybeAutoStartOnce() {
        if (bootAutoStarted) return;
        bootAutoStarted = true;
        try {
          const ts = Date.now();
          const c = await fetch(`/api/config?t=${ts}`, { cache: "no-store" }).then(r => r.json());
          const cfg = c.config || c || {};
          if (!cfg.auto_start) return;
          const st = await fetch(`/api/status?t=${ts}`, { cache: "no-store" }).then(r => r.json());
          if (st && st.running) return;
          await api("POST", "/api/control/start");
        } catch (e) {}
      }

      (async () => {
        await loadControl();
        await maybeAutoStartOnce();
        await loadControl();
        await bootstrap();
      })();
      const es = new EventSource("/events");
      es.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          upsertThread(msg);
          // 只渲染当前 tab（或全部）
          const k = keyOf(msg);
          if (currentKey === "all" || currentKey === k) render(msg);
          renderTabs();
        } catch (e) {}
      });
