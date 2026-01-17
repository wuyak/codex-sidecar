import { defineStore } from "pinia";
import { ref } from "vue";

export type ToastKind = "info" | "warn";

export type ToastItem = {
  id: string;
  kind: ToastKind;
  text: string;
  createdAt: number;
  ttlMs: number;
};

function _id(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useToastStore = defineStore("toast", () => {
  const toasts = ref<ToastItem[]>([]);

  function remove(id: string): void {
    const k = String(id || "").trim();
    if (!k) return;
    toasts.value = toasts.value.filter((t) => t.id !== k);
  }

  function push(kind: ToastKind, text: string, ttlMs: number = 2400): string {
    const msg = String(text || "").trim();
    if (!msg) return "";
    const id = _id();
    const item: ToastItem = {
      id,
      kind: kind === "warn" ? "warn" : "info",
      text: msg,
      createdAt: Date.now(),
      ttlMs: Math.max(800, Number(ttlMs) || 0),
    };
    toasts.value = [...toasts.value, item].slice(-6);
    window.setTimeout(() => remove(id), item.ttlMs);
    return id;
  }

  function info(text: string, ttlMs?: number): string {
    return push("info", text, ttlMs);
  }

  function warn(text: string, ttlMs?: number): string {
    return push("warn", text, ttlMs ?? 3200);
  }

  function clear(): void {
    toasts.value = [];
  }

  return {
    toasts,
    push,
    info,
    warn,
    remove,
    clear,
  };
});

