<script setup lang="ts">
import { computed, nextTick, ref } from "vue";

import { useAppStore } from "../stores/app";
import { colorForKey } from "../utils/color";

const store = useAppStore();

const threads = computed(() => {
  const list = store.threads.slice();
  if (store.showHiddenThreads) return list;
  return list.filter((t) => !store.hiddenThreads.has(t.key));
});

const editingKey = ref<string>("");
const draftLabel = ref<string>("");
const editInput = ref<HTMLInputElement | null>(null);

let pressT = 0;
let pressedKey = "";
let startX = 0;
let startY = 0;
let moved = false;
let longFired = false;

function clearPress(): void {
  pressedKey = "";
  moved = false;
  if (pressT) {
    try {
      clearTimeout(pressT);
    } catch (_) {}
  }
  pressT = 0;
}

function unreadFor(key: string): number {
  try {
    const n = Number(store.unreadByKey.get(key) || 0);
    return Math.max(0, n);
  } catch (_) {
    return 0;
  }
}

function startEdit(key: string): void {
  if (!key || key === "all") return;
  editingKey.value = key;
  const t = store.threadIndex.get(key);
  draftLabel.value = t ? store.formatThreadLabel(t) : "";
  try {
    nextTick(() => {
      try {
        editInput.value?.focus();
        editInput.value?.select();
      } catch (_) {}
    });
  } catch (_) {}
}

function commitEdit(): void {
  const k = editingKey.value;
  if (!k) return;
  store.setCustomLabel(k, draftLabel.value);
  editingKey.value = "";
  draftLabel.value = "";
}

function cancelEdit(): void {
  editingKey.value = "";
  draftLabel.value = "";
}

function onPointerDown(key: string, e: PointerEvent): void {
  try {
    if (typeof (e as any).button === "number" && (e as any).button !== 0) return;
  } catch (_) {}
  clearPress();
  pressedKey = key;
  longFired = false;
  moved = false;
  startX = Number((e as any).clientX) || 0;
  startY = Number((e as any).clientY) || 0;
  pressT = window.setTimeout(() => {
    if (!pressedKey || moved) return;
    longFired = true;
    startEdit(key);
  }, 420);
}

function onPointerMove(e: PointerEvent): void {
  if (!pressedKey) return;
  const x = Number((e as any).clientX) || 0;
  const y = Number((e as any).clientY) || 0;
  const dx = x - startX;
  const dy = y - startY;
  if ((dx * dx + dy * dy) > (8 * 8)) {
    moved = true;
    clearPress();
  }
}

async function onClick(key: string): Promise<void> {
  if (longFired) {
    longFired = false;
    return;
  }
  await store.selectKey(key);
}
</script>

<template>
  <div id="bookmarks" class="bookmarks" aria-label="会话书签">
    <button
      class="bookmark"
      :class="{ active: store.currentKey === 'all', 'has-unread': store.unreadTotal > 0 }"
      type="button"
      @click="store.selectKey('all')"
      :data-unread="store.unreadTotal > 0 ? (store.unreadTotal > 99 ? '99+' : String(store.unreadTotal)) : undefined"
      style="--bm-accent:#111827; --bm-border: rgba(148,163,184,.55)"
    >
      <span class="bm-label">全部</span>
    </button>

    <template v-for="t in threads" :key="t.key">
      <template v-if="editingKey !== t.key">
        <button
          class="bookmark"
          :class="{
            active: store.currentKey === t.key,
            'has-unread': unreadFor(t.key) > 0,
            'tab-hidden': store.hiddenThreads.has(t.key),
          }"
          type="button"
          @click.prevent="onClick(t.key)"
          @pointerdown="onPointerDown(t.key, $event)"
          @pointermove="onPointerMove($event)"
          @pointerup="clearPress"
          @pointercancel="clearPress"
          @pointerleave="clearPress"
          @contextmenu.prevent="store.toggleHidden(t.key)"
          :data-unread="unreadFor(t.key) > 0 ? (unreadFor(t.key) > 99 ? '99+' : String(unreadFor(t.key))) : undefined"
          :style="{
            '--bm-accent': colorForKey(t.key).fg,
            '--bm-border': colorForKey(t.key).border,
          }"
        >
          <span class="bm-label">{{ store.formatThreadLabel(t) }}</span>
        </button>
      </template>

      <button
        v-else
        class="bookmark editing active"
        type="button"
      >
        <span class="bm-label" style="display:none"></span>
        <input
          ref="editInput"
          class="bm-edit"
          v-model="draftLabel"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="重命名…"
          @keydown.enter.prevent="commitEdit"
          @keydown.esc.prevent="cancelEdit"
          @blur="commitEdit"
        />
      </button>
    </template>
  </div>
</template>
