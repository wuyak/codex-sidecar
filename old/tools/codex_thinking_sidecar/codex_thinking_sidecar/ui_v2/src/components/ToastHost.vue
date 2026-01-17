<script setup lang="ts">
import { computed } from "vue";

import { useToastStore } from "../stores/toast";

const toast = useToastStore();

const items = computed(() => toast.toasts);
</script>

<template>
  <teleport to="#overlay">
    <div class="corner-notify" aria-live="polite" aria-relevant="additions text">
      <div v-for="t in items" :key="t.id" class="corner-toast" :class="t.kind">
        {{ t.text }}
      </div>
    </div>
  </teleport>
</template>

