import { fmtErr } from "../utils.js";
import { api } from "./api.js";
import { applyProfileToInputs, countValidHttpProfiles, normalizeHttpProfiles, refreshHttpProfileSelect } from "./http_profiles.js";
import { setDebug, setStatus, showProviderBlocks } from "./ui.js";
import { preloadNotifySound } from "../sound.js";

export async function loadControl(dom, state) {
  const ts = Date.now();
  const debugLines = [];
  setDebug(dom, "");

  // 1) Translators（容错：接口失败时仍展示默认三项，避免“下拉为空”）
  let translators = [
    { id: "nvidia", label: "NVIDIA（NIM Chat Completions）" },
    { id: "openai", label: "GPT（Responses API 兼容）" },
    { id: "http", label: "HTTP（通用适配器）" },
  ];
  try {
    const tr = await fetch(`/api/translators?t=${ts}`, { cache: "no-store" }).then(r => r.json());
    const remote = Array.isArray(tr.translators) ? tr.translators : (Array.isArray(tr) ? tr : []);
    if (remote.length > 0) translators = remote;
  } catch (e) {
    debugLines.push(`[warn] /api/translators: ${fmtErr(e)}`);
  }
  try {
    if (dom.translatorSel) {
      dom.translatorSel.innerHTML = "";
      for (const t of translators) {
        const opt = document.createElement("option");
        opt.value = t.id || t.name || "";
        opt.textContent = t.label || t.id || t.name || "";
        dom.translatorSel.appendChild(opt);
      }
    }
  } catch (e) {
    debugLines.push(`[error] render translators: ${fmtErr(e)}`);
  }

  // 2) Config
  let cfg = {};
  let recovery = {};
  try {
    const c = await fetch(`/api/config?t=${ts}`, { cache: "no-store" }).then(r => r.json());
    cfg = c.config || c || {};
    recovery = (c && typeof c === "object") ? (c.recovery || {}) : {};
  } catch (e) {
    debugLines.push(`[error] /api/config: ${fmtErr(e)}`);
    cfg = {};
    recovery = {};
  }
  try {
    const canRecover = !!(recovery && typeof recovery === "object" && recovery.available);
    if (dom.recoverBtn) {
      dom.recoverBtn.disabled = !canRecover;
    }
  } catch (_) {}

  // 3) Apply config to UI（尽量继续，不让某个字段报错导致整体“全无”）
  try {
    if (dom.cfgHome) dom.cfgHome.value = cfg.config_home || "";
    if (dom.watchHome) dom.watchHome.value = cfg.watch_codex_home || "";
    if (dom.autoStart) dom.autoStart.value = cfg.auto_start ? "1" : "0";
    if (dom.translateMode) dom.translateMode.value = (cfg.translate_mode === "manual") ? "manual" : "auto";
    if (dom.notifySound) dom.notifySound.value = String(cfg.notify_sound || "none").trim().toLowerCase() || "none";
    if (dom.followProc) dom.followProc.value = cfg.follow_codex_process ? "1" : "0";
    if (dom.onlyWhenProc) dom.onlyWhenProc.value = (cfg.only_follow_when_process === false) ? "0" : "1";
    if (dom.procRegex) dom.procRegex.value = cfg.codex_process_regex || "codex";
    if (dom.replayLines) dom.replayLines.value = cfg.replay_last_lines ?? 0;
    if (dom.maxSessions) dom.maxSessions.value = cfg.watch_max_sessions ?? 3;
    if (dom.includeAgent) dom.includeAgent.value = cfg.include_agent_reasoning ? "1" : "0";
    if (dom.pollInterval) dom.pollInterval.value = cfg.poll_interval ?? 0.5;
    if (dom.scanInterval) dom.scanInterval.value = cfg.file_scan_interval ?? 2.0;
    if (dom.translatorSel) {
      const want = cfg.translator_provider || "openai";
      dom.translatorSel.value = want;
      if (dom.translatorSel.value !== want) dom.translatorSel.value = "openai";
    }
    const tc = cfg.translator_config || {};
    const tcObj = (tc && typeof tc === "object") ? tc : {};
    const httpTc = (tcObj.http && typeof tcObj.http === "object") ? tcObj.http : tcObj;
    const nvidiaTc = (tcObj.nvidia && typeof tcObj.nvidia === "object") ? tcObj.nvidia : tcObj;
    const openaiTc = (tcObj.openai && typeof tcObj.openai === "object") ? tcObj.openai : tcObj;
    const normalized = normalizeHttpProfiles(httpTc || {});
    state.httpProfiles = normalized.profiles;
    state.httpSelected = normalized.selected;
    refreshHttpProfileSelect(dom, state);
    if (state.httpSelected) applyProfileToInputs(dom, state, state.httpSelected);
    // openai provider fields
    try {
      const oh = openaiTc || {};
      if (dom.openaiBaseUrl) dom.openaiBaseUrl.value = oh.base_url || "";
      if (dom.openaiModel) dom.openaiModel.value = oh.model || "";
      if (dom.openaiApiKey) dom.openaiApiKey.value = oh.api_key || "";
      if (dom.openaiTimeout) dom.openaiTimeout.value = oh.timeout_s ?? 12;
      const ah = String(oh.auth_header || "Authorization").toLowerCase();
      if (dom.openaiAuthMode) dom.openaiAuthMode.value = (ah === "x-api-key") ? "x-api-key" : "authorization";
      if (dom.openaiReasoning) dom.openaiReasoning.value = oh.reasoning_effort || "";
    } catch (_) {}
    // nvidia provider fields
    try {
      const nh = nvidiaTc || {};
      if (dom.nvidiaBaseUrl) dom.nvidiaBaseUrl.value = nh.base_url || "";
      try { if (dom.nvidiaModel) dom.nvidiaModel.value = String(nh.model || "").trim(); } catch (_) {}
      if (dom.nvidiaApiKey) dom.nvidiaApiKey.value = nh.api_key || "";
      if (dom.nvidiaTimeout) dom.nvidiaTimeout.value = nh.timeout_s ?? 60;
      if (dom.nvidiaRpm) dom.nvidiaRpm.value = nh.rpm ?? 0;
      if (dom.nvidiaMaxTokens) dom.nvidiaMaxTokens.value = nh.max_tokens ?? 8192;
    } catch (_) {}
    showProviderBlocks(dom, (dom.translatorSel && dom.translatorSel.value) ? dom.translatorSel.value : "");
  } catch (e) {
    debugLines.push(`[error] apply config: ${fmtErr(e)}`);
  }

  // Keep a copy on state for render logic (no need to re-fetch cfg on every click).
  try {
    state.watchCodexHome = String(cfg.watch_codex_home || "");
    state.translateMode = (cfg.translate_mode === "manual") ? "manual" : "auto";
    state.translatorProvider = String(cfg.translator_provider || "openai").trim().toLowerCase() || "openai";
    state.notifySound = String(cfg.notify_sound || "none").trim().toLowerCase() || "none";
  } catch (_) {}
  try { preloadNotifySound(state); } catch (_) {}
  try {
    const btn = dom && dom.translateToggleBtn ? dom.translateToggleBtn : null;
    if (btn && btn.classList) {
      const isAuto = (String(state.translateMode || "").toLowerCase() !== "manual");
      btn.classList.toggle("active", isAuto);
    }
  } catch (_) {}

  // 3.1) 提示恢复：Profiles 为空但存在可恢复备份（仅提示一次）
  try {
    if (!window.__sidecarRecoveryPrompted) window.__sidecarRecoveryPrompted = false;
    const provider = String(cfg.translator_provider || "").trim().toLowerCase();
    const canRecover = !!(recovery && typeof recovery === "object" && recovery.available);
    const valid = countValidHttpProfiles(state.httpProfiles);
    if (!window.__sidecarRecoveryPrompted && provider === "http" && valid <= 0 && canRecover) {
      window.__sidecarRecoveryPrompted = true;
      if (confirm("检测到翻译 HTTP Profiles 为空，但本机备份中存在可恢复配置。是否现在恢复？")) {
        await api("POST", "/api/config/recover", {});
        await loadControl(dom, state);
        return;
      }
    }
  } catch (e) {}

  // 4) Status（运行态提示）
  let st = null;
  try {
    st = await fetch(`/api/status?t=${ts}`, { cache: "no-store" }).then(r => r.json());
    const sidecarPid = (st && (st.pid !== undefined) && (st.pid !== null)) ? String(st.pid) : "";
    const sidecarSuffix = sidecarPid ? ` | sidecar:${sidecarPid}` : "";
    const w = (st && st.watcher) ? st.watcher : {};
    const cur = w.current_file || "";
    const mode = w.follow_mode || "";
    const detected = (w.codex_detected === "1");
    const pids = w.codex_pids || "";
    let detail = "";
    let followHint = "";
    try {
      const f = (st && typeof st === "object") ? (st.follow || {}) : {};
      const fm = String((f && f.mode) ? f.mode : "").trim().toLowerCase();
      if (fm === "pin") followHint = " | pin";
    } catch (_) {}
    try {
      const fs = Array.isArray(w.follow_files) ? w.follow_files : [];
      if (fs.length > 1) followHint = `${followHint} | tail:${fs.length}`;
    } catch (_) {}
    if (mode === "idle") detail = `（等待 Codex 进程${followHint}）`;
    else if (mode === "process") detail = pids ? `（process | pid:${pids}${followHint}）` : `（process${followHint}）`;
    else if (mode === "fallback") detail = detected && pids ? `（fallback | pid:${pids}${followHint}）` : `（fallback${followHint}）`;
    else if (mode) {
      const mm = String(mode || "");
      const extra = (followHint && !mm.startsWith("pinned")) ? followHint : "";
      detail = `(${mm}${extra})`;
    }
    else if (followHint) detail = `(auto${followHint})`;
    if (st.running) {
      if (cur) setStatus(dom, `运行中：${cur} ${detail}${sidecarSuffix}`.trim());
      else setStatus(dom, `运行中：${detail}${sidecarSuffix}`.trim());
    } else {
      setStatus(dom, `未运行${sidecarSuffix}`.trim());
    }
    try {
      if (dom.startBtn) dom.startBtn.disabled = !!st.running;
      if (dom.stopBtn) dom.stopBtn.disabled = !st.running;
      if (dom.restartBtn) dom.restartBtn.disabled = false;
    } catch (_) {}
  } catch (e) {
    debugLines.push(`[warn] /api/status: ${fmtErr(e)}`);
  }

  // 5) Debug summary（不打印 token/url）
  try {
    const provider = String(cfg.translator_provider || "");
    const profNames = (state.httpProfiles || []).map(p => (p && p.name) ? String(p.name) : "").filter(Boolean);
    const cfgHomePath = String(cfg.config_home || "").replace(/\/+$/, "");
    const cfgFile = cfgHomePath ? `${cfgHomePath}/config.json` : "";
    const rAvail = (recovery && typeof recovery === "object" && recovery.available) ? "yes" : "no";
    const rSrc = (recovery && typeof recovery === "object" && recovery.source) ? String(recovery.source || "") : "";
    debugLines.unshift(
      `config_home: ${cfg.config_home || ""}`,
      `watch_codex_home: ${cfg.watch_codex_home || ""}`,
      `config_file: ${cfgFile}`,
      `recovery_available: ${rAvail}${rSrc ? " (" + rSrc + ")" : ""}`,
      `translator_provider: ${provider}`,
      `http_profiles: ${profNames.length}${profNames.length ? " (" + profNames.join(", ") + ")" : ""}`,
      `http_selected: ${state.httpSelected || ""}`,
    );
    if (provider.toLowerCase() === "openai") {
      const tc = cfg.translator_config || {};
      const tcObj = (tc && typeof tc === "object") ? tc : {};
      const openaiTc = (tcObj.openai && typeof tcObj.openai === "object") ? tcObj.openai : tcObj;
      const base = String(openaiTc.base_url || "");
      const model = String(openaiTc.model || "");
      debugLines.splice(5, 0, `openai_base_url: ${base}`, `openai_model: ${model}`);
    }
    if (provider.toLowerCase() === "nvidia") {
      const tc = cfg.translator_config || {};
      const tcObj = (tc && typeof tc === "object") ? tc : {};
      const nvidiaTc = (tcObj.nvidia && typeof tcObj.nvidia === "object") ? tcObj.nvidia : tcObj;
      const base = String(nvidiaTc.base_url || "");
      const model = String(nvidiaTc.model || "");
      debugLines.splice(5, 0, `nvidia_base_url: ${base}`, `nvidia_model: ${model}`);
    }
    // Translation worker stats (help diagnose "ZH 翻译中…" delays).
    try {
      const ws = st && typeof st === "object" ? (st.watcher || {}) : {};
      const tr = ws && typeof ws === "object" ? (ws.translate || {}) : {};
      if (tr && typeof tr === "object") {
        const hi = Number(tr.hi_q);
        const lo = Number(tr.lo_q);
        const lastMs = Number(tr.last_translate_ms);
        const lastN = Number(tr.last_batch_n);
        const dropOld = Number(tr.drop_old_hi || 0) + Number(tr.drop_old_lo || 0);
        const dropNew = Number(tr.drop_new_hi || 0) + Number(tr.drop_new_lo || 0);
        const done = Number(tr.done_items);
        const err = String(tr.last_error || "");
        const lines = [
          `translate_q: hi=${Number.isFinite(hi) ? hi : ""} lo=${Number.isFinite(lo) ? lo : ""}`,
          `translate_last: ${Number.isFinite(lastMs) ? lastMs.toFixed(0) : ""}ms batch_n=${Number.isFinite(lastN) ? lastN : ""}`,
          `translate_done: ${Number.isFinite(done) ? done : ""} drop_old=${Number.isFinite(dropOld) ? dropOld : ""} drop_new=${Number.isFinite(dropNew) ? dropNew : ""}`,
        ];
        if (err) lines.push(`translate_last_error: ${err}`);
        debugLines.push(...lines);
      }
    } catch (_) {}
  } catch (e) {
    debugLines.push(`[warn] debug: ${fmtErr(e)}`);
  }
  if (debugLines.length) setDebug(dom, debugLines.join("\n"));
}
