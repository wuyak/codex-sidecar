const LS_LABELS = "codex_sidecar_thread_labels_v1";
const LS_HIDDEN = "codex_sidecar_hidden_threads_v1";
const LS_SHOW_HIDDEN = "codex_sidecar_show_hidden_threads_v1";
const LS_THEME = "codex_sidecar_theme_v1";

export function loadLabels(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_LABELS) || "";
    const obj = raw ? (JSON.parse(raw) as unknown) : {};
    if (obj && typeof obj === "object") return obj as Record<string, string>;
    return {};
  } catch (_) {
    return {};
  }
}

export function saveLabels(next: Record<string, string>): void {
  try {
    localStorage.setItem(LS_LABELS, JSON.stringify(next || {}));
  } catch (_) {}
}

export function loadHiddenThreads(): Set<string> {
  try {
    const raw = localStorage.getItem(LS_HIDDEN);
    const arr = JSON.parse(raw || "[]") as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((x) => String(x || "").trim()).filter(Boolean));
  } catch (_) {
    return new Set();
  }
}

export function saveHiddenThreads(next: Set<string>): void {
  try {
    const arr = Array.from(next || []).map((x) => String(x || "").trim()).filter(Boolean);
    localStorage.setItem(LS_HIDDEN, JSON.stringify(arr));
  } catch (_) {}
}

export function loadShowHiddenFlag(): boolean {
  try {
    return localStorage.getItem(LS_SHOW_HIDDEN) === "1";
  } catch (_) {
    return false;
  }
}

export function saveShowHiddenFlag(on: boolean): void {
  try {
    localStorage.setItem(LS_SHOW_HIDDEN, on ? "1" : "0");
  } catch (_) {}
}

export function loadTheme(): string {
  try {
    const raw = String(localStorage.getItem(LS_THEME) || "").trim().toLowerCase();
    if (raw === "flat") return "flat";
    if (raw === "dark") return "dark";
    return "default";
  } catch (_) {
    return "default";
  }
}

export function saveTheme(theme: string): void {
  try {
    const v = String(theme || "").trim().toLowerCase();
    localStorage.setItem(LS_THEME, v || "default");
  } catch (_) {}
}
