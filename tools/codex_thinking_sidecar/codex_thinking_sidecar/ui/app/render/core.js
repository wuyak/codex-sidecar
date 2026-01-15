import { decorateRow } from "../decorate.js";
import { splitLeadingCodeBlock } from "../markdown.js";
import { isCodexEditSummary, renderCodexEditSummary } from "../format.js";
import { renderMarkdownCached } from "./md_cache.js";
import { getThinkingVisibility, isThinkingKind, renderThinkingBlock, tryPatchThinkingRow } from "./thinking.js";
import { renderToolCall, renderToolOutput } from "./tool.js";
import { escapeHtml, formatTs, safeDomId } from "../utils.js";

export function clearList(dom) {
  const list = dom.list;
  if (!list) return;
  while (list.firstChild) list.removeChild(list.firstChild);
}

export function renderEmpty(dom) {
  const list = dom.list;
  if (!list) return;
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<div class="meta">暂无数据（或仍在回放中）：先等待 2-5 秒；如仍为空，请确认 sidecar 的 <code>--codex-home</code> 指向包含 <code>sessions/**/rollout-*.jsonl</code> 的目录，然后在 Codex 里发一条消息。也可以打开 <code>/api/messages</code> 验证是否已采集到数据。</div>`;
  list.appendChild(row);
}

export function renderMessage(dom, state, msg, opts = {}) {
  const opt = (opts && typeof opts === "object") ? opts : {};
  const patchEl = opt.patchEl || null;
  const insertBefore = opt.insertBefore || null;
  const replaceEl = opt.replaceEl || null;

  const mid = (msg && typeof msg.id === "string") ? msg.id : "";
  const t = formatTs(msg.ts || "");
  const kind = msg.kind || "";
  const kindClass = String(kind || "").replace(/[^a-z0-9_-]/gi, "-");

  const autoscroll = ("autoscroll" in opt)
    ? !!opt.autoscroll
    : ((window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 80));

  const isThinking = isThinkingKind(kind);
  const canPatch = !!(
    patchEl &&
    patchEl.nodeType === 1 &&
    isThinking &&
    mid &&
    patchEl.dataset &&
    patchEl.dataset.msgId === mid
  );

  const list = opt.list || dom.list || (canPatch ? patchEl.parentNode : null);
  if (!list && !canPatch) return;
  const replaceTarget = replaceEl || (!canPatch ? patchEl : null) || null;

  const row = canPatch ? patchEl : document.createElement("div");
  row.className = "row" + (kindClass ? ` kind-${kindClass}` : "");

  // 翻译回填：优先原位更新（保留行内状态），失败则回退为整行 replace。
  if (canPatch) {
    const zhText = (typeof msg.zh === "string") ? msg.zh : "";
    const vis = getThinkingVisibility(dom);
    const ok = tryPatchThinkingRow(dom, state, msg, row, { mid, t, zhText, ...vis });
    if (ok) {
      decorateRow(row);
      if (autoscroll) window.scrollTo(0, document.body.scrollHeight);
      return;
    }
  }

  let body = "";
  let metaLeftExtra = "";
  let metaRightExtra = "";

  if (kind === "tool_output") {
    const r = renderToolOutput(dom, state, msg, { mid });
    if (!r) return;
    metaLeftExtra = r.metaLeftExtra || "";
    metaRightExtra = r.metaRightExtra || "";
    body = r.body || "";
  } else if (kind === "tool_call") {
    const r = renderToolCall(dom, state, msg, { mid });
    if (!r) return;
    metaLeftExtra = r.metaLeftExtra || "";
    metaRightExtra = r.metaRightExtra || "";
    body = r.body || "";
  } else if (kind === "tool_gate") {
    metaLeftExtra = `<span class="pill">终端确认</span>`;
    const txt = String(msg.text || "");
    body = `<div class="md">${renderMarkdownCached(state, `md:${mid}:tool_gate`, txt)}</div>`;
  } else if (kind === "user_message") {
    metaLeftExtra = `<span class="pill">用户输入</span>`;
    const txt = String(msg.text || "");
    const split = splitLeadingCodeBlock(txt);
    if (split && split.code) {
      body = `${split.code ? `<pre class="code">${escapeHtml(split.code)}</pre>` : ``}${split.rest ? `<div class="md">${renderMarkdownCached(state, `md:${mid}:user_rest`, split.rest)}</div>` : ``}`;
    } else {
      body = `<div class="md">${renderMarkdownCached(state, `md:${mid}:user`, txt)}</div>`;
    }
  } else if (kind === "assistant_message") {
    metaLeftExtra = `<span class="pill">回答</span>`;
    const txt = String(msg.text || "");
    if (isCodexEditSummary(txt)) {
      body = renderCodexEditSummary(txt) || `<pre>${escapeHtml(txt)}</pre>`;
    } else {
      body = `<div class="md">${renderMarkdownCached(state, `md:${mid}:assistant`, txt)}</div>`;
    }
  } else if (isThinking) {
    const zhText = (typeof msg.zh === "string") ? msg.zh : "";
    const vis = getThinkingVisibility(dom);
    const r = renderThinkingBlock(state, msg, { mid, zhText, ...vis });
    metaLeftExtra = r.metaLeftExtra || "";
    metaRightExtra = r.metaRightExtra || "";
    body = r.body || "";
  } else {
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
  if (mid) {
    row.dataset.msgId = mid;
    try { row.id = `msg_${safeDomId(mid)}`; } catch (_) {}
  }
  if (replaceTarget && replaceTarget.parentNode === list) list.replaceChild(row, replaceTarget);
  else if (insertBefore) list.insertBefore(row, insertBefore);
  else list.appendChild(row);
  if (mid && state && state.rowIndex && typeof state.rowIndex.set === "function") {
    try { state.rowIndex.set(mid, row); } catch (_) {}
  }
  if (autoscroll) window.scrollTo(0, document.body.scrollHeight);
}
