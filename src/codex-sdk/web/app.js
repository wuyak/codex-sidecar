const LS_THREAD_ID = "codex_sdk_thread_id_v1";

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  const str = String(s ?? "");
  return str.replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    if (ch === "'") return "&#39;";
    return ch;
  });
}

function shortId(s) {
  const v = String(s || "");
  if (!v) return "";
  if (v.length <= 10) return v;
  return v.slice(0, 6) + "…" + v.slice(-4);
}

function appendMessage(chatEl, role, text) {
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  row.innerHTML = `<div class="role">${escapeHtml(role)}</div><pre>${escapeHtml(text || "")}</pre>`;
  chatEl.appendChild(row);
  row.scrollIntoView({ block: "end" });
}

async function fetchJson(url, opts) {
  const resp = await fetch(url, { cache: "no-store", ...(opts || {}) });
  const data = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, data };
}

async function main() {
  const statusEl = $("status");
  const chatEl = $("chat");
  const threadIdEl = $("threadId");
  const inputEl = $("input");
  const sendBtn = $("sendBtn");
  const newThreadBtn = $("newThreadBtn");

  let csrf = "";
  let busy = false;

  function setStatus(s) {
    try { statusEl.textContent = String(s || ""); } catch (_) {}
  }

  function setBusy(on) {
    busy = !!on;
    try { sendBtn.disabled = busy; } catch (_) {}
    try { inputEl.disabled = busy; } catch (_) {}
    try { threadIdEl.disabled = busy; } catch (_) {}
    try { newThreadBtn.disabled = busy; } catch (_) {}
  }

  // Restore previous thread id.
  try {
    const saved = String(localStorage.getItem(LS_THREAD_ID) || "").trim();
    if (saved) threadIdEl.value = saved;
  } catch (_) {}

  // Load status + CSRF token.
  try {
    const r = await fetchJson(`/api/status?t=${Date.now()}`);
    if (!r.ok || !r.data || !r.data.ok) throw new Error(String((r.data && r.data.error) || `HTTP ${r.status}`));
    csrf = String(r.data.csrf_token || "").trim();
    const home = String(r.data.codex_home || "").trim();
    setStatus(`已就绪（CSRF=${shortId(csrf)}${home ? ` · CODEX_HOME=${home}` : ""}）`);
  } catch (e) {
    setStatus(`不可用：${String(e && e.message ? e.message : e)}`);
  }

  newThreadBtn.addEventListener("click", () => {
    threadIdEl.value = "";
    try { localStorage.setItem(LS_THREAD_ID, ""); } catch (_) {}
    try { inputEl.focus(); } catch (_) {}
    setStatus("已切换为新对话（threadId 留空）");
  });

  threadIdEl.addEventListener("input", () => {
    try { localStorage.setItem(LS_THREAD_ID, String(threadIdEl.value || "").trim()); } catch (_) {}
  });

  async function runSend() {
    if (busy) return;
    const text = String(inputEl.value || "").trim();
    const threadId = String(threadIdEl.value || "").trim();
    if (!text) return;
    if (!csrf) {
      setStatus("不可用：缺少 CSRF token（刷新页面重试）");
      return;
    }

    setBusy(true);
    appendMessage(chatEl, "user", text);
    setStatus("发送中…");

    try {
      const r = await fetchJson(`/api/turn/run?t=${Date.now()}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-CSRF-Token": csrf,
        },
        body: JSON.stringify({ text, threadId }),
      });
      const data = r.data && typeof r.data === "object" ? r.data : {};
      if (!r.ok || !data.ok) throw new Error(String(data.error || `HTTP ${r.status}`));

      const newId = String(data.threadId || "").trim();
      if (newId) {
        threadIdEl.value = newId;
        try { localStorage.setItem(LS_THREAD_ID, newId); } catch (_) {}
      }
      const out = String(data.finalResponse || "");
      appendMessage(chatEl, "assistant", out);
      inputEl.value = "";
      setStatus(`完成（threadId=${newId ? shortId(newId) : "unknown"}）`);
    } catch (e) {
      appendMessage(chatEl, "assistant", `错误：${String(e && e.message ? e.message : e)}`);
      setStatus(`失败：${String(e && e.message ? e.message : e)}`);
    } finally {
      setBusy(false);
      try { inputEl.focus(); } catch (_) {}
    }
  }

  sendBtn.addEventListener("click", runSend);
  inputEl.addEventListener("keydown", (e) => {
    try {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        runSend();
      }
    } catch (_) {}
  });
}

main().catch(() => {});

