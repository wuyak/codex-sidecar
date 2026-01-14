export function setStatus(dom, s) {
  try { if (dom.statusText) dom.statusText.textContent = s || ""; } catch (_) {}
}

export function setDebug(dom, s) {
  try { if (dom.debugText) dom.debugText.textContent = s || ""; } catch (_) {}
}

export function openDrawer(dom) {
  try {
    if (dom.drawerOverlay) dom.drawerOverlay.classList.remove("hidden");
    if (dom.drawer) dom.drawer.classList.remove("hidden");
  } catch (_) {}
}

export function closeDrawer(dom) {
  try {
    if (dom.drawerOverlay) dom.drawerOverlay.classList.add("hidden");
    if (dom.drawer) dom.drawer.classList.add("hidden");
  } catch (_) {}
}

function showHttpFields(dom, show) {
  const els = [dom.httpProfile, dom.httpProfileAddBtn, dom.httpProfileRenameBtn, dom.httpProfileDelBtn, dom.httpUrl, dom.httpToken, dom.httpTimeout, dom.httpAuthEnv];
  for (const el of els) {
    if (!el) continue;
    el.disabled = !show;
    el.style.opacity = show ? "1" : "0.5";
  }
  try {
    if (dom.httpBlock) dom.httpBlock.style.display = show ? "" : "none";
  } catch (_) {}
}

function showOpenAIFields(dom, show) {
  const els = [dom.openaiBaseUrl, dom.openaiModel, dom.openaiApiKey, dom.openaiAuthMode, dom.openaiAuthEnv, dom.openaiReasoning, dom.openaiTimeout];
  for (const el of els) {
    if (!el) continue;
    el.disabled = !show;
    el.style.opacity = show ? "1" : "0.5";
  }
  try {
    if (dom.openaiBlock) dom.openaiBlock.style.display = show ? "" : "none";
  } catch (_) {}
}

function ensureOpenAIDefaults(dom) {
  try {
    if (dom.openaiBaseUrl && !String(dom.openaiBaseUrl.value || "").trim()) {
      dom.openaiBaseUrl.value = "https://www.right.codes/codex/v1";
    }
    if (dom.openaiModel && !String(dom.openaiModel.value || "").trim()) {
      const base = String(dom.openaiBaseUrl && dom.openaiBaseUrl.value ? dom.openaiBaseUrl.value : "").trim().toLowerCase();
      // right.codes 的 Codex 网关在“ChatGPT 账号”场景下可能不支持部分常见模型（例如 gpt-4o-mini）。
      // 给一个更稳妥的默认值，用户仍可按 /models 列表自行调整。
      dom.openaiModel.value = (base.includes("right.codes") && base.includes("/codex/")) ? "gpt-5.1" : "gpt-4o-mini";
    }
    if (dom.openaiTimeout && (dom.openaiTimeout.value === "" || dom.openaiTimeout.value == null)) {
      dom.openaiTimeout.value = 12;
    }
    if (dom.openaiAuthMode && !String(dom.openaiAuthMode.value || "").trim()) {
      dom.openaiAuthMode.value = "authorization";
    }
  } catch (_) {}
}

export function showProviderBlocks(dom, provider) {
  const p = String(provider || "").trim().toLowerCase();
  showHttpFields(dom, p === "http");
  showOpenAIFields(dom, p === "openai");
  if (p === "openai") ensureOpenAIDefaults(dom);
}

