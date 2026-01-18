export function setStatus(dom, s) {
  try {
    if (dom.statusMain) dom.statusMain.textContent = s || "";
    else if (dom.statusText) dom.statusText.textContent = s || "";
  } catch (_) {}
}

export function setDebug(dom, s) {
  try { if (dom.debugText) dom.debugText.textContent = s || ""; } catch (_) {}
}

export function openDrawer(dom) {
  // Keep UI clean: config drawer and translate drawer are mutually exclusive.
  try { closeTranslateDrawer(dom); } catch (_) {}
  try { closeBookmarkDrawer(dom); } catch (_) {}
  try {
    if (dom.drawerOverlay) dom.drawerOverlay.classList.remove("hidden");
    if (dom.drawer) dom.drawer.classList.remove("hidden");
  } catch (_) {}
}

export function openTranslateDrawer(dom) {
  // Keep UI clean: config drawer and translate drawer are mutually exclusive.
  try { closeDrawer(dom); } catch (_) {}
  try { closeBookmarkDrawer(dom); } catch (_) {}
  try {
    if (dom.translateDrawerOverlay) dom.translateDrawerOverlay.classList.remove("hidden");
    if (dom.translateDrawer) dom.translateDrawer.classList.remove("hidden");
  } catch (_) {}
}

export function openBookmarkDrawer(dom) {
  // Keep UI clean: bookmark drawer is exclusive with config/translate drawers.
  try { closeTranslateDrawer(dom); } catch (_) {}
  try { closeDrawer(dom); } catch (_) {}
  try {
    if (dom.bookmarkDrawerOverlay) dom.bookmarkDrawerOverlay.classList.remove("hidden");
    if (dom.bookmarkDrawer) dom.bookmarkDrawer.classList.remove("hidden");
  } catch (_) {}
}

export function openTranslatorSettings(dom) {
  openTranslateDrawer(dom);
  try {
    setTimeout(() => {
      try { if (dom && dom.translatorSel && dom.translatorSel.focus) dom.translatorSel.focus(); } catch (_) {}
    }, 0);
  } catch (_) {}
}

export function closeDrawer(dom) {
  try {
    if (dom.drawerOverlay) dom.drawerOverlay.classList.add("hidden");
    if (dom.drawer) dom.drawer.classList.add("hidden");
  } catch (_) {}
}

export function closeTranslateDrawer(dom) {
  try {
    if (dom.translateDrawerOverlay) dom.translateDrawerOverlay.classList.add("hidden");
    if (dom.translateDrawer) dom.translateDrawer.classList.add("hidden");
  } catch (_) {}
}

export function closeBookmarkDrawer(dom) {
  try {
    if (dom.bookmarkDrawerOverlay) dom.bookmarkDrawerOverlay.classList.add("hidden");
    if (dom.bookmarkDrawer) dom.bookmarkDrawer.classList.add("hidden");
  } catch (_) {}
}

function showHttpFields(dom, show) {
  const els = [dom.httpProfile, dom.httpProfileAddBtn, dom.httpProfileRenameBtn, dom.httpProfileDelBtn, dom.httpUrl, dom.httpToken, dom.httpTimeout];
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
  const els = [dom.openaiBaseUrl, dom.openaiModel, dom.openaiApiKey, dom.openaiAuthMode, dom.openaiReasoning, dom.openaiTimeout];
  for (const el of els) {
    if (!el) continue;
    el.disabled = !show;
    el.style.opacity = show ? "1" : "0.5";
  }
  try {
    if (dom.openaiBlock) dom.openaiBlock.style.display = show ? "" : "none";
  } catch (_) {}
}

function showNvidiaFields(dom, show) {
  const els = [dom.nvidiaBaseUrl, dom.nvidiaModel, dom.nvidiaApiKey, dom.nvidiaMaxTokens, dom.nvidiaRpm, dom.nvidiaTimeout];
  for (const el of els) {
    if (!el) continue;
    el.disabled = !show;
    el.style.opacity = show ? "1" : "0.5";
  }
  try {
    if (dom.nvidiaBlock) dom.nvidiaBlock.style.display = show ? "" : "none";
  } catch (_) {}
}

function ensureOpenAIDefaults(dom) {
  try {
    if (dom.openaiBaseUrl && !String(dom.openaiBaseUrl.value || "").trim()) {
      dom.openaiBaseUrl.value = "https://www.right.codes/codex/v1";
    }
	    if (dom.openaiModel && !String(dom.openaiModel.value || "").trim()) {
	      dom.openaiModel.value = "gpt-5.1";
	    }
    if (dom.openaiTimeout && (dom.openaiTimeout.value === "" || dom.openaiTimeout.value == null)) {
      dom.openaiTimeout.value = 12;
    }
    if (dom.openaiAuthMode && !String(dom.openaiAuthMode.value || "").trim()) {
      dom.openaiAuthMode.value = "authorization";
    }
  } catch (_) {}
}

function ensureNvidiaDefaults(dom) {
  try {
    if (dom.nvidiaBaseUrl && !String(dom.nvidiaBaseUrl.value || "").trim()) {
      dom.nvidiaBaseUrl.value = "https://integrate.api.nvidia.com/v1";
    }
    if (dom.nvidiaModel && !String(dom.nvidiaModel.value || "").trim()) {
      dom.nvidiaModel.value = "moonshotai/kimi-k2-instruct";
    }
    if (dom.nvidiaRpm && (dom.nvidiaRpm.value === "" || dom.nvidiaRpm.value == null)) {
      dom.nvidiaRpm.value = 0;
    }
	    if (dom.nvidiaMaxTokens && (dom.nvidiaMaxTokens.value === "" || dom.nvidiaMaxTokens.value == null)) {
	      dom.nvidiaMaxTokens.value = 8192;
	    }
    if (dom.nvidiaTimeout && (dom.nvidiaTimeout.value === "" || dom.nvidiaTimeout.value == null)) {
      dom.nvidiaTimeout.value = 60;
    }
  } catch (_) {}
}

export function showProviderBlocks(dom, provider) {
  const p = String(provider || "").trim().toLowerCase();
  showHttpFields(dom, p === "http");
  showNvidiaFields(dom, p === "nvidia");
  showOpenAIFields(dom, p === "openai");
  if (p === "openai") ensureOpenAIDefaults(dom);
  if (p === "nvidia") ensureNvidiaDefaults(dom);
}
