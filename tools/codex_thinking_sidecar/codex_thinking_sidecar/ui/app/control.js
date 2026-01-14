import { fmtErr } from "./utils.js";
import { showShutdownScreen } from "./shutdown.js";

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

async function api(method, url, body) {
  const opts = { method, cache: "no-store", headers: { "Content-Type": "application/json; charset=utf-8" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return await resp.json();
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

function normalizeHttpProfiles(tc) {
  const profiles = Array.isArray(tc.profiles) ? tc.profiles.filter(p => p && typeof p === "object") : [];
  let selected = (typeof tc.selected === "string") ? tc.selected : "";

  // Backwards-compat: old config used {url, timeout_s, auth_env}.
  if (profiles.length === 0 && (tc.url || tc.timeout_s || tc.auth_env)) {
    profiles.push({
      name: "默认",
      url: tc.url || "",
      token: tc.token || "",
      timeout_s: (tc.timeout_s ?? 3),
      auth_env: tc.auth_env || "",
    });
    selected = "默认";
  }

  if (!selected && profiles.length > 0) selected = profiles[0].name || "默认";
  return { profiles, selected };
}

function readHttpInputs(dom) {
  return {
    url: (dom.httpUrl && dom.httpUrl.value) ? dom.httpUrl.value : "",
    token: (dom.httpToken && dom.httpToken.value) ? dom.httpToken.value : "",
    timeout_s: Number((dom.httpTimeout && dom.httpTimeout.value) ? dom.httpTimeout.value : 3),
    auth_env: (dom.httpAuthEnv && dom.httpAuthEnv.value) ? dom.httpAuthEnv.value : "",
  };
}

function upsertSelectedProfileFromInputs(dom, state) {
  if (!state.httpSelected) return;
  const cur = readHttpInputs(dom);
  let found = false;
  state.httpProfiles = state.httpProfiles.map(p => {
    if (p && p.name === state.httpSelected) {
      found = true;
      return { ...p, ...cur, name: state.httpSelected };
    }
    return p;
  });
  if (!found) {
    state.httpProfiles.push({ name: state.httpSelected, ...cur });
  }
}

function applyProfileToInputs(dom, state, name) {
  const p = state.httpProfiles.find(x => x && x.name === name);
  if (!p) return;
  if (dom.httpUrl) dom.httpUrl.value = p.url || "";
  if (dom.httpToken) dom.httpToken.value = p.token || "";
  if (dom.httpTimeout) dom.httpTimeout.value = p.timeout_s ?? 3;
  if (dom.httpAuthEnv) dom.httpAuthEnv.value = p.auth_env || "";
}

function refreshHttpProfileSelect(dom, state) {
  if (!dom.httpProfile) return;
  dom.httpProfile.innerHTML = "";
  for (const p of state.httpProfiles) {
    if (!p || typeof p !== "object") continue;
    const opt = document.createElement("option");
    opt.value = p.name || "";
    opt.textContent = p.name || "";
    dom.httpProfile.appendChild(opt);
  }
  if (state.httpSelected) dom.httpProfile.value = state.httpSelected;
  if (!dom.httpProfile.value && state.httpProfiles.length > 0) {
    state.httpSelected = state.httpProfiles[0].name || "";
    dom.httpProfile.value = state.httpSelected;
  }
}

function countValidHttpProfiles(profiles) {
  const xs = Array.isArray(profiles) ? profiles : [];
  let score = 0;
  for (const p of xs) {
    if (!p || typeof p !== "object") continue;
    const name = String(p.name || "").trim();
    const url = String(p.url || "").trim();
    if (!name || !url) continue;
    if (!(url.startsWith("http://") || url.startsWith("https://"))) continue;
    score += 1;
  }
  return score;
}

export async function loadControl(dom, state) {
  const ts = Date.now();
  const debugLines = [];
  setDebug(dom, "");

  // 1) Translators（容错：接口失败时仍展示默认三项，避免“下拉为空”）
  let translators = [
    { id: "stub", label: "Stub（占位）" },
    { id: "none", label: "None（不翻译）" },
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
      dom.recoverBtn.title = canRecover ? "从本机备份恢复翻译 Profiles" : "未检测到可恢复的本机备份";
    }
  } catch (_) {}

  // 3) Apply config to UI（尽量继续，不让某个字段报错导致整体“全无”）
  try {
    if (dom.cfgHome) dom.cfgHome.value = cfg.config_home || "";
    if (dom.watchHome) dom.watchHome.value = cfg.watch_codex_home || "";
    if (dom.autoStart) dom.autoStart.value = cfg.auto_start ? "1" : "0";
    if (dom.followProc) dom.followProc.value = cfg.follow_codex_process ? "1" : "0";
    if (dom.onlyWhenProc) dom.onlyWhenProc.value = (cfg.only_follow_when_process === false) ? "0" : "1";
    if (dom.procRegex) dom.procRegex.value = cfg.codex_process_regex || "codex";
    if (dom.replayLines) dom.replayLines.value = cfg.replay_last_lines ?? 0;
    if (dom.includeAgent) dom.includeAgent.value = cfg.include_agent_reasoning ? "1" : "0";
    if (dom.displayMode) dom.displayMode.value = (localStorage.getItem("codex_sidecar_display_mode") || "both");
    if (dom.pollInterval) dom.pollInterval.value = cfg.poll_interval ?? 0.5;
    if (dom.scanInterval) dom.scanInterval.value = cfg.file_scan_interval ?? 2.0;
    if (dom.translatorSel) {
      const want = cfg.translator_provider || "stub";
      dom.translatorSel.value = want;
      if (dom.translatorSel.value !== want) dom.translatorSel.value = "stub";
    }
    const tc = cfg.translator_config || {};
    const normalized = normalizeHttpProfiles(tc || {});
    state.httpProfiles = normalized.profiles;
    state.httpSelected = normalized.selected;
    refreshHttpProfileSelect(dom, state);
    if (state.httpSelected) applyProfileToInputs(dom, state, state.httpSelected);
    showHttpFields(dom, ((dom.translatorSel && dom.translatorSel.value) || "") === "http");
  } catch (e) {
    debugLines.push(`[error] apply config: ${fmtErr(e)}`);
  }

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
  try {
    const st = await fetch(`/api/status?t=${ts}`, { cache: "no-store" }).then(r => r.json());
    let hint = "";
    const sidecarPid = (st && (st.pid !== undefined) && (st.pid !== null)) ? String(st.pid) : "";
    const sidecarSuffix = sidecarPid ? ` | sidecar:${sidecarPid}` : "";
    if (st.env && st.env.auth_env) {
      hint = st.env.auth_env_set ? `（已检测到 ${st.env.auth_env}）` : `（未设置环境变量 ${st.env.auth_env}）`;
    }
    const w = (st && st.watcher) ? st.watcher : {};
    const cur = w.current_file || "";
    const mode = w.follow_mode || "";
    const detected = (w.codex_detected === "1");
    const pids = w.codex_pids || "";
    let detail = "";
    if (mode === "idle") detail = "（等待 Codex 进程）";
    else if (mode === "process") detail = pids ? `（process | pid:${pids}）` : "（process）";
    else if (mode === "fallback") detail = detected && pids ? `（fallback | pid:${pids}）` : "（fallback）";
    else if (mode) detail = `(${mode})`;
    if (st.running) {
      if (cur) setStatus(dom, `运行中：${cur} ${detail} ${hint}${sidecarSuffix}`.trim());
      else setStatus(dom, `运行中：${detail} ${hint}${sidecarSuffix}`.trim());
    } else {
      setStatus(dom, `未运行 ${hint}${sidecarSuffix}`.trim());
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
      `translator_provider: ${cfg.translator_provider || ""}`,
      `http_profiles: ${profNames.length}${profNames.length ? " (" + profNames.join(", ") + ")" : ""}`,
      `http_selected: ${state.httpSelected || ""}`,
    );
  } catch (e) {
    debugLines.push(`[warn] debug: ${fmtErr(e)}`);
  }
  if (debugLines.length) setDebug(dom, debugLines.join("\n"));
}

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
    patch.translator_config = { profiles: state.httpProfiles, selected: state.httpSelected };
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
    // Config changes only take effect on watcher restart; prompt to apply immediately.
    if (confirm("已保存配置。需要重启监听使新配置生效吗？")) {
      await api("POST", "/api/control/stop");
      await api("POST", "/api/control/start");
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

export async function startWatch(dom, state) {
  const r = await api("POST", "/api/control/start");
  await loadControl(dom, state);
  setStatus(dom, r.running ? "已开始监听" : "开始监听失败");
}

export async function stopWatch(dom, state) {
  const r = await api("POST", "/api/control/stop");
  await loadControl(dom, state);
  setStatus(dom, r.running ? "停止监听失败" : "已停止监听");
}

async function healthPid() {
  try {
    const r = await fetch(`/health?t=${Date.now()}`, { cache: "no-store" });
    if (!r || !r.ok) return null;
    const j = await r.json();
    const p = Number(j && j.pid);
    return Number.isFinite(p) ? p : null;
  } catch (_) {
    return null;
  }
}

async function waitForRestartCycle(beforePid) {
  const deadline = Date.now() + 15000;
  let sawDown = false;
  let afterPid = null;

  // Give restart a moment to actually begin.
  await new Promise((res) => setTimeout(res, 180));
  while (Date.now() < deadline) {
    const p = await healthPid();
    if (p !== null) {
      afterPid = p;
      // Ideal: new PID.
      if (beforePid && p !== beforePid) break;
      // If we don't know the old PID, any healthy response is enough.
      if (!beforePid) break;
      // If PID didn't change but we observed downtime, assume in-place restart happened.
      if (beforePid && p === beforePid && sawDown) break;
    } else {
      sawDown = true;
    }
    await new Promise((res) => setTimeout(res, 140));
  }
  return { beforePid: beforePid || null, afterPid, sawDown };
}

export async function restartProcess(dom, state) {
  if (!confirm("确定要重启 sidecar 进程？（将杀死并重新拉起服务）")) return;
  const beforePid = await healthPid();
  setStatus(dom, beforePid ? `正在重启 sidecar…（pid:${beforePid}）` : "正在重启 sidecar…");
  try { if (state.uiEventSource) state.uiEventSource.close(); } catch (_) {}
  closeDrawer(dom);
  try { await api("POST", "/api/control/restart_process", {}); } catch (e) {}
  const r = await waitForRestartCycle(beforePid);
  if (r.afterPid && r.beforePid && r.afterPid !== r.beforePid) {
    setStatus(dom, `重启完成（pid:${r.beforePid}→${r.afterPid}）`);
  } else if (r.afterPid && r.beforePid && r.afterPid === r.beforePid) {
    setStatus(dom, `重启完成（pid:${r.afterPid}，未变化）`);
  } else if (r.afterPid) {
    setStatus(dom, `重启完成（pid:${r.afterPid}）`);
  } else {
    setStatus(dom, "重启可能未完成（未获取到 /health）");
  }
  try { await api("POST", "/api/control/start"); } catch (e) {}
  try { window.location.reload(); } catch (_) {}
}

export async function clearView(dom, state, refreshList) {
  await api("POST", "/api/control/clear");
  state.threadIndex.clear();
  state.callIndex.clear();
  state.currentKey = "all";
  await refreshList();
  setStatus(dom, "已清空显示");
}

export async function maybeAutoStartOnce(dom, state) {
  if (state.bootAutoStarted) return;
  state.bootAutoStarted = true;
  try {
    const ts = Date.now();
    const c = await fetch(`/api/config?t=${ts}`, { cache: "no-store" }).then(r => r.json());
    const cfg = c.config || c || {};
    if (!cfg.auto_start) return;
    const st = await fetch(`/api/status?t=${ts}`, { cache: "no-store" }).then(r => r.json());
    if (st && st.running) return;
    await api("POST", "/api/control/start");
  } catch (e) {}
}

export function wireControlEvents(dom, state, helpers) {
  const { refreshList, renderTabs } = helpers;
  if (dom.sidebarToggleBtn) dom.sidebarToggleBtn.addEventListener("click", () => {
    try {
      document.body.classList.toggle("sidebar-collapsed");
      dom.sidebarToggleBtn.textContent = document.body.classList.contains("sidebar-collapsed") ? "⟫" : "⟪";
    } catch (_) {}
    renderTabs();
  });

  if (dom.translatorSel) dom.translatorSel.addEventListener("change", () => {
    showHttpFields(dom, ((dom.translatorSel.value || "") === "http"));
  });

  if (dom.configToggleBtn) dom.configToggleBtn.addEventListener("click", () => {
    try {
      if (dom.drawer && !dom.drawer.classList.contains("hidden")) closeDrawer(dom);
      else openDrawer(dom);
    } catch (_) { openDrawer(dom); }
  });
  if (dom.drawerOverlay) dom.drawerOverlay.addEventListener("click", () => { closeDrawer(dom); });
  if (dom.drawerCloseBtn) dom.drawerCloseBtn.addEventListener("click", () => { closeDrawer(dom); });
  window.addEventListener("keydown", (e) => {
    try {
      if (e && e.key === "Escape") closeDrawer(dom);
    } catch (_) {}
  });

  if (dom.displayMode) dom.displayMode.addEventListener("change", async () => {
    try { localStorage.setItem("codex_sidecar_display_mode", dom.displayMode.value || "both"); } catch (_) {}
    await refreshList();
  });

  if (dom.saveBtn) dom.saveBtn.addEventListener("click", async () => { await saveConfig(dom, state); });
  if (dom.recoverBtn) dom.recoverBtn.addEventListener("click", async () => { await recoverConfig(dom, state); });
  if (dom.startBtn) dom.startBtn.addEventListener("click", async () => { await startWatch(dom, state); });
  if (dom.stopBtn) dom.stopBtn.addEventListener("click", async () => { await stopWatch(dom, state); });
  if (dom.restartBtn) dom.restartBtn.addEventListener("click", async () => { await restartProcess(dom, state); });
  if (dom.clearBtn) dom.clearBtn.addEventListener("click", async () => { await clearView(dom, state, refreshList); });

  if (dom.shutdownBtn) dom.shutdownBtn.addEventListener("click", async () => {
    if (!confirm("确定要退出 sidecar 进程？（将停止监听并关闭服务）")) return;
    setStatus(dom, "正在退出 sidecar…");
    try { if (state.uiEventSource) state.uiEventSource.close(); } catch (_) {}
    try { await api("POST", "/api/control/shutdown", {}); } catch (e) {}
    closeDrawer(dom);
    setTimeout(() => {
      try { window.close(); } catch (_) {}
      showShutdownScreen();
    }, 80);
  });

  if (dom.scrollTopBtn) dom.scrollTopBtn.addEventListener("click", () => { window.scrollTo({ top: 0, behavior: "smooth" }); });
  if (dom.scrollBottomBtn) dom.scrollBottomBtn.addEventListener("click", () => { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); });

  if (dom.httpProfile) dom.httpProfile.addEventListener("change", () => {
    upsertSelectedProfileFromInputs(dom, state);
    state.httpSelected = dom.httpProfile.value || "";
    if (state.httpSelected) applyProfileToInputs(dom, state, state.httpSelected);
  });

  if (dom.httpProfileAddBtn) dom.httpProfileAddBtn.addEventListener("click", () => {
    upsertSelectedProfileFromInputs(dom, state);
    const name = (prompt("新建 Profile 名称：", "默认") || "").trim();
    if (!name) return;
    if (state.httpProfiles.some(p => p && p.name === name)) {
      alert("该名称已存在");
      return;
    }
    state.httpProfiles.push({ name, ...readHttpInputs(dom) });
    state.httpSelected = name;
    refreshHttpProfileSelect(dom, state);
    if (dom.httpProfile) dom.httpProfile.value = state.httpSelected;
  });

  if (dom.httpProfileRenameBtn) dom.httpProfileRenameBtn.addEventListener("click", () => {
    upsertSelectedProfileFromInputs(dom, state);
    if (!state.httpSelected) return;
    const name = (prompt("将当前 Profile 重命名为：", state.httpSelected) || "").trim();
    if (!name || name === state.httpSelected) return;
    if (state.httpProfiles.some(p => p && p.name === name)) {
      alert("该名称已存在");
      return;
    }
    state.httpProfiles = state.httpProfiles.map(p => (p && p.name === state.httpSelected) ? { ...p, name } : p);
    state.httpSelected = name;
    refreshHttpProfileSelect(dom, state);
    if (dom.httpProfile) dom.httpProfile.value = state.httpSelected;
  });

  if (dom.httpProfileDelBtn) dom.httpProfileDelBtn.addEventListener("click", () => {
    if (!state.httpSelected) return;
    if (!confirm(`删除 Profile：${state.httpSelected} ?`)) return;
    state.httpProfiles = state.httpProfiles.filter(p => !(p && p.name === state.httpSelected));
    state.httpSelected = state.httpProfiles.length > 0 ? (state.httpProfiles[0].name || "") : "";
    refreshHttpProfileSelect(dom, state);
    if (state.httpSelected) applyProfileToInputs(dom, state, state.httpSelected);
    else {
      if (dom.httpUrl) dom.httpUrl.value = "";
      if (dom.httpTimeout) dom.httpTimeout.value = 3;
      if (dom.httpAuthEnv) dom.httpAuthEnv.value = "";
    }
  });
}
