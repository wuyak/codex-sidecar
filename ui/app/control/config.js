import { fmtErr } from "../utils.js";
import { api } from "./api.js";
import { flashToastAt } from "../utils/toast.js";
import { countValidHttpProfiles, refreshHttpProfileSelect, upsertSelectedProfileFromInputs } from "./http_profiles.js";
import { loadControl } from "./load.js";
import { setDebug, setStatus } from "./ui.js";

function _clearFormError(dom, which) {
  try {
    if (which === "config") {
      if (dom.configErrorText) dom.configErrorText.textContent = "";
      return;
    }
    if (which === "translate") {
      if (dom.translateErrorText) dom.translateErrorText.textContent = "";
      return;
    }
  } catch (_) {}
}

function _setFormError(dom, which, msg) {
  const text = String(msg || "").trim();
  try {
    if (which === "config") {
      if (dom.configErrorText) dom.configErrorText.textContent = text;
      return;
    }
    if (which === "translate") {
      if (dom.translateErrorText) dom.translateErrorText.textContent = text;
      return;
    }
  } catch (_) {}
}

function _clearInvalidFields(dom) {
  const els = [
    dom.openaiBaseUrl, dom.openaiModel, dom.openaiApiKey,
    dom.nvidiaBaseUrl, dom.nvidiaModel, dom.nvidiaApiKey,
    dom.httpUrl, dom.httpToken,
  ];
  for (const el of els) {
    try { if (el && el.classList) el.classList.remove("field-invalid"); } catch (_) {}
  }
}

function _markInvalid(dom, el, msg) {
  try { _setFormError(dom, "translate", msg); } catch (_) {}
  try { if (el && el.classList) el.classList.add("field-invalid"); } catch (_) {}
  try { if (el && typeof el.focus === "function") el.focus(); } catch (_) {}
}

function _buildTranslatorPatch(dom, state) {
  const provider = (dom.translatorSel && dom.translatorSel.value) ? dom.translatorSel.value : "openai";
  const patch = { translator_provider: provider };
  if (provider === "http") {
    if (!state.httpSelected && state.httpProfiles.length > 0) state.httpSelected = state.httpProfiles[0].name || "";
    if (!state.httpSelected) state.httpSelected = "默认";
    upsertSelectedProfileFromInputs(dom, state);
    refreshHttpProfileSelect(dom, state);
    patch.translator_config = { http: { profiles: state.httpProfiles, selected: state.httpSelected } };
  }
  if (provider === "openai") {
    const base = (dom.openaiBaseUrl && dom.openaiBaseUrl.value) ? dom.openaiBaseUrl.value.trim() : "";
    const model = (dom.openaiModel && dom.openaiModel.value) ? dom.openaiModel.value.trim() : "";
    const apiKey = (dom.openaiApiKey && dom.openaiApiKey.value) ? dom.openaiApiKey.value.trim() : "";
    const mode = (dom.openaiAuthMode && dom.openaiAuthMode.value) ? dom.openaiAuthMode.value : "authorization";
    const reasoning = (dom.openaiReasoning && dom.openaiReasoning.value) ? dom.openaiReasoning.value.trim() : "";
    const timeout = Number((dom.openaiTimeout && dom.openaiTimeout.value) ? dom.openaiTimeout.value : 12);
    if (!base) return { ok: false, error: "missing_openai_base_url" };
    if (!model) return { ok: false, error: "missing_openai_model" };
    if (!apiKey) return { ok: false, error: "missing_openai_key" };
    const auth_header = (mode === "x-api-key") ? "x-api-key" : "Authorization";
    const auth_prefix = (mode === "x-api-key") ? "" : "Bearer ";
    patch.translator_config = {
      openai: {
        base_url: base,
        model,
        api_key: apiKey,
        timeout_s: timeout,
        auth_header,
        auth_prefix,
        reasoning_effort: reasoning,
      },
    };
  }
  if (provider === "nvidia") {
    const base = (dom.nvidiaBaseUrl && dom.nvidiaBaseUrl.value) ? dom.nvidiaBaseUrl.value.trim() : "";
    const model = (dom.nvidiaModel && dom.nvidiaModel.value) ? dom.nvidiaModel.value.trim() : "";
    const apiKey = (dom.nvidiaApiKey && dom.nvidiaApiKey.value) ? dom.nvidiaApiKey.value.trim() : "";
    const maxTokens = 8192;
    const rpm = Number((dom.nvidiaRpm && dom.nvidiaRpm.value) ? dom.nvidiaRpm.value : 0);
    const timeout = Number((dom.nvidiaTimeout && dom.nvidiaTimeout.value) ? dom.nvidiaTimeout.value : 60);
    if (!base) return { ok: false, error: "missing_nvidia_base_url" };
    if (!model) return { ok: false, error: "missing_nvidia_model" };
    if (!apiKey) return { ok: false, error: "missing_nvidia_key" };
    patch.translator_config = {
      nvidia: {
        base_url: base,
        model,
        api_key: apiKey,
        max_tokens: maxTokens,
        rpm,
        timeout_s: timeout,
        max_retries: 3,
      },
    };
  }
  return { ok: true, patch, provider };
}

export async function saveTranslateConfig(dom, state) {
  _clearFormError(dom, "translate");
  _clearInvalidFields(dom);

  const built = _buildTranslatorPatch(dom, state);
  if (!built || built.ok === false) {
    const err = String(built && built.error ? built.error : "invalid_translate_config");
    if (err === "missing_openai_base_url") { _markInvalid(dom, dom.openaiBaseUrl, "请填写 Base URL（例如 https://www.right.codes/codex/v1）"); return; }
    if (err === "missing_openai_model") { _markInvalid(dom, dom.openaiModel, "请填写 Model（例如 gpt-5.1）"); return; }
    if (err === "missing_openai_key") { _markInvalid(dom, dom.openaiApiKey, "请填写 API Key"); return; }
    if (err === "missing_nvidia_base_url") { _markInvalid(dom, dom.nvidiaBaseUrl, "请填写 Base URL（例如 https://integrate.api.nvidia.com/v1）"); return; }
    if (err === "missing_nvidia_model") { _markInvalid(dom, dom.nvidiaModel, "请填写 Model（例如 moonshotai/kimi-k2-instruct）"); return; }
    if (err === "missing_nvidia_key") { _markInvalid(dom, dom.nvidiaApiKey, "请填写 API Key"); return; }
    _setFormError(dom, "translate", "翻译设置不完整，请检查输入。");
    return;
  }
  const provider = built.provider;

  if (provider === "http") {
    const valid = countValidHttpProfiles(state.httpProfiles);
    if (valid <= 0) {
      _markInvalid(dom, dom.httpUrl, "请至少保留 1 个可用的 HTTP Profile（需要 name + http/https URL），或切换翻译 Provider。");
      return;
    }
  }

  setStatus(dom, "正在保存翻译设置…");
  const saved = await api("POST", "/api/config", built.patch);
  if (saved && saved.ok === false) {
    const err = String(saved.error || "");
    if (err === "empty_http_profiles") {
      _setFormError(dom, "translate", "保存被拒绝：HTTP Profiles 为空/不可用。请至少保留 1 个可用的 Profile（name + http/https URL），或切换翻译 Provider。");
    } else {
      _setFormError(dom, "translate", `保存失败：${err || "unknown_error"}`);
    }
    setStatus(dom, "保存失败");
    return;
  }
  await loadControl(dom, state);
  setStatus(dom, "已保存翻译设置");

  // 保存后自动自检翻译（无需 UI 里单独的“测试按钮”）。
  try {
    if (!state) state = {};
    const seq = (Number(state.translateProbeSeq) || 0) + 1;
    state.translateProbeSeq = seq;
    setStatus(dom, "已保存翻译设置（正在自检翻译…）");
    Promise.resolve(api("POST", "/api/control/translate_probe", {})).then((r) => {
      try { if (Number(state.translateProbeSeq) !== seq) return; } catch (_) {}
      const ok = !!(r && r.ok);
      const err = String((r && r.error) ? r.error : "").trim();
      const label = ok ? "翻译自检：成功" : `翻译自检：失败${err ? "（" + err + "）" : ""}`;
      setStatus(dom, ok ? "已保存翻译设置（自检成功）" : "已保存翻译设置（自检失败）");
      try {
        const btn = dom && dom.saveTranslateBtn ? dom.saveTranslateBtn : null;
        const rect = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
        const x = rect ? (rect.left + rect.width / 2) : (window.innerWidth / 2);
        const y = rect ? (rect.top + rect.height / 2) : 24;
        flashToastAt(x, y, label, { isLight: true, durationMs: ok ? 1200 : 2000 });
      } catch (_) {}
    }).catch((_e) => {
      try { if (Number(state.translateProbeSeq) !== seq) return; } catch (_) {}
      setStatus(dom, "已保存翻译设置（自检失败）");
      try {
        const btn = dom && dom.saveTranslateBtn ? dom.saveTranslateBtn : null;
        const rect = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
        const x = rect ? (rect.left + rect.width / 2) : (window.innerWidth / 2);
        const y = rect ? (rect.top + rect.height / 2) : 24;
        flashToastAt(x, y, "翻译自检：失败（request_failed）", { isLight: true, durationMs: 2000 });
      } catch (_) {}
    });
  } catch (_) {}
}

export async function saveConfig(dom, state) {
  _clearFormError(dom, "config");

  let wasRunning = false;
  try {
    const st = await fetch(`/api/status?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json());
    wasRunning = !!(st && st.running);
  } catch (e) {}

  const patch = {
    auto_start: (dom.autoStart && dom.autoStart.value) === "1",
    notify_sound_assistant: (dom.notifySoundAssistant && dom.notifySoundAssistant.value) ? dom.notifySoundAssistant.value : "none",
    notify_sound_tool_gate: (dom.notifySoundToolGate && dom.notifySoundToolGate.value) ? dom.notifySoundToolGate.value : "none",
    follow_codex_process: (dom.followProc && dom.followProc.value) === "1",
    only_follow_when_process: (dom.onlyWhenProc && dom.onlyWhenProc.value) === "1",
    codex_process_regex: ((dom.procRegex && dom.procRegex.value) ? dom.procRegex.value : "codex").trim(),
    watch_max_sessions: Number((dom.maxSessions && dom.maxSessions.value) ? dom.maxSessions.value : 3),
    replay_last_lines: Number((dom.replayLines && dom.replayLines.value) ? dom.replayLines.value : 0),
    poll_interval: Number((dom.pollInterval && dom.pollInterval.value) ? dom.pollInterval.value : 0.5),
    file_scan_interval: Number((dom.scanInterval && dom.scanInterval.value) ? dom.scanInterval.value : 2.0),
  };

  setStatus(dom, "正在保存配置…");
  const saved = await api("POST", "/api/config", patch);
  if (saved && saved.ok === false) {
    const err = String(saved.error || "");
    _setFormError(dom, "config", `保存失败：${err || "unknown_error"}`);
    setStatus(dom, "保存失败");
    return;
  }
  if (!wasRunning && patch.auto_start) {
    // 让“自动开始”在保存后即可生效（无需手动点开始）。
    await api("POST", "/api/control/start");
  }
  await loadControl(dom, state);
  setStatus(dom, "已保存配置");
}
