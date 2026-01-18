import { api, healthPid, waitForRestartCycle } from "./api.js";
import { loadControl } from "./load.js";
import { closeDrawer, confirmDialog, setStatus } from "./ui.js";
import { clearViews } from "../views.js";

export async function startWatch(dom, state) {
  const r = await api("POST", "/api/control/start");
  await loadControl(dom, state);
  setStatus(dom, r.running ? "已开始监听" : "开始监听失败");
}

export async function stopWatch(dom, state) {
  setStatus(dom, "正在停止监听…");
  const r = await api("POST", "/api/control/stop");
  if (r && r.running) {
    // Stop can be delayed by in-flight translation/network; poll until fully stopped.
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      try {
        const st = await fetch(`/api/status?t=${Date.now()}`, { cache: "no-store" }).then(x => x.json());
        if (st && st.running === false) break;
      } catch (_) {}
      await new Promise((res) => setTimeout(res, 180));
    }
  }
  await loadControl(dom, state);
  setStatus(dom, r && r.running ? "停止中（等待后台任务结束）" : "已停止监听");
}

export async function restartProcess(dom, state, opts) {
  const skipConfirm = !!(opts && typeof opts === "object" && opts.skipConfirm);
  if (!skipConfirm) {
    const ok = await confirmDialog(dom, {
      title: "重启 Sidecar？",
      desc: "将停止监听并重新拉起服务。",
      confirmText: "重启",
      cancelText: "取消",
      danger: true,
    });
    if (!ok) return;
  }
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
  try {
    // Clear 通常意味着回到“自动跟随/全部视图”，避免 UI=all 但 watcher 仍处于 pin 状态造成“监听跑偏”错觉。
    await api("POST", "/api/control/follow", { mode: "auto" });
  } catch (_) {}
  state.threadIndex.clear();
  state.currentKey = "all";
  try { if (state.sseByKey && typeof state.sseByKey.clear === "function") state.sseByKey.clear(); } catch (_) {}
  try { if (state.sseOverflow && typeof state.sseOverflow.clear === "function") state.sseOverflow.clear(); } catch (_) {}
  try { if (state.callIndex && typeof state.callIndex.clear === "function") state.callIndex.clear(); } catch (_) {}
  try { if (state.rowIndex && typeof state.rowIndex.clear === "function") state.rowIndex.clear(); } catch (_) {}
  try { if (state.timeline && Array.isArray(state.timeline)) state.timeline.length = 0; } catch (_) {}
  try { state.lastRenderedMs = NaN; } catch (_) {}
  try { clearViews(dom, state); } catch (_) {}
  await refreshList();
  setStatus(dom, "已清空消息");
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
