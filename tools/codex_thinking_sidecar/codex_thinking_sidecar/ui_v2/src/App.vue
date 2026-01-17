<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";

import { useAppStore } from "./stores/app";
import { connectSse } from "./services/sse";
import BookmarksRail from "./components/BookmarksRail.vue";
import RightBar from "./components/RightBar.vue";
import MessageList from "./components/MessageList.vue";
import ConfigDrawer from "./components/ConfigDrawer.vue";
import ToastHost from "./components/ToastHost.vue";

const store = useAppStore();
let es: EventSource | null = null;

const currentTitle = computed(() => {
  if (store.currentKey === "all") return "全部";
  const t = store.threadIndex.get(store.currentKey);
  return t ? store.formatThreadLabel(t) : String(store.currentKey || "");
});

const statusLine = computed(() => {
  const parts: string[] = [];
  parts.push(store.sseConnected ? "SSE:已连接" : "SSE:未连接");
  if (store.statusText) parts.push(store.statusText);
  return parts.join(" · ");
});

onMounted(async () => {
  await store.bootstrap();

  es = connectSse({
    onOpen: () => store.setSseConnected(true),
    onError: () => store.setSseConnected(false),
    shouldBuffer: () => store.refreshInFlight,
    onBatch: (msgs) => store.applyIncomingBatch(msgs),
  });
});

onBeforeUnmount(() => {
  try {
    es?.close();
  } catch (_) {}
  es = null;
});
</script>

<template>
  <BookmarksRail />
  <div id="main">
    <div class="row" id="topbar">
      <div>
        <div class="top-title">Codex Sidecar · 会话旁路监视（V2）</div>
        <div class="meta">
          订阅：<code>/events</code>（SSE） · 数据：<a class="meta-link" href="/api/messages" target="_blank" rel="noopener">/api/messages</a>
          · 会话：<a class="meta-link" href="/api/threads" target="_blank" rel="noopener">/api/threads</a>
        </div>
      </div>
      <div class="meta" id="statusText">
        <div><strong>{{ currentTitle }}</strong></div>
        <div>{{ statusLine }}</div>
      </div>
    </div>
  <MessageList />
  </div>
  <RightBar />
  <ConfigDrawer />
  <ToastHost />
</template>
