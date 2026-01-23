export const LS_UI_FONT = "codex_sidecar_ui_font_size";
export const LS_UI_BTN = "codex_sidecar_ui_btn_size";

export function readLocalStorageNumber(key, fallback) {
  const fb = Number.isFinite(Number(fallback)) ? Number(fallback) : 0;
  try {
    const raw = localStorage.getItem(String(key || ""));
    if (raw == null || raw === "") return fb;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fb;
  } catch (_) {
    return fb;
  }
}

export function applyUiFontSize(px) {
  const n = Number(px);
  const v = Number.isFinite(n) && n >= 12 && n <= 24 ? n : 14;
  try { document.documentElement.style.setProperty("--ui-font-size", `${v}px`); } catch (_) {}
  return v;
}

export function applyUiButtonSize(px) {
  const n = Number(px);
  const v = Number.isFinite(n) && n >= 32 && n <= 72 ? n : 38;
  try { document.documentElement.style.setProperty("--rightbar-w", `${v}px`); } catch (_) {}
  try {
    const ico = v >= 56 ? 24 : v >= 48 ? 22 : v >= 42 ? 20 : 18;
    document.documentElement.style.setProperty("--ui-ico-size", `${ico}px`);
  } catch (_) {}
  return v;
}

export function applyUiPrefsFromLocalStorage(dom) {
  const fontPx = readLocalStorageNumber(LS_UI_FONT, 14);
  const btnPx = readLocalStorageNumber(LS_UI_BTN, 38);
  try { applyUiFontSize(fontPx); } catch (_) {}
  try { applyUiButtonSize(btnPx); } catch (_) {}
  try { if (dom && dom.uiFontSize) dom.uiFontSize.value = String(Number.isFinite(fontPx) ? fontPx : 14); } catch (_) {}
  try { if (dom && dom.uiBtnSize) dom.uiBtnSize.value = String(Number.isFinite(btnPx) ? btnPx : 38); } catch (_) {}
  return { fontPx, btnPx };
}

