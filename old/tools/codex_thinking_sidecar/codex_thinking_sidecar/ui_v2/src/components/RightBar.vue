<script setup lang="ts">
import { computed } from "vue";

import { api } from "../api/client";
import { useAppStore } from "../stores/app";
import { exportCurrentThreadMarkdown } from "../services/export";

const store = useAppStore();

const status = computed(() => {
  const parts: string[] = [];
  if (store.sseConnected) parts.push("SSE:已连接");
  else parts.push("SSE:未连接");
  if (store.statusText) parts.push(store.statusText);
  return parts.join(" · ");
});

const themeTitle = computed(() => {
  const m = String(store.themeMode || "default");
  if (m === "dark") return "主题：暗色";
  if (m === "flat") return "主题：浅色(Flat)";
  return "主题：默认";
});

async function onStart(): Promise<void> {
  try {
    await api.start();
    await store.refreshStatus();
  } catch (e) {
    store.setLastError(String((e as Error)?.message || "start_failed"));
  }
}

async function onStop(): Promise<void> {
  try {
    await api.stop();
    await store.refreshStatus();
  } catch (e) {
    store.setLastError(String((e as Error)?.message || "stop_failed"));
  }
}

async function onRestartProcess(): Promise<void> {
  try {
    await api.restartProcess();
  } catch (e) {
    store.setLastError(String((e as Error)?.message || "restart_failed"));
  }
}

async function onShutdown(): Promise<void> {
  if (!confirm("确定要退出 sidecar 进程？（将停止监听并关闭服务）")) return;
  try {
    await api.shutdown();
  } catch (e) {
    store.setLastError(String((e as Error)?.message || "shutdown_failed"));
  }
}

async function onRefresh(): Promise<void> {
  try {
    await store.bootstrap();
  } catch (e) {
    store.setLastError(String((e as Error)?.message || "refresh_failed"));
  }
}

async function onClear(): Promise<void> {
  try {
    await api.clear();
    await store.bootstrap();
  } catch (e) {
    store.setLastError(String((e as Error)?.message || "clear_failed"));
  }
}

async function onExport(): Promise<void> {
  try {
    const mode = store.viewMode === "quick" ? "quick" : "full";
    const r = await exportCurrentThreadMarkdown(store.currentKey, store.threadIndex, mode);
    if (!r.ok) store.setLastError(String(r.error || "export_failed"));
  } catch (e) {
    store.setLastError(String((e as Error)?.message || "export_failed"));
  }
}

async function onToggleTranslate(): Promise<void> {
  try {
    await store.toggleTranslateMode();
  } catch (e) {
    store.setLastError(String((e as Error)?.message || "toggle_translate_failed"));
  }
}

function scrollTop(): void {
  try {
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (_) {}
}

function scrollBottom(): void {
  try {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  } catch (_) {}
}
</script>

<template>
  <div id="rightbar" class="rightbar" aria-label="actions">
    <button class="icon-btn" type="button" aria-label="配置" @click="store.openConfigDrawer">⚙</button>
    <button class="icon-btn" type="button" aria-label="主题" :title="themeTitle" @click="store.cycleThemeMode">🌓</button>
    <button class="icon-btn" type="button" aria-label="快速浏览" @click="store.toggleViewMode">⚡</button>
    <button class="icon-btn" :class="{ active: store.translateMode !== 'manual' }" type="button" aria-label="自动翻译" @click="onToggleTranslate">🌐</button>
    <button class="icon-btn" :class="{ active: store.showHiddenThreads }" type="button" aria-label="显示隐藏会话" @click="store.setShowHidden(!store.showHiddenThreads)">👁</button>
    <button class="icon-btn" type="button" aria-label="刷新" @click="onRefresh">↻</button>
    <button class="icon-btn" type="button" aria-label="开始监听" @click="onStart">▶</button>
    <button class="icon-btn" type="button" aria-label="停止监听" @click="onStop">■</button>
    <button class="icon-btn" type="button" aria-label="导出" @click="onExport">⤓</button>
    <button class="icon-btn" type="button" aria-label="重启进程" @click="onRestartProcess">⟳</button>
    <button class="icon-btn danger" type="button" aria-label="清空显示" @click="onClear">🧹</button>
    <button class="icon-btn danger" type="button" aria-label="退出" @click="onShutdown">⏻</button>
    <button class="icon-btn" type="button" aria-label="回到顶部" @click="scrollTop">↑</button>
    <button class="icon-btn" type="button" aria-label="滚到底部" @click="scrollBottom">↓</button>
    <div class="meta" style="padding:6px 8px; text-align:right; max-width: 260px;">
      <div>{{ status }}</div>
      <div v-if="store.lastError" style="color: var(--c-danger)">{{ store.lastError }}</div>
    </div>
  </div>
</template>
