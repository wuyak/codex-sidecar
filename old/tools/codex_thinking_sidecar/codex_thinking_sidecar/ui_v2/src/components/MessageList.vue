<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";

import { useAppStore } from "../stores/app";
import { renderMarkdown, splitLeadingCodeBlock } from "../legacy/markdown";

const store = useAppStore();
const host = ref<HTMLElement | null>(null);

const filteredRows = computed(() => {
  const all = store.messages;
  if (store.viewMode !== "quick") return all;
  const allow = new Set(["user_message", "assistant_message", "reasoning_summary"]);
  return all.filter((m) => allow.has(String(m.kind || "")));
});
const DEFAULT_LIMIT = 360;
const LOAD_STEP = 420;
const limit = ref<number>(DEFAULT_LIMIT);

const hiddenCount = computed(() => {
  const n = filteredRows.value.length - rows.value.length;
  return Math.max(0, n);
});

const rows = computed(() => {
  const all = filteredRows.value;
  const lim = Math.max(40, Number(limit.value) || 0);
  if (all.length <= lim) return all;
  return all.slice(Math.max(0, all.length - lim));
});

const thinkModeById = ref<Map<string, "en" | "zh">>(new Map());
const toolOpenById = ref<Map<string, boolean>>(new Map());

const readMarkId = computed(() => {
  try {
    return String(store.readMarkByKey.get(store.currentKey) || "").trim();
  } catch (_) {
    return "";
  }
});

const readMarkIndex = computed(() => {
  const id = readMarkId.value;
  if (!id) return -1;
  return rows.value.findIndex((m) => m && m.id === id);
});

const mdCache = new Map<string, { raw: string; html: string }>();
function mdHtml(cacheKey: string, text?: string): string {
  const k = String(cacheKey || "").trim();
  const raw = String(text || "");
  if (!k) return renderMarkdown(raw);
  const prev = mdCache.get(k);
  if (prev && prev.raw === raw) return prev.html;
  const html = renderMarkdown(raw);
  mdCache.set(k, { raw, html });
  return html;
}

const leadCache = new Map<string, { raw: string; code: string; rest: string }>();
function leadingCode(mid: string, text?: string): { code: string; rest: string } {
  const id = String(mid || "").trim();
  const raw = String(text || "");
  if (!id) return splitLeadingCodeBlock(raw);
  const prev = leadCache.get(id);
  if (prev && prev.raw === raw) return { code: prev.code, rest: prev.rest };
  const sp = splitLeadingCodeBlock(raw);
  leadCache.set(id, { raw, code: sp.code, rest: sp.rest });
  return sp;
}

function formatTs(ts?: string): string {
  if (!ts) return "";
  // 和 legacy 一样：优先展示本地时间，但这里先保持简单。
  try {
    const ms = Date.parse(ts);
    if (!Number.isFinite(ms)) return ts;
    const d = new Date(ms);
    return d.toLocaleString();
  } catch (_) {
    return ts;
  }
}

function getThinkMode(mid: string, hasZh: boolean): "en" | "zh" {
  const override = thinkModeById.value.get(mid);
  if (override) return override;
  return hasZh ? "zh" : "en";
}

function translateModeFor(kind: string): "auto" | "manual" {
  return store.translateMode === "manual" ? "manual" : "auto";
}

function parseToolCall(text: string): { title: string; callId: string; body: string } {
  const raw = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n");
  const title = String(lines[0] || "").trim();
  let i = 1;
  let callId = "";
  if (String(lines[1] || "").startsWith("call_id=")) {
    callId = String(lines[1] || "").slice("call_id=".length).trim();
    i = 2;
  }
  const body = lines.slice(i).join("\n").trimEnd();
  return { title, callId, body };
}

function parseToolOutput(text: string): { callId: string; body: string } {
  const raw = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = raw.split("\n");
  let i = 0;
  let callId = "";
  if (String(lines[0] || "").startsWith("call_id=")) {
    callId = String(lines[0] || "").slice("call_id=".length).trim();
    i = 1;
  }
  const body = lines.slice(i).join("\n").trimEnd();
  return { callId, body };
}

function previewLines(text: string, maxLines: number): string {
  const raw = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trimEnd();
  if (!raw) return "（无内容）";
  const lim = Math.max(3, Number(maxLines) || 0);
  const lines = raw.split("\n");
  if (lines.length <= lim) return raw;
  return `${lines.slice(0, lim).join("\n")}\n…（已截断，点击“详情”展开）`;
}

function isToolOpen(id: string): boolean {
  return !!toolOpenById.value.get(id);
}

function toggleTool(id: string): void {
  const k = String(id || "").trim();
  if (!k) return;
  const next = new Map(toolOpenById.value);
  next.set(k, !next.get(k));
  toolOpenById.value = next;
}

async function onRetranslate(mid: string): Promise<void> {
  const r = await store.requestRetranslate(mid);
  if (!r.ok) store.setLastError(`翻译失败：${String(r.error || "request_failed")}`);
}

async function onThinkClick(mid: string, kind: string, hasZh: boolean): Promise<void> {
  if (hasZh) {
    const cur = getThinkMode(mid, hasZh);
    const next = cur === "zh" ? "en" : "zh";
    const map = new Map(thinkModeById.value);
    map.set(mid, next);
    thinkModeById.value = map;
    return;
  }
  const tmode = translateModeFor(kind);
  if (tmode !== "manual") return;
  if (store.translateInFlight.has(mid)) return;
  await onRetranslate(mid);
}

async function scrollToBottom(): Promise<void> {
  await nextTick();
  try {
    window.scrollTo(0, document.body.scrollHeight);
  } catch (_) {}
}

async function loadMore(): Promise<void> {
  const beforeH = document.body.scrollHeight;
  const beforeY = window.scrollY;
  limit.value = Math.min(9000, Math.max(40, limit.value + LOAD_STEP));
  await nextTick();
  const afterH = document.body.scrollHeight;
  const dy = afterH - beforeH;
  try {
    window.scrollTo(0, beforeY + dy);
  } catch (_) {}
}

onMounted(async () => {
  await scrollToBottom();
});

watch(
  () => filteredRows.value.length,
  async () => {
    // 仅在“接近底部”时自动滚动，避免用户向上阅读时被强制拉回底部。
    const wasNearBottom = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 80);
    if (!wasNearBottom) return;
    await scrollToBottom();
  },
);

watch(
  () => store.currentKey,
  async () => {
    limit.value = DEFAULT_LIMIT;
    thinkModeById.value = new Map();
    toolOpenById.value = new Map();
    await scrollToBottom();
  },
);
</script>

<template>
  <div id="list" ref="host">
    <div v-if="hiddenCount > 0" class="row row-empty">
      <div class="meta">
        已隐藏较早消息 {{ hiddenCount }} 条
        <button class="mini-btn" type="button" style="margin-left: 10px" @click="loadMore">加载更多</button>
      </div>
    </div>

    <div v-if="rows.length === 0" class="row row-empty">
      <div class="meta">
        暂无数据（或仍在回放中）：先等待 2-5 秒；如仍为空，请确认 sidecar 的 <code>--codex-home</code> 指向包含
        <code>sessions/**/rollout-*.jsonl</code> 的目录，然后在 Codex 里发一条消息。也可以打开 <code>/api/messages</code> 验证是否已采集到数据。
      </div>
    </div>

    <template v-for="(m, i) in rows" :key="m.id">
      <div
        v-if="store.currentKey !== 'all' && i === (readMarkIndex + 1) && Number(store.unreadByKey.get(store.currentKey) || 0) > 0"
        class="row row-empty"
      >
        <div class="meta">未读从这里开始</div>
      </div>

      <div
        class="row"
        :class="[
          `kind-${String(m.kind || '').replace(/[^a-z0-9_-]/gi, '-')}`,
          (m.kind === 'reasoning_summary') ? `think-mode-${getThinkMode(m.id, !!(m.zh && String(m.zh).trim()))}` : '',
        ]"
        :data-msg-id="m.id"
        :data-translate-error="m.translate_error || ''"
      >
      <div class="meta meta-line">
        <div class="meta-left">
          <span class="timestamp">{{ formatTs(m.ts) }}</span>
          <span v-if="m.kind === 'user_message'" class="pill">用户输入</span>
          <span v-else-if="m.kind === 'assistant_message'" class="pill">回答</span>
          <span v-else-if="m.kind === 'tool_call'" class="pill">工具调用</span>
          <span v-else-if="m.kind === 'tool_output'" class="pill">工具输出</span>
          <span v-else-if="m.kind === 'tool_gate'" class="pill">终端确认</span>
          <span v-else-if="m.kind === 'reasoning_summary'" class="pill">思考摘要</span>
        </div>
        <div class="meta-right">
          <template v-if="m.kind === 'reasoning_summary'">
            <button
              class="mini-btn"
              type="button"
              :disabled="store.translateInFlight.has(m.id)"
              @click="onRetranslate(m.id)"
              :title="translateModeFor(String(m.kind)) === 'manual' ? '翻译/重译' : '重译（仍可手动触发）'"
            >
              翻译
            </button>
            <span class="meta" v-if="store.translateInFlight.has(m.id)">ZH 翻译中…</span>
            <span class="meta" v-else-if="m.translate_error" style="color: var(--c-danger)">{{ m.translate_error }}</span>
          </template>
        </div>
      </div>

      <template v-if="m.kind === 'user_message'">
        <template v-if="leadingCode(m.id, m.text || '').code">
          <pre class="code">{{ leadingCode(m.id, m.text || '').code }}</pre>
          <div v-if="leadingCode(m.id, m.text || '').rest" class="md" v-html="mdHtml(`${m.id}:user_rest`, leadingCode(m.id, m.text || '').rest)"></div>
        </template>
        <div v-else class="md" v-html="mdHtml(`${m.id}:user`, m.text)"></div>
      </template>

      <template v-else-if="m.kind === 'assistant_message'">
        <div class="md" v-html="mdHtml(`${m.id}:assistant`, m.text)"></div>
      </template>

      <template v-else-if="m.kind === 'tool_call' || m.kind === 'tool_output' || m.kind === 'tool_gate'">
        <template v-if="m.kind === 'tool_gate'">
          <pre class="code">{{ m.text || "" }}</pre>
        </template>
        <template v-else-if="m.kind === 'tool_call'">
          <div class="tool-card">
            <div class="tool-head">
              <div style="font-weight: 800">{{ parseToolCall(String(m.text || '')).title || 'tool_call' }}</div>
              <div class="tool-actions">
                <button class="tool-toggle" type="button" @click="toggleTool(m.id)">{{ isToolOpen(m.id) ? '收起' : '详情' }}</button>
              </div>
            </div>
            <div class="tool-meta" v-if="parseToolCall(String(m.text || '')).callId">
              <span>call_id: {{ parseToolCall(String(m.text || '')).callId }}</span>
            </div>
            <div class="tool-details">
              <pre class="code">{{ isToolOpen(m.id) ? parseToolCall(String(m.text || '')).body : previewLines(parseToolCall(String(m.text || '')).body, 10) }}</pre>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="tool-card">
            <div class="tool-head">
              <div style="font-weight: 800">tool_output</div>
              <div class="tool-actions">
                <button class="tool-toggle" type="button" @click="toggleTool(m.id)">{{ isToolOpen(m.id) ? '收起' : '详情' }}</button>
              </div>
            </div>
            <div class="tool-meta" v-if="parseToolOutput(String(m.text || '')).callId">
              <span>call_id: {{ parseToolOutput(String(m.text || '')).callId }}</span>
            </div>
            <div class="tool-details">
              <pre class="code">{{ isToolOpen(m.id) ? parseToolOutput(String(m.text || '')).body : previewLines(parseToolOutput(String(m.text || '')).body, 14) }}</pre>
            </div>
          </div>
        </template>
      </template>

      <template v-else-if="m.kind === 'reasoning_summary'">
        <div class="think" @click="onThinkClick(m.id, String(m.kind || ''), !!(m.zh && String(m.zh).trim()))">
          <div class="think-en md" v-html="mdHtml(`${m.id}:think_en`, m.text)"></div>
          <template v-if="m.zh && String(m.zh).trim()">
            <div class="think-split"></div>
            <div class="think-zh md" v-html="mdHtml(`${m.id}:think_zh`, m.zh)"></div>
          </template>
          <template v-else>
            <div class="think-wait meta">
              <template v-if="m.translate_error">翻译失败：{{ m.translate_error }}</template>
              <template v-else-if="store.translateInFlight.has(m.id)">ZH 翻译中…</template>
              <template v-else-if="translateModeFor(String(m.kind)) === 'manual'">点击翻译…</template>
              <template v-else>等待翻译…</template>
            </div>
          </template>
        </div>
      </template>

      <template v-else>
        <pre>{{ m.text || "" }}</pre>
      </template>
      </div>
    </template>
  </div>
</template>
