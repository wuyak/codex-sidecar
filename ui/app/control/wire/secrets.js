import { api } from "../api.js";
import { toastFromEl } from "./ui_hints.js";

const MASK = "********";

const setEyeBtnState = (btn, shown, label) => {
  if (!btn) return;
  const isShown = !!shown;
  try { btn.classList.toggle("active", isShown); } catch (_) {}
  try {
    const use = btn.querySelector ? btn.querySelector("use") : null;
    // 语义：开眼=当前可见；斜杠眼=当前隐藏
    if (use && use.setAttribute) use.setAttribute("href", isShown ? "#i-eye" : "#i-eye-off");
  } catch (_) {}
  try { btn.setAttribute("aria-label", `${isShown ? "隐藏" : "显示"} ${label}`); } catch (_) {}
};

const toggleSecretField = async ({ btn, input, provider, field, label, getProfile }) => {
  if (!btn || !input) return;
  const curType = String(input.type || "text").toLowerCase();
  const shown = curType !== "password";
  if (shown) {
    try { input.type = "password"; } catch (_) {}
    setEyeBtnState(btn, false, label);
    return;
  }

  const curVal = String(input.value || "").trim();
  if (curVal === MASK) {
    let prof = "";
    try { prof = typeof getProfile === "function" ? String(getProfile() || "") : ""; } catch (_) { prof = ""; }
    try {
      const r = await api("POST", "/api/control/reveal_secret", { provider, field, profile: prof });
      const v = (r && r.ok) ? String(r.value || "") : "";
      if (!v) {
        toastFromEl(btn, "获取原文失败", { isLight: true, durationMs: 1800 });
        return;
      }
      input.value = v;
    } catch (_) {
      toastFromEl(btn, "获取原文失败", { isLight: true, durationMs: 1800 });
      return;
    }
  }

  try { input.type = "text"; } catch (_) {}
  setEyeBtnState(btn, true, label);
  try { input.focus(); } catch (_) {}
};

export function wireSecretToggles(dom, state) {
  // Init eye buttons (default hidden).
  try {
    setEyeBtnState(dom && dom.openaiBaseUrlEyeBtn, false, "Base URL");
    setEyeBtnState(dom && dom.openaiApiKeyEyeBtn, false, "API Key");
    setEyeBtnState(dom && dom.nvidiaApiKeyEyeBtn, false, "API Key");
    setEyeBtnState(dom && dom.httpTokenEyeBtn, false, "Token");
  } catch (_) {}

  if (dom && dom.openaiBaseUrlEyeBtn) dom.openaiBaseUrlEyeBtn.addEventListener("click", async () => {
    await toggleSecretField({ btn: dom.openaiBaseUrlEyeBtn, input: dom.openaiBaseUrl, provider: "openai", field: "base_url", label: "Base URL" });
  });
  if (dom && dom.openaiApiKeyEyeBtn) dom.openaiApiKeyEyeBtn.addEventListener("click", async () => {
    await toggleSecretField({ btn: dom.openaiApiKeyEyeBtn, input: dom.openaiApiKey, provider: "openai", field: "api_key", label: "API Key" });
  });
  if (dom && dom.nvidiaApiKeyEyeBtn) dom.nvidiaApiKeyEyeBtn.addEventListener("click", async () => {
    await toggleSecretField({ btn: dom.nvidiaApiKeyEyeBtn, input: dom.nvidiaApiKey, provider: "nvidia", field: "api_key", label: "API Key" });
  });
  if (dom && dom.httpTokenEyeBtn) dom.httpTokenEyeBtn.addEventListener("click", async () => {
    await toggleSecretField({
      btn: dom.httpTokenEyeBtn,
      input: dom.httpToken,
      provider: "http",
      field: "token",
      label: "Token",
      getProfile: () => (dom.httpProfile && dom.httpProfile.value) ? dom.httpProfile.value : (state && state.httpSelected ? state.httpSelected : ""),
    });
  });
}

