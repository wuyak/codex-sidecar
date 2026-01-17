<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import { useAppStore } from "../stores/app";
import { useToastStore } from "../stores/toast";

const store = useAppStore();
const toast = useToastStore();

const open = computed(() => store.configDrawerOpen);
const draft = ref<string>("");
const err = ref<string>("");

function _formatJson(obj: unknown): string {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch (_) {
    return "{}";
  }
}

async function load(): Promise<void> {
  err.value = "";
  try {
    await store.refreshConfig();
    draft.value = _formatJson(store.config || {});
  } catch (e) {
    err.value = String((e as Error)?.message || "load_failed");
  }
}

async function onSave(): Promise<void> {
  err.value = "";
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(draft.value || "{}") as Record<string, unknown>;
  } catch (_) {
    err.value = "JSON 解析失败，请检查格式";
    return;
  }
  try {
    await store.saveConfig(obj);
    draft.value = _formatJson(store.config || {});
    toast.info("已保存配置");
  } catch (e) {
    err.value = String((e as Error)?.message || "save_failed");
  }
}

async function onRecover(): Promise<void> {
  err.value = "";
  try {
    await store.recoverConfig();
    draft.value = _formatJson(store.config || {});
    toast.info("已从备份恢复配置");
  } catch (e) {
    err.value = String((e as Error)?.message || "recover_failed");
  }
}

function close(): void {
  store.closeConfigDrawer();
}

watch(
  () => open.value,
  async (v) => {
    if (v) await load();
  },
);

onMounted(async () => {
  if (open.value) await load();
});
</script>

<template>
  <teleport to="#overlay">
    <div v-if="open" class="drawer-overlay" @click="close"></div>
    <div v-if="open" class="drawer" role="dialog" aria-modal="true" aria-label="配置">
      <div class="drawer-head">
        <div class="title">配置（V2，JSON 编辑）</div>
        <button class="drawer-close" type="button" aria-label="关闭" @click="close">×</button>
      </div>

      <div class="drawer-sec">
        <div class="meta" style="margin-bottom:6px;">
          说明：此处直接编辑 sidecar 配置 JSON，并以整对象方式提交到 <code>/api/config</code>。
        </div>

        <textarea
          v-model="draft"
          spellcheck="false"
          style="width: 100%; min-height: 320px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; font-size: 12px; line-height: 1.4;"
        ></textarea>

        <div class="meta" v-if="err" style="margin-top:6px; color: var(--c-danger)">{{ err }}</div>

        <div style="display:flex; gap:8px; margin-top:10px; justify-content:flex-end;">
          <button class="mini-btn danger" type="button" @click="onRecover" title="从备份恢复">↺</button>
          <button class="mini-btn" type="button" @click="onSave" title="保存配置">💾</button>
        </div>
      </div>
    </div>
  </teleport>
</template>
