import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { api } from "../api/client";
import type { SidecarMessage, SidecarThread } from "../api/types";
import { useToastStore } from "./toast";
import { keyOf, rolloutStampFromFile, shortId } from "../utils/ids";
import {
  loadHiddenThreads,
  loadLabels,
  loadShowHiddenFlag,
  loadTheme,
  saveHiddenThreads,
  saveLabels,
  saveShowHiddenFlag,
  saveTheme,
} from "../utils/storage";

type ViewMode = "full" | "quick";
type ThemeMode = "default" | "flat" | "dark";

function _sortThreads(a: SidecarThread, b: SidecarThread): number {
  const sa = Number(a.last_seq) || 0;
  const sb = Number(b.last_seq) || 0;
  if (sa !== sb) return sb - sa;
  return String(b.last_ts || "").localeCompare(String(a.last_ts || ""));
}

function _tsMs(ts?: string): number {
  if (!ts) return NaN;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : NaN;
}

function _sortMessages(a: SidecarMessage, b: SidecarMessage): number {
  const ta = _tsMs(a.ts);
  const tb = _tsMs(b.ts);
  const fa = Number.isFinite(ta);
  const fb = Number.isFinite(tb);
  if (fa && fb && ta !== tb) return ta - tb;
  if (fa && !fb) return -1;
  if (!fa && fb) return 1;

  const sa = Number.isFinite(Number(a.seq)) ? Number(a.seq) : NaN;
  const sb = Number.isFinite(Number(b.seq)) ? Number(b.seq) : NaN;
  const fsa = Number.isFinite(sa);
  const fsb = Number.isFinite(sb);
  if (fsa && fsb && sa !== sb) return sa - sb;
  if (fsa && !fsb) return -1;
  if (!fsa && fsb) return 1;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

export const useAppStore = defineStore("app", () => {
  const currentKey = ref<string>("all");
  const threads = ref<SidecarThread[]>([]);
  const threadIndex = computed(() => new Map(threads.value.map((t) => [t.key, t])));

  const viewMode = ref<ViewMode>("full");
  const themeMode = ref<ThemeMode>("default");

  const labels = ref<Record<string, string>>(loadLabels());
  const hiddenThreads = ref<Set<string>>(loadHiddenThreads());
  const showHiddenThreads = ref<boolean>(loadShowHiddenFlag());

  const unreadByKey = ref<Map<string, number>>(new Map());
  const unreadTotal = computed(() => {
    let n = 0;
    for (const v of unreadByKey.value.values()) n += Math.max(0, Number(v) || 0);
    return n;
  });
  const readMarkByKey = ref<Map<string, string>>(new Map());

  const messagesAll = ref<SidecarMessage[]>([]);
  const messagesByKey = ref<Map<string, SidecarMessage[]>>(new Map());
  const messageById = ref<Map<string, SidecarMessage>>(new Map());
  const messages = computed(() => {
    const k = String(currentKey.value || "all");
    if (k === "all") return messagesAll.value;
    const list = messagesByKey.value.get(k);
    return list || [];
  });

  const refreshDepth = ref<number>(0);
  const refreshInFlight = computed(() => refreshDepth.value > 0);

  const statusText = ref<string>("");
  const sseConnected = ref<boolean>(false);
  const lastError = ref<string>("");

  const translateMode = ref<"auto" | "manual">("auto");
  const translatorProvider = ref<string>("openai");
  const notifySound = ref<string>("none");
  const translateInFlight = ref<Set<string>>(new Set());

  const configDrawerOpen = ref<boolean>(false);
  const config = ref<Record<string, unknown> | null>(null);

  function _applyViewModeToBody(mode: ViewMode): void {
    try {
      document.body.classList.toggle("quick-view", mode === "quick");
    } catch (_) {}
  }

  function setViewMode(mode: ViewMode): void {
    const m: ViewMode = mode === "quick" ? "quick" : "full";
    viewMode.value = m;
    _applyViewModeToBody(m);
    try {
      localStorage.setItem("codex_sidecar_view_mode_v1", m);
    } catch (_) {}
  }

  function toggleViewMode(): void {
    const cur = viewMode.value;
    setViewMode(cur === "quick" ? "full" : "quick");
  }

  function _normalizeTheme(x: unknown): ThemeMode {
    const v = String(x || "").trim().toLowerCase();
    if (v === "flat") return "flat";
    if (v === "dark") return "dark";
    return "default";
  }

  function _applyThemeToBody(mode: ThemeMode): void {
    try {
      if (mode === "default") document.body.removeAttribute("data-bm-skin");
      else document.body.setAttribute("data-bm-skin", mode);
    } catch (_) {}
  }

  function setThemeMode(mode: ThemeMode): void {
    const m = _normalizeTheme(mode);
    themeMode.value = m;
    _applyThemeToBody(m);
    saveTheme(m);
  }

  function cycleThemeMode(): void {
    const cur = _normalizeTheme(themeMode.value);
    if (cur === "default") return setThemeMode("flat");
    if (cur === "flat") return setThemeMode("dark");
    return setThemeMode("default");
  }

  async function _withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    refreshDepth.value += 1;
    try {
      return await fn();
    } finally {
      refreshDepth.value = Math.max(0, refreshDepth.value - 1);
    }
  }

  function formatThreadLabel(t: SidecarThread): string {
    const stamp = rolloutStampFromFile(t.file || "");
    const idPart = t.thread_id ? shortId(t.thread_id) : shortId((t.file || "").split("/").slice(-1)[0] || t.key);
    const defaultLabel = stamp && idPart ? `${stamp} · ${idPart}` : idPart || stamp || t.key || "unknown";
    const custom = String(labels.value[t.key] || "").trim();
    return custom || defaultLabel;
  }

  function setCustomLabel(key: string, label: string): void {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const v = String(label || "").trim();
    const next = { ...labels.value };
    if (!v) delete next[k];
    else next[k] = v;
    labels.value = next;
    saveLabels(next);
  }

  function toggleHidden(key: string): void {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const next = new Set(hiddenThreads.value);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    hiddenThreads.value = next;
    saveHiddenThreads(next);
  }

  function setShowHidden(on: boolean): void {
    showHiddenThreads.value = !!on;
    saveShowHiddenFlag(!!on);
  }

  function clearUnreadForKey(key: string): void {
    const k = String(key || "").trim();
    if (!k || k === "all") return;
    const next = new Map(unreadByKey.value);
    next.delete(k);
    unreadByKey.value = next;
  }

  function _markUnread(msg: SidecarMessage): void {
    const k = keyOf(msg);
    if (!k || k === "unknown" || k === "all") return;
    const next = new Map(unreadByKey.value);
    const cur = Math.max(0, Number(next.get(k) || 0));
    next.set(k, cur + 1);
    unreadByKey.value = next;
  }

  function _rebuildCachesFromAll(list: SidecarMessage[]): void {
    const all = Array.isArray(list) ? list.slice() : [];
    all.sort(_sortMessages);
    messagesAll.value = all;

    const byId = new Map<string, SidecarMessage>();
    const byKey = new Map<string, SidecarMessage[]>();
    for (const m of all) {
      if (m && m.id) byId.set(m.id, m);
      const k = keyOf(m);
      if (!k || k === "unknown") continue;
      const bucket = byKey.get(k) || [];
      bucket.push(m);
      byKey.set(k, bucket);
    }
    messageById.value = byId;
    messagesByKey.value = byKey;
  }

  async function refreshThreads(): Promise<void> {
    await _withRefreshLock(async () => {
      const r = await api.getThreads();
      const list = Array.isArray(r.threads) ? r.threads.slice() : [];
      list.sort(_sortThreads);
      threads.value = list;
    });
  }

  async function refreshMessagesForKey(k0: string): Promise<void> {
    const k = String(k0 || "").trim() || "all";
    await _withRefreshLock(async () => {
      let threadId = "";
      if (k !== "all") {
        const t = threadIndex.value.get(k);
        threadId = String(t?.thread_id || "");
      }

      const r = await api.getMessages(threadId || undefined);
      const list = Array.isArray(r.messages) ? r.messages.slice() : [];

      // 没有 thread_id 时只能全量拉取；此时直接重建缓存。
      if (k === "all" || !threadId) {
        _rebuildCachesFromAll(list);
        return;
      }

      list.sort(_sortMessages);
      const nextByKey = new Map(messagesByKey.value);
      nextByKey.set(k, list);
      messagesByKey.value = nextByKey;

      const nextById = new Map(messageById.value);
      for (const m of list) {
        if (m && m.id) nextById.set(m.id, m);
      }
      messageById.value = nextById;
    });
  }

  async function refreshMessages(): Promise<void> {
    await refreshMessagesForKey(String(currentKey.value || "all"));
  }

  async function selectKey(key: string): Promise<void> {
    const k = String(key || "").trim() || "all";
    currentKey.value = k;
    clearUnreadForKey(k);

    // 点击会话时同步 follow 策略（保持与 legacy 行为一致）。
    if (k === "all") {
      try {
        await api.followAuto();
      } catch (_) {}
    } else {
      const t = threadIndex.value.get(k);
      const threadId = String(t?.thread_id || "");
      const file = String(t?.file || "");
      try {
        await api.followPin(threadId, file);
      } catch (_) {}
    }

    await refreshMessagesForKey(k);
    try {
      const list = (k === "all") ? messagesAll.value : (messagesByKey.value.get(k) || []);
      const last = list.length ? list[list.length - 1] : null;
      const id = String((last && last.id) ? last.id : "").trim();
      const next = new Map(readMarkByKey.value);
      if (id) next.set(k, id);
      else next.delete(k);
      readMarkByKey.value = next;
    } catch (_) {}
  }

  function upsertThreadFromMsg(msg: SidecarMessage): void {
    const k = keyOf(msg);
    if (!k || k === "unknown") return;
    const idx = new Map(threadIndex.value);
    const prev = idx.get(k) || {
      key: k,
      thread_id: String(msg.thread_id || ""),
      file: String(msg.file || ""),
      count: 0,
      last_ts: "",
      last_seq: 0,
    };
    const next: SidecarThread = {
      ...prev,
      thread_id: String(msg.thread_id || prev.thread_id || ""),
      file: String(msg.file || prev.file || ""),
      count: Math.max(0, Number(prev.count) || 0) + 1,
      last_ts: String(prev.last_ts || ""),
      last_seq: Math.max(0, Number(prev.last_seq) || 0),
    };
    const ts = String(msg.ts || "");
    if (ts && (!next.last_ts || ts > next.last_ts)) next.last_ts = ts;
    const seq = Number.isFinite(Number(msg.seq)) ? Number(msg.seq) : 0;
    if (seq && seq > next.last_seq) next.last_seq = seq;
    idx.set(k, next);

    const list = Array.from(idx.values());
    list.sort(_sortThreads);
    threads.value = list;
  }

  function _replaceInList(list: SidecarMessage[], id: string, nextMsg: SidecarMessage): SidecarMessage[] {
    const idx = list.findIndex((m) => m && m.id === id);
    if (idx < 0) return list;
    const next = list.slice();
    next[idx] = nextMsg;
    return next;
  }

  function _removeFromList(list: SidecarMessage[], id: string): SidecarMessage[] {
    const idx = list.findIndex((m) => m && m.id === id);
    if (idx < 0) return list;
    const next = list.slice();
    next.splice(idx, 1);
    return next;
  }

  function _insertSorted(list: SidecarMessage[], msg: SidecarMessage): SidecarMessage[] {
    const next = list.slice();
    if (next.length === 0) {
      next.push(msg);
      return next;
    }
    const last = next[next.length - 1];
    if (_sortMessages(last, msg) <= 0) {
      next.push(msg);
      return next;
    }
    // Binary insert to keep the timeline stable without re-sorting the full list each time.
    let lo = 0;
    let hi = next.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (_sortMessages(next[mid], msg) <= 0) lo = mid + 1;
      else hi = mid;
    }
    next.splice(lo, 0, msg);
    return next;
  }

  function applyIncomingMessage(msg: SidecarMessage): void {
    const op = String(msg.op || "").trim().toLowerCase();
    const mid = String(msg.id || "").trim();
    const existing = mid ? messageById.value.get(mid) : undefined;

    // Dedup: SSE reconnect/replay may resend messages; treat it as an update if id already exists.
    if (existing && mid) {
      const keepSeq = Number.isFinite(Number(existing.seq)) ? existing.seq : msg.seq;
      const patched: SidecarMessage = { ...existing, ...msg, seq: keepSeq };

      const byId = new Map(messageById.value);
      byId.set(mid, patched);
      messageById.value = byId;

      // Update caches (all + per-thread) without shifting ordering.
      messagesAll.value = _replaceInList(messagesAll.value, mid, patched);

      const prevKey = keyOf(existing);
      const nextKey = keyOf(patched);
      if (nextKey && nextKey !== "unknown") {
        const curMap = new Map(messagesByKey.value);
        if (prevKey && prevKey !== "unknown" && prevKey !== nextKey) {
          const prevList = curMap.get(prevKey) || [];
          curMap.set(prevKey, _removeFromList(prevList, mid));
        }
        const nextList = curMap.get(nextKey) || [];
        curMap.set(nextKey, _replaceInList(nextList, mid, patched));
        messagesByKey.value = curMap;
      }

      // 翻译回填完成后，解除 inFlight。
      try {
        const inflight = translateInFlight.value;
        if (inflight && inflight.has(mid) && (op === "update" || !!patched.zh || !!patched.translate_error)) {
          const n = new Set(inflight);
          n.delete(mid);
          translateInFlight.value = n;
        }
      } catch (_) {}
      return;
    }

    // op=update 不影响会话计数/排序。
    if (op !== "update") upsertThreadFromMsg(msg);

    // 未读策略：仅对回答输出与“等待确认”的 tool_gate。
    try {
      const kind = String(msg.kind || "").trim();
      if (op !== "update" && kind === "assistant_message") _markUnread(msg);
      if (op !== "update" && kind === "tool_gate") {
        const txt = String(msg.text || "");
        if (/waiting|confirm|approval|授权|确认|please confirm/i.test(txt)) _markUnread(msg);
      }
    } catch (_) {}

    // op=update but missing base: best-effort treat as insert.
    const k = keyOf(msg);

    // Insert into id index.
    if (mid) {
      const byId = new Map(messageById.value);
      byId.set(mid, msg);
      messageById.value = byId;
    }

    // Insert into caches (all + per-thread).
    messagesAll.value = _insertSorted(messagesAll.value, msg);
    if (k && k !== "unknown" && k !== "all") {
      const curMap = new Map(messagesByKey.value);
      const curList = curMap.get(k) || [];
      curMap.set(k, _insertSorted(curList, msg));
      messagesByKey.value = curMap;
    }
  }

  function applyIncomingBatch(msgs: SidecarMessage[]): void {
    const list = Array.isArray(msgs) ? msgs : [];
    for (const m of list) applyIncomingMessage(m);
  }

  async function bootstrap(): Promise<void> {
    try {
      lastError.value = "";
      // Try loading cached UI prefs first (best-effort).
      try {
        const vm = String(localStorage.getItem("codex_sidecar_view_mode_v1") || "").trim().toLowerCase();
        if (vm === "quick") setViewMode("quick");
      } catch (_) {}
      try {
        setThemeMode(_normalizeTheme(loadTheme()));
      } catch (_) {}
      await Promise.all([refreshThreads(), refreshMessages(), refreshConfig(), refreshStatus()]);
    } catch (e) {
      setLastError(String((e as Error)?.message || "bootstrap_failed"));
    }
  }

  async function refreshConfig(): Promise<void> {
    const r = await api.getConfig();
    const cfg = (r && r.config && typeof r.config === "object") ? (r.config as Record<string, unknown>) : {};
    config.value = cfg;
    try {
      const tm = String((r as any).translate_mode || (cfg as any).translate_mode || "auto").trim().toLowerCase();
      translateMode.value = tm === "manual" ? "manual" : "auto";
    } catch (_) {}
    try {
      translatorProvider.value = String((r as any).translator_provider || (cfg as any).translator_provider || translatorProvider.value || "openai").trim() || "openai";
    } catch (_) {}
    try {
      notifySound.value = String((r as any).notify_sound || (cfg as any).notify_sound || notifySound.value || "none").trim() || "none";
    } catch (_) {}
  }

  async function saveConfig(next: Record<string, unknown>): Promise<void> {
    const r = await api.saveConfig(next);
    const cfg = (r && r.config && typeof r.config === "object") ? (r.config as Record<string, unknown>) : {};
    config.value = cfg;
    try {
      const tm = String((r as any).translate_mode || (cfg as any).translate_mode || translateMode.value || "auto").trim().toLowerCase();
      translateMode.value = tm === "manual" ? "manual" : "auto";
    } catch (_) {}
    try {
      translatorProvider.value = String((r as any).translator_provider || (cfg as any).translator_provider || translatorProvider.value || "openai").trim() || "openai";
    } catch (_) {}
    try {
      notifySound.value = String((r as any).notify_sound || (cfg as any).notify_sound || notifySound.value || "none").trim() || "none";
    } catch (_) {}
  }

  async function recoverConfig(): Promise<void> {
    const r = await api.recoverConfig();
    const cfg = (r && r.config && typeof r.config === "object") ? (r.config as Record<string, unknown>) : {};
    config.value = cfg;
  }

  function openConfigDrawer(): void {
    configDrawerOpen.value = true;
  }

  function closeConfigDrawer(): void {
    configDrawerOpen.value = false;
  }

  async function refreshStatus(): Promise<void> {
    try {
      const st = await api.getStatus();
      statusText.value = String(st?.status || st?.state || "");
    } catch (_) {}
  }

  function setSseConnected(on: boolean): void {
    sseConnected.value = !!on;
  }

  function setLastError(err: string): void {
    const msg = String(err || "").trim();
    lastError.value = msg;
    if (!msg) return;
    try {
      useToastStore().warn(msg);
    } catch (_) {}
  }

  async function setTranslateMode(next: "auto" | "manual"): Promise<void> {
    const want = next === "manual" ? "manual" : "auto";
    translateMode.value = want;
    try {
      await saveConfig({ translate_mode: want });
    } catch (e) {
      // revert on failure
      await refreshConfig().catch(() => {});
      throw e;
    }
  }

  async function toggleTranslateMode(): Promise<void> {
    const cur = translateMode.value;
    await setTranslateMode(cur === "manual" ? "auto" : "manual");
  }

  async function requestRetranslate(mid: string): Promise<{ ok: boolean; error?: string }> {
    const id = String(mid || "").trim();
    if (!id) return { ok: false, error: "missing_id" };
    try {
      const next = new Set(translateInFlight.value);
      next.add(id);
      translateInFlight.value = next;
    } catch (_) {}
    try {
      const resp = await fetch("/api/control/retranslate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const obj = (await resp.json().catch(() => null)) as any;
      const ok = !!(resp.ok && obj && obj.ok !== false && obj.queued !== false);
      const err = String((obj && obj.error) ? obj.error : (resp.ok ? "" : `http_status=${resp.status}`));
      if (!ok) {
        const next = new Set(translateInFlight.value);
        next.delete(id);
        translateInFlight.value = next;
        return { ok: false, error: err || "request_failed" };
      }
      return { ok: true };
    } catch (e) {
      try {
        const next = new Set(translateInFlight.value);
        next.delete(id);
        translateInFlight.value = next;
      } catch (_) {}
      return { ok: false, error: String((e as Error)?.message || "request_failed") };
    }
  }

  return {
    currentKey,
    threads,
    threadIndex,
    viewMode,
    themeMode,
    labels,
    hiddenThreads,
    showHiddenThreads,
    unreadByKey,
    unreadTotal,
    readMarkByKey,
    messages,
    refreshInFlight,
    statusText,
    sseConnected,
    lastError,
    translateMode,
    translatorProvider,
    notifySound,
    translateInFlight,
    configDrawerOpen,
    config,

    setViewMode,
    toggleViewMode,
    setThemeMode,
    cycleThemeMode,
    formatThreadLabel,
    setCustomLabel,
    toggleHidden,
    setShowHidden,
    clearUnreadForKey,

    refreshThreads,
    refreshMessages,
    selectKey,
    applyIncomingMessage,
    applyIncomingBatch,
    bootstrap,
    refreshConfig,
    saveConfig,
    recoverConfig,
    openConfigDrawer,
    closeConfigDrawer,
    refreshStatus,
    setSseConnected,
    setLastError,
    setTranslateMode,
    toggleTranslateMode,
    requestRetranslate,
  };
});
