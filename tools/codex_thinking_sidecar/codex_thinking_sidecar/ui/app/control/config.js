import { fmtErr } from "../utils.js";
import { api } from "./api.js";
import { restartProcess } from "./actions.js";
import { countValidHttpProfiles, refreshHttpProfileSelect, upsertSelectedProfileFromInputs } from "./http_profiles.js";
import { loadControl } from "./load.js";
import { setDebug, setStatus } from "./ui.js";

export async function saveConfig(dom, state) {
  const provider = (dom.translatorSel && dom.translatorSel.value) ? dom.translatorSel.value : "stub";
  let wasRunning = false;
  try {
    const st = await fetch(`/api/status?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json());
    wasRunning = !!(st && st.running);
  } catch (e) {}
  if (provider === "http") {
    if (!state.httpSelected && state.httpProfiles.length > 0) state.httpSelected = state.httpProfiles[0].name || "";
    if (!state.httpSelected) state.httpSelected = "默认";
    upsertSelectedProfileFromInputs(dom, state);
    refreshHttpProfileSelect(dom, state);
  }
  if (provider === "http") {
    // Guard: do not allow saving empty/invalid profiles (protect against accidental wipe).
    const valid = countValidHttpProfiles(state.httpProfiles);
    if (valid <= 0) {
      // Try recover first if available
      try {
        const c = await fetch(`/api/config?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json());
        const rec = (c && typeof c === "object") ? (c.recovery || {}) : {};
        if (rec && rec.available) {
          if (confirm("当前没有可用的 HTTP Profiles。是否从本机备份恢复？")) {
            await api("POST", "/api/config/recover", {});
            await loadControl(dom, state);
            setStatus(dom, "已恢复配置");
            return;
          }
        }
      } catch (e) {}
      alert("请至少保留 1 个可用的 HTTP Profile（需要 name + http/https URL），或切换翻译 Provider。");
      return;
    }
  }

  const patch = {
    watch_codex_home: (dom.watchHome && dom.watchHome.value) ? dom.watchHome.value : "",
    auto_start: (dom.autoStart && dom.autoStart.value) === "1",
    follow_codex_process: (dom.followProc && dom.followProc.value) === "1",
    only_follow_when_process: (dom.onlyWhenProc && dom.onlyWhenProc.value) === "1",
    codex_process_regex: ((dom.procRegex && dom.procRegex.value) ? dom.procRegex.value : "codex").trim(),
    replay_last_lines: Number((dom.replayLines && dom.replayLines.value) ? dom.replayLines.value : 0),
    include_agent_reasoning: (dom.includeAgent && dom.includeAgent.value) === "1",
    poll_interval: Number((dom.pollInterval && dom.pollInterval.value) ? dom.pollInterval.value : 0.5),
    file_scan_interval: Number((dom.scanInterval && dom.scanInterval.value) ? dom.scanInterval.value : 2.0),
    translator_provider: provider,
  };
  if (provider === "http") {
    patch.translator_config = { http: { profiles: state.httpProfiles, selected: state.httpSelected } };
  }
  if (provider === "openai") {
    const base = (dom.openaiBaseUrl && dom.openaiBaseUrl.value) ? dom.openaiBaseUrl.value.trim() : "";
    const model = (dom.openaiModel && dom.openaiModel.value) ? dom.openaiModel.value.trim() : "";
    const apiKey = (dom.openaiApiKey && dom.openaiApiKey.value) ? dom.openaiApiKey.value.trim() : "";
    const authEnv = (dom.openaiAuthEnv && dom.openaiAuthEnv.value) ? dom.openaiAuthEnv.value.trim() : "";
    const mode = (dom.openaiAuthMode && dom.openaiAuthMode.value) ? dom.openaiAuthMode.value : "authorization";
    const reasoning = (dom.openaiReasoning && dom.openaiReasoning.value) ? dom.openaiReasoning.value.trim() : "";
    const timeout = Number((dom.openaiTimeout && dom.openaiTimeout.value) ? dom.openaiTimeout.value : 12);
    if (!base) { alert("请填写 Base URL（例如 https://www.right.codes/codex/v1）"); return; }
    if (!model) { alert("请填写 Model（例如 gpt-4.1-mini / gpt-4o-mini）"); return; }
    if (!apiKey && !authEnv) { alert("请填写 API Key，或填写 Auth ENV 并在环境变量中提供 Key"); return; }
    const auth_header = (mode === "x-api-key") ? "x-api-key" : "Authorization";
    const auth_prefix = (mode === "x-api-key") ? "" : "Bearer ";
    patch.translator_config = {
      openai: {
        base_url: base,
        model,
        api_key: apiKey,
        auth_env: authEnv,
        timeout_s: timeout,
        auth_header,
        auth_prefix,
        reasoning_effort: reasoning,
      },
    };
  }
  const saved = await api("POST", "/api/config", patch);
  if (saved && saved.ok === false) {
    const err = String(saved.error || "");
    if (err === "empty_http_profiles") {
      alert("保存被拒绝：HTTP Profiles 为空/不可用。可点击“恢复配置”从备份找回。");
    } else {
      alert(`保存失败：${err || "unknown_error"}`);
    }
    return;
  }
  if (wasRunning) {
    // Config changes only take effect on watcher restart. In practice, stopping a watcher
    // can be delayed by in-flight translation requests. Reuse the existing “重启 Sidecar”
    // logic to make the behavior deterministic.
    if (confirm("已保存配置。需要重启 Sidecar 使新配置生效吗？")) {
      await restartProcess(dom, state, { skipConfirm: true });
      return;
    }
  }
  if (!wasRunning && patch.auto_start) {
    // 让“自动开始”在保存后即可生效（无需手动点开始）。
    await api("POST", "/api/control/start");
  }
  await loadControl(dom, state);
  setStatus(dom, "已保存配置");
}

export async function recoverConfig(dom, state) {
  if (!confirm("将从本机配置备份尝试恢复翻译 Profiles，并覆盖当前翻译配置。是否继续？")) return;
  try {
    const r = await api("POST", "/api/config/recover", {});
    await loadControl(dom, state);
    const src = (r && r.source) ? `（${r.source}）` : "";
    setStatus(dom, `已恢复配置${src}`);
  } catch (e) {
    const msg = `恢复失败：${fmtErr(e)}`;
    setStatus(dom, msg);
    setDebug(dom, msg);
  }
}
