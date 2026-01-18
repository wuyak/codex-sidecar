import { fmtErr, rolloutStampFromFile, shortId } from "../utils.js";
import { api } from "./api.js";
import { applyProfileToInputs, normalizeHttpProfiles, refreshHttpProfileSelect } from "./http_profiles.js";
import { setDebug, setTopStatusSummary, showProviderBlocks } from "./ui.js";
import { preloadNotifySound } from "../sound.js";

const _LS_UI_FONT = "codex_sidecar_ui_font_size";
const _LS_UI_BTN = "codex_sidecar_ui_btn_size";

function _prettyPath(p) {
  const s = String(p || "").trim();
  if (!s) return "";
  // Linux/WSL: /home/<user>/...
  let m = s.match(/^\/home\/[^/]+(\/.*)?$/);
  if (m) return `~${m[1] || ""}`;
  // macOS: /Users/<user>/...
  m = s.match(/^\/Users\/[^/]+(\/.*)?$/);
  if (m) return `~${m[1] || ""}`;
  // WSL (Windows home mounted): /mnt/<drive>/Users/<user>/...
  m = s.match(/^\/mnt\/[a-zA-Z]\/Users\/[^/]+(\/.*)?$/);
  if (m) return `/mnt/<drive>/Users/~${m[1] || ""}`;
  // Windows: C:\Users\<user>\...
  m = s.match(/^[a-zA-Z]:\\Users\\[^\\]+(\\.*)?$/);
  if (m) return `~${m[1] || ""}`;
  return s;
}

function _applyUiFontSize(px) {
  const n = Number(px);
  const v = Number.isFinite(n) && n >= 12 && n <= 24 ? n : 14;
  try { document.documentElement.style.setProperty("--ui-font-size", `${v}px`); } catch (_) {}
}

function _applyUiButtonSize(px) {
  const n = Number(px);
  const v = Number.isFinite(n) && n >= 32 && n <= 72 ? n : 38;
  try { document.documentElement.style.setProperty("--rightbar-w", `${v}px`); } catch (_) {}
  try {
    const ico = v >= 56 ? 24 : v >= 48 ? 22 : v >= 42 ? 20 : 18;
    document.documentElement.style.setProperty("--ui-ico-size", `${ico}px`);
  } catch (_) {}
}

export async function loadControl(dom, state) {
  const ts = Date.now();
  const debugLines = [];
  setDebug(dom, "");

  const _esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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
  try {
    const c = await api("GET", "/api/config");
    const raw = (c && typeof c === "object") ? c : {};
    const inner = (raw.config && typeof raw.config === "object") ? raw.config : raw;
    cfg = (inner && typeof inner === "object") ? inner : {};
  } catch (e) {
    debugLines.push(`[warn] /api/config: ${fmtErr(e)}`);
    cfg = {};
  }

  // 3) Apply config to UI（尽量继续，不让某个字段报错导致整体“全无”）
  try {
    if (dom.cfgHome) dom.cfgHome.value = String(cfg.config_home_display || "").trim() || _prettyPath(cfg.config_home || "");
    if (dom.watchHome) dom.watchHome.value = _prettyPath(cfg.watch_codex_home || "");
    if (dom.autoStart) dom.autoStart.value = cfg.auto_start ? "1" : "0";
    if (dom.translateMode) dom.translateMode.value = (cfg.translate_mode === "manual") ? "manual" : "auto";
    if (dom.notifySound) dom.notifySound.value = String(cfg.notify_sound || "none").trim().toLowerCase() || "none";
    if (dom.followProc) dom.followProc.value = cfg.follow_codex_process ? "1" : "0";
    if (dom.onlyWhenProc) dom.onlyWhenProc.value = (cfg.only_follow_when_process === false) ? "0" : "1";
    if (dom.procRegex) dom.procRegex.value = cfg.codex_process_regex || "codex";
    if (dom.replayLines) dom.replayLines.value = cfg.replay_last_lines ?? 0;
    if (dom.maxSessions) dom.maxSessions.value = cfg.watch_max_sessions ?? 3;
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
      if (dom.nvidiaMaxTokensText) dom.nvidiaMaxTokensText.textContent = "8192";
    } catch (_) {}
    showProviderBlocks(dom, (dom.translatorSel && dom.translatorSel.value) ? dom.translatorSel.value : "");
    // Secret fields: always reset to "password" after a reload, so saved values don't stay visible.
    try {
      const reset = (input, btn, label) => {
        try { if (input) input.type = "password"; } catch (_) {}
        try {
          if (!btn) return;
          btn.classList.toggle("active", false);
          btn.setAttribute("aria-label", `显示 ${label}`);
          const use = btn.querySelector ? btn.querySelector("use") : null;
          if (use && use.setAttribute) use.setAttribute("href", "#i-eye");
        } catch (_) {}
      };
      reset(dom.openaiBaseUrl, dom.openaiBaseUrlEyeBtn, "Base URL");
      reset(dom.openaiApiKey, dom.openaiApiKeyEyeBtn, "API Key");
      reset(dom.nvidiaApiKey, dom.nvidiaApiKeyEyeBtn, "API Key");
      reset(dom.httpToken, dom.httpTokenEyeBtn, "Token");
    } catch (_) {}
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
      try {
      const hint = "（长按打开翻译设置）";
      btn.setAttribute("aria-label", isAuto ? `自动翻译：已开启${hint}` : `自动翻译：已关闭${hint}`);
      } catch (_) {}
      try { btn.dataset.mode = isAuto ? "A" : "手"; } catch (_) {}
    }

    // UI-only prefs (persisted in localStorage)
    try {
      const fontPx = Number(localStorage.getItem(_LS_UI_FONT) || "14");
      const btnPx = Number(localStorage.getItem(_LS_UI_BTN) || "38");
      _applyUiFontSize(fontPx);
      _applyUiButtonSize(btnPx);
      if (dom.uiFontSize) dom.uiFontSize.value = String(Number.isFinite(fontPx) ? fontPx : 14);
      if (dom.uiBtnSize) dom.uiBtnSize.value = String(Number.isFinite(btnPx) ? btnPx : 38);
    } catch (_) {}
  } catch (_) {}

  // 4) Status（运行态提示）
  let st = null;
  try {
    st = await fetch(`/api/status?t=${ts}`, { cache: "no-store" }).then(r => r.json());
    const w = (st && st.watcher) ? st.watcher : {};
    const fs = Array.isArray(w.follow_files) ? w.follow_files : [];

    const selMode = (() => {
      try {
        const f = (st && typeof st === "object") ? (st.follow || {}) : {};
        return String((f && f.mode) ? f.mode : "").trim().toLowerCase();
      } catch (_) {
        return "";
      }
    })();

    const err = String((st && st.last_error) ? st.last_error : (w && w.last_error) ? w.last_error : "").trim();

    try { if (state) state.statusFollowFiles = fs; } catch (_) {}
    try { if (state) state.statusSelectionMode = selMode; } catch (_) {}
    try { if (state) state.statusLastError = err; } catch (_) {}
    try { if (state) state.running = !!st.running; } catch (_) {}
    setTopStatusSummary(dom, state);

    // Hover details: only what users care about (which sessions are followed).
    let hoverHtml = "";
    try {
      const _rolloutIdPart = (p) => {
        const base = String(p || "").split("/").slice(-1)[0] || "";
        const m = base.match(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.*)\.jsonl$/);
        if (m && m[1]) return String(m[1]);
        return base.replace(/\.jsonl$/i, "");
      };
      const items = fs.map((p, idx) => {
        const stamp = rolloutStampFromFile(p) || "未知时间";
        const sid = shortId(_rolloutIdPart(p));
        const title = _prettyPath(p);
        return `<div class="sh-item" title="${_esc(title)}"><span class="sh-tag">#${idx + 1}</span><span class="sh-stamp">${_esc(stamp)}</span><span class="sh-id"><code>${_esc(sid)}</code></span></div>`;
      }).join("");

      if (err) {
        hoverHtml += `<div class="sh-error">异常：<code>${_esc(err)}</code></div>`;
      }
      if (fs.length) {
        hoverHtml += `<div class="sh-sec"><div class="sh-title">当前跟随 <span class="sh-count">${fs.length}</span></div><div class="sh-list sh-list-clean">${items}</div></div>`;
      } else if (st.running) {
        hoverHtml += `<div class="sh-empty">暂无会话（等待 Codex 写入 rollout）</div>`;
      } else {
        hoverHtml += `<div class="sh-empty">未监听（点击 ▶ 开始监听）</div>`;
      }
    } catch (_) { hoverHtml = ""; }

    try {
      if (dom.statusHover) dom.statusHover.innerHTML = hoverHtml || "";
      if (dom.statusText) dom.statusText.title = "悬停查看当前跟随会话";
    } catch (_) {}
    try {
      const btn = (dom && dom.watchToggleBtn) ? dom.watchToggleBtn : null;
      if (btn) {
        try { btn.classList.toggle("active", !!st.running); } catch (_) {}
        try { btn.setAttribute("aria-label", st.running ? "停止监听" : "开始监听"); } catch (_) {}
        try {
          const use = btn.querySelector ? btn.querySelector("use") : null;
          if (use && use.setAttribute) use.setAttribute("href", st.running ? "#i-stop" : "#i-play");
        } catch (_) {}
      }
    } catch (_) {}
  } catch (e) {
    debugLines.push(`[warn] /api/status: ${fmtErr(e)}`);
  }

  // 5) Debug summary（不打印 token/url）
  try {
    const provider = String(cfg.translator_provider || "");
    const profNames = (state.httpProfiles || []).map(p => (p && p.name) ? String(p.name) : "").filter(Boolean);
    const cfgHomeShown = String(cfg.config_home_display || "").trim() || String(cfg.config_home || "").trim();
    const cfgFile = String(cfg.config_file_display || "").trim() || (cfgHomeShown ? `${cfgHomeShown.replace(/\/+$/, "")}/config.json` : "");
    const watchHomeShown = _prettyPath(cfg.watch_codex_home || "");
    debugLines.unshift(
      `config_home: ${cfgHomeShown}`,
      `watch_codex_home: ${watchHomeShown}`,
      `config_file: ${cfgFile}`,
      `translator_provider: ${provider}`,
      `http_profiles: ${profNames.length}${profNames.length ? " (" + profNames.join(", ") + ")" : ""}`,
      `http_selected: ${state.httpSelected || ""}`,
    );
    try {
      const ws = st && typeof st === "object" ? (st.watcher || {}) : {};
      const wm = (ws && ws.watch_max_sessions !== undefined) ? ws.watch_max_sessions : "";
      const rl = (ws && ws.replay_last_lines !== undefined) ? ws.replay_last_lines : "";
      const pi = (ws && ws.poll_interval_s !== undefined) ? ws.poll_interval_s : "";
      const si = (ws && ws.file_scan_interval_s !== undefined) ? ws.file_scan_interval_s : "";
      if (wm || rl || pi || si) {
        debugLines.splice(3, 0, `watch_runtime: max_sessions=${wm} replay_last_lines=${rl} poll_s=${pi} scan_s=${si}`);
      }
      const openPids = String((ws && ws.codex_pids) ? ws.codex_pids : "");
      const candPids = String((ws && ws.codex_candidate_pids) ? ws.codex_candidate_pids : "");
      if (openPids || candPids) {
        debugLines.push(`codex_pids_open: ${openPids}`, `codex_pids_candidate: ${candPids}`);
      }
    } catch (_) {}
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
