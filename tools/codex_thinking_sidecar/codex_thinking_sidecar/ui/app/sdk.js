import { fmtErr, shortId } from "./utils.js";

const _LS_THREAD_ID = "codex_sidecar_sdk_thread_id_v1";

function _readStoredThreadId() {
  try {
    const v = String(localStorage.getItem(_LS_THREAD_ID) || "").trim();
    return v;
  } catch (_) {
    return "";
  }
}

function _writeStoredThreadId(threadId) {
  const v = String(threadId || "").trim();
  try { localStorage.setItem(_LS_THREAD_ID, v); } catch (_) {}
}

function _selectedThreadId(state) {
  try {
    if (!state || state.currentKey === "all") return "";
    const t = state.threadIndex && state.threadIndex.get ? state.threadIndex.get(state.currentKey) : null;
    const tid = t && typeof t === "object" ? String(t.thread_id || "").trim() : "";
    return tid;
  } catch (_) {
    return "";
  }
}

function _setComposerEnabled(dom, enabled) {
  const on = !!enabled;
  const els = [dom.sdkInput, dom.sdkSendBtn, dom.sdkThreadId, dom.sdkNewBtn, dom.sdkUseSelectedBtn];
  for (const el of els) {
    if (!el) continue;
    try { el.disabled = !on; } catch (_) {}
    try { el.style.opacity = on ? "1" : "0.6"; } catch (_) {}
  }
}

function _setComposerStatus(dom, text) {
  try { if (dom.sdkStatus) dom.sdkStatus.textContent = String(text || ""); } catch (_) {}
}

async function _fetchJson(url, opts) {
  const resp = await fetch(url, { cache: "no-store", ...(opts || {}) });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

export function syncSdkSelection(dom, state) {
  if (!dom || !dom.sdkHintSelected || !dom.sdkSelectedThreadId) return;
  const tid = _selectedThreadId(state);
  if (!tid) {
    try { dom.sdkHintSelected.classList.add("hidden"); } catch (_) {}
    return;
  }
  try { dom.sdkHintSelected.classList.remove("hidden"); } catch (_) {}
  try { dom.sdkSelectedThreadId.textContent = shortId(tid); } catch (_) {}
  try { dom.sdkSelectedThreadId.title = tid; } catch (_) {}
}

async function _refreshSdkStatus(dom, state) {
  const r = await _fetchJson(`/api/sdk/status?t=${Date.now()}`);
  const s = r && r.data && typeof r.data === "object" ? r.data : {};
  if (r.ok && s.ok) {
    const nodeOk = !!s.node;
    const depsOk = !!s.deps_installed;
    const available = !!s.available;
    const csrf = String(s.csrf_token || "").trim();

    const home = String(s.codex_home || "").trim();
    const homeOk = !!(s.codex_home_writable || s.codex_home_creatable);

    state.sdkAvailable = available && nodeOk && depsOk && homeOk;
    state.sdkCsrfToken = csrf;

    if (!available) {
      _setComposerStatus(dom, "不可用：未检测到 SDK runner");
      _setComposerEnabled(dom, false);
      return false;
    }
    if (!nodeOk) {
      _setComposerStatus(dom, "不可用：未找到 node（需要 Node.js ≥ 18）");
      _setComposerEnabled(dom, false);
      return false;
    }
    if (!depsOk) {
      _setComposerStatus(dom, "不可用：缺少依赖（请在 src/codex-sdk 执行 npm install）");
      _setComposerEnabled(dom, false);
      return false;
    }
    if (!homeOk) {
      _setComposerStatus(dom, `不可用：CODEX_HOME 不可写（${home || "unknown"}）`);
      _setComposerEnabled(dom, false);
      return false;
    }
    if (!csrf) {
      _setComposerStatus(dom, "不可用：缺少 CSRF token（请重启 sidecar 后重试）");
      _setComposerEnabled(dom, false);
      return false;
    }

    _setComposerStatus(dom, "已就绪（需要本机已登录 Codex）");
    _setComposerEnabled(dom, true);
    return true;
  }

  state.sdkAvailable = false;
  state.sdkCsrfToken = "";
  const err = String((s && s.error) || `HTTP ${r.status}` || "sdk_unavailable");
  _setComposerStatus(dom, `不可用：${err}`);
  _setComposerEnabled(dom, false);
  return false;
}

export async function initSdkComposer(dom, state, setTopStatus) {
  if (!dom || !dom.sdkComposer) return;

  // Show composer area even if SDK is unavailable, so the user sees the reason.
  try { dom.sdkComposer.classList.remove("hidden"); } catch (_) {}

  // Restore previous thread id (optional).
  state.sdkThreadId = _readStoredThreadId();
  if (dom.sdkThreadId) dom.sdkThreadId.value = state.sdkThreadId || "";

  // Static hint text.
  try {
    if (dom.sdkHintText) dom.sdkHintText.textContent = "Enter 发送，Shift+Enter 换行";
  } catch (_) {}

  // Wire selection helper.
  try {
    if (dom.sdkUseSelectedBtn) {
      dom.sdkUseSelectedBtn.onclick = () => {
        const tid = _selectedThreadId(state);
        if (!tid) return;
        state.sdkThreadId = tid;
        _writeStoredThreadId(tid);
        if (dom.sdkThreadId) dom.sdkThreadId.value = tid;
        try { if (dom.sdkInput) dom.sdkInput.focus(); } catch (_) {}
      };
    }
  } catch (_) {}

  // Wire thread id input.
  try {
    if (dom.sdkThreadId) {
      dom.sdkThreadId.addEventListener("input", () => {
        const v = String(dom.sdkThreadId.value || "").trim();
        state.sdkThreadId = v;
        _writeStoredThreadId(v);
      });
    }
  } catch (_) {}

  // New chat resets the thread id.
  try {
    if (dom.sdkNewBtn) {
      dom.sdkNewBtn.onclick = () => {
        state.sdkThreadId = "";
        _writeStoredThreadId("");
        if (dom.sdkThreadId) dom.sdkThreadId.value = "";
        try { if (dom.sdkInput) dom.sdkInput.focus(); } catch (_) {}
      };
    }
  } catch (_) {}

  const runSend = async () => {
    if (state.sdkBusy) return;
    const text = String(dom.sdkInput && dom.sdkInput.value ? dom.sdkInput.value : "").trim();
    if (!text) return;
    if (!state.sdkCsrfToken) {
      await _refreshSdkStatus(dom, state);
      return;
    }

    state.sdkBusy = true;
    try {
      _setComposerEnabled(dom, false);
      _setComposerStatus(dom, "发送中…");
      try { if (typeof setTopStatus === "function") setTopStatus(dom, "SDK：执行中…"); } catch (_) {}

      const body = { text, thread_id: String(state.sdkThreadId || "").trim() };
      const r = await _fetchJson(`/api/sdk/turn/run?t=${Date.now()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-CSRF-Token": state.sdkCsrfToken,
        },
        body: JSON.stringify(body),
      });

      const data = r && r.data && typeof r.data === "object" ? r.data : {};
      if (r.ok && data.ok) {
        const tid = String(data.thread_id || "").trim();
        if (tid) {
          state.sdkThreadId = tid;
          _writeStoredThreadId(tid);
          if (dom.sdkThreadId) dom.sdkThreadId.value = tid;
        }
        if (dom.sdkInput) dom.sdkInput.value = "";
        _setComposerStatus(dom, tid ? `已发送（threadId=${shortId(tid)}）` : "已发送");
        try { if (typeof setTopStatus === "function") setTopStatus(dom, "SDK：完成"); } catch (_) {}
      } else {
        const err = String(data.error || `HTTP ${r.status}` || "sdk_error");
        if (err === "bad_csrf") {
          await _refreshSdkStatus(dom, state);
          _setComposerStatus(dom, "CSRF 已更新，请重试发送");
        } else {
          _setComposerStatus(dom, `失败：${err}`);
          try { if (typeof setTopStatus === "function") setTopStatus(dom, `SDK：失败（${err}）`); } catch (_) {}
        }
      }
    } catch (e) {
      const err = fmtErr(e);
      _setComposerStatus(dom, `失败：${err}`);
      try { if (typeof setTopStatus === "function") setTopStatus(dom, `SDK：失败（${err}）`); } catch (_) {}
    } finally {
      state.sdkBusy = false;
      _setComposerEnabled(dom, !!state.sdkCsrfToken);
    }
  };

  // Enter to send; Shift+Enter for newline.
  try {
    if (dom.sdkInput) {
      dom.sdkInput.addEventListener("keydown", (e) => {
        try {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            runSend();
          }
        } catch (_) {}
      });
    }
  } catch (_) {}
  try { if (dom.sdkSendBtn) dom.sdkSendBtn.onclick = () => runSend(); } catch (_) {}

  // Initial status probe.
  try { await _refreshSdkStatus(dom, state); } catch (e) { _setComposerStatus(dom, `不可用：${fmtErr(e)}`); }
  syncSdkSelection(dom, state);
}
