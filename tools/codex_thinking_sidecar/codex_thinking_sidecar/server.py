import json
import queue
import threading
import time
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Deque, Dict, List, Optional, Any
from urllib.parse import parse_qs, urlparse


class _Broadcaster:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: List["queue.Queue[dict]"] = []

    def subscribe(self) -> "queue.Queue[dict]":
        q: "queue.Queue[dict]" = queue.Queue(maxsize=256)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: "queue.Queue[dict]") -> None:
        with self._lock:
            try:
                self._subscribers.remove(q)
            except ValueError:
                return

    def publish(self, msg: dict) -> None:
        with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(msg)
            except queue.Full:
                # Drop if the client can't keep up.
                continue


class _State:
    def __init__(self, max_messages: int) -> None:
        self._lock = threading.Lock()
        self._messages: Deque[dict] = deque(maxlen=max_messages)
        self._broadcaster = _Broadcaster()

    def add(self, msg: dict) -> None:
        with self._lock:
            self._messages.append(msg)
        self._broadcaster.publish(msg)

    def clear(self) -> None:
        with self._lock:
            self._messages.clear()

    def list_messages(self) -> List[dict]:
        with self._lock:
            return list(self._messages)

    def list_threads(self) -> List[dict]:
        with self._lock:
            msgs = list(self._messages)
        agg: Dict[str, dict] = {}
        for m in msgs:
            thread_id = str(m.get("thread_id") or "")
            file_path = str(m.get("file") or "")
            key = thread_id or file_path or "unknown"
            if key not in agg:
                agg[key] = {
                    "key": key,
                    "thread_id": thread_id,
                    "file": file_path,
                    "count": 0,
                    "last_ts": "",
                    "kinds": {},
                }
            a = agg[key]
            a["count"] += 1
            ts = str(m.get("ts") or "")
            if ts and (not a["last_ts"] or ts > a["last_ts"]):
                a["last_ts"] = ts
            kind = str(m.get("kind") or "")
            if kind:
                a["kinds"][kind] = int(a["kinds"].get(kind, 0)) + 1
        items = list(agg.values())
        items.sort(key=lambda x: x.get("last_ts") or "", reverse=True)
        return items

    def subscribe(self) -> "queue.Queue[dict]":
        return self._broadcaster.subscribe()

    def unsubscribe(self, q: "queue.Queue[dict]") -> None:
        self._broadcaster.unsubscribe(q)


def _json_bytes(obj: dict) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class _Handler(BaseHTTPRequestHandler):
    server_version = "codex-thinking-sidecar/0.1"

    @property
    def _state(self) -> _State:
        return self.server.state  # type: ignore[attr-defined]

    @property
    def _controller(self):
        return self.server.controller  # type: ignore[attr-defined]

    def log_message(self, _format: str, *_args) -> None:
        # Silence default logging.
        return

    def _send_json(self, status: int, obj: dict) -> None:
        body = _json_bytes(obj)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(
        self,
        status: int,
        body: str,
        content_type: str = "text/plain; charset=utf-8",
        extra_headers: Optional[Dict[str, str]] = None,
    ) -> None:
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        if extra_headers:
            for k, v in extra_headers.items():
                self.send_header(k, v)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        u = urlparse(self.path)
        path = u.path
        qs = parse_qs(u.query or "")

        if path == "/health":
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if path == "/api/messages":
            msgs = self._state.list_messages()
            thread_id = (qs.get("thread_id") or [""])[0]
            if thread_id:
                msgs = [m for m in msgs if str(m.get("thread_id") or "") == thread_id]
            self._send_json(HTTPStatus.OK, {"messages": msgs})
            return

        if path == "/api/threads":
            self._send_json(HTTPStatus.OK, {"threads": self._state.list_threads()})
            return

        if path == "/api/config":
            self._send_json(HTTPStatus.OK, {"ok": True, "config": self._controller.get_config()})
            return

        if path == "/api/status":
            self._send_json(HTTPStatus.OK, self._controller.status())
            return

        if path == "/api/translators":
            self._send_json(HTTPStatus.OK, self._controller.translators())
            return

        if path == "/ui":
            # Avoid stale UI HTML due to browser caching when iterating locally.
            self._send_text(
                HTTPStatus.OK,
                _UI_HTML,
                content_type="text/html; charset=utf-8",
                extra_headers={
                    "Cache-Control": "no-store, max-age=0",
                    "Pragma": "no-cache",
                },
            )
            return

        if path == "/events":
            self._handle_sse()
            return

        self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})

    def _handle_sse(self) -> None:
        q = self._state.subscribe()
        try:
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            # Initial comment to establish the stream.
            self.wfile.write(b":ok\n\n")
            self.wfile.flush()

            while True:
                try:
                    msg = q.get(timeout=10.0)
                except queue.Empty:
                    # heartbeat
                    self.wfile.write(b":ping\n\n")
                    self.wfile.flush()
                    continue

                data = _json_bytes(msg)
                self.wfile.write(b"event: message\n")
                self.wfile.write(b"data: ")
                self.wfile.write(data)
                self.wfile.write(b"\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return
        finally:
            self._state.unsubscribe(q)

    def do_POST(self) -> None:
        # Control plane (JSON).
        if self.path == "/api/config":
            length = int(self.headers.get("Content-Length") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except Exception:
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_json"})
                return
            if not isinstance(obj, dict):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload"})
                return
            cfg = self._controller.update_config(obj)
            self._send_json(HTTPStatus.OK, {"ok": True, "config": cfg})
            return

        if self.path == "/api/control/start":
            self._send_json(HTTPStatus.OK, self._controller.start())
            return

        if self.path == "/api/control/stop":
            self._send_json(HTTPStatus.OK, self._controller.stop())
            return

        if self.path == "/api/control/clear":
            self._controller.clear_messages()
            self._send_json(HTTPStatus.OK, {"ok": True})
            return

        if self.path != "/ingest":
            self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "not_found"})
            return

        length = int(self.headers.get("Content-Length") or "0")
        if length <= 0:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "empty_body"})
            return

        raw = self.rfile.read(length)
        try:
            obj = json.loads(raw.decode("utf-8", errors="replace"))
        except Exception:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_json"})
            return

        if not isinstance(obj, dict):
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "invalid_payload"})
            return

        # Minimal validation.
        if "id" not in obj or "kind" not in obj or "text" not in obj:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "missing_fields"})
            return

        self._state.add(obj)
        self._send_json(HTTPStatus.OK, {"ok": True})


_UI_HTML = """<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Codex Thinking Sidecar</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; margin: 16px; }
      .row { border: 1px solid #ddd; border-radius: 8px; padding: 12px; margin: 10px 0; }
      .meta { color: #555; font-size: 12px; }
      pre { white-space: pre-wrap; word-break: break-word; margin: 8px 0 0; }
      .badge { display:inline-block; padding:2px 8px; border-radius:999px; background:#f1f5f9; font-size:12px; margin-right:8px; }
      .badge.kind-user_message, .badge.kind-user { background:#e0f2fe; }
      .badge.kind-assistant_message, .badge.kind-assistant { background:#dcfce7; }
      .badge.kind-tool_call, .badge.kind-tool_output { background:#fef9c3; }
      .tabs { display:flex; gap:8px; flex-wrap:wrap; margin: 10px 0 14px; }
      .tab { border: 1px solid #ddd; background:#fff; padding:6px 10px; border-radius: 999px; cursor:pointer; font-size: 12px; }
      .tab.active { background:#111827; color:#fff; border-color:#111827; }
      .tab small { opacity: .75; }
      .grid { display:grid; grid-template-columns: 220px 1fr; gap: 8px 10px; align-items:center; margin-top: 10px; }
      .grid input, .grid select { width: 100%; padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px; }
      .btns { display:flex; gap: 8px; flex-wrap:wrap; margin-top: 10px; }
      button { border: 1px solid #ddd; background:#fff; padding: 7px 10px; border-radius: 8px; cursor:pointer; }
      button.primary { background:#111827; color:#fff; border-color:#111827; }
      button.danger { background:#fee2e2; border-color:#fecaca; }
      .muted { opacity: .8; }
    </style>
  </head>
  <body>
    <h2>Codex Thinking Sidecar（旁路思考摘要）</h2>
    <p class="meta">实时订阅：<code>/events</code>（SSE），最近数据：<code>/api/messages</code>，会话列表：<code>/api/threads</code></p>
    <div class="row" id="control">
      <div class="meta"><b>控制面板</b> <span class="muted">（建议：先保存配置，再点“开始监听”）</span></div>
      <div class="grid">
        <div class="meta">配置目录（只读）</div><div><input id="cfgHome" readonly /></div>
        <div class="meta">监视目录（CODEX_HOME）</div><div><input id="watchHome" placeholder="/home/kino/.codex 或 /mnt/c/Users/.../.codex" /></div>
        <div class="meta">回放行数</div><div><input id="replayLines" type="number" min="0" step="1" /></div>
        <div class="meta">采集 agent_reasoning</div><div><select id="includeAgent"><option value="0">否</option><option value="1">是</option></select></div>
        <div class="meta">显示模式</div><div><select id="displayMode"><option value="both">中英文对照</option><option value="zh">仅中文</option><option value="en">仅英文</option></select></div>
        <div class="meta">poll_interval（秒）</div><div><input id="pollInterval" type="number" min="0.05" step="0.05" /></div>
        <div class="meta">file_scan_interval（秒）</div><div><input id="scanInterval" type="number" min="0.2" step="0.1" /></div>
        <div class="meta">翻译 Provider</div><div><select id="translator"></select></div>
        <div class="meta">HTTP Profiles</div><div style="display:flex; gap:8px; align-items:center;"><select id="httpProfile" style="flex:1;"></select><button id="httpProfileAddBtn" type="button">新增</button><button id="httpProfileRenameBtn" type="button">重命名</button><button id="httpProfileDelBtn" type="button">删除</button></div>
        <div class="meta">HTTP URL（仅 http/https）</div><div><input id="httpUrl" placeholder="https://api.deeplx.org/{token}/translate 或 http://127.0.0.1:9000/translate" /></div>
        <div class="meta">HTTP Token（可选）</div><div><input id="httpToken" placeholder="可用于 Authorization 或替换 URL 中的 {token}" /></div>
        <div class="meta">HTTP 超时（秒）</div><div><input id="httpTimeout" type="number" min="0.5" step="0.5" /></div>
        <div class="meta">Auth ENV（可选）</div><div><input id="httpAuthEnv" placeholder="CODEX_TRANSLATE_TOKEN" /></div>
      </div>
      <div class="btns">
        <button class="primary" id="saveBtn">保存配置</button>
        <button class="primary" id="startBtn">开始监听</button>
        <button id="stopBtn">停止监听</button>
        <button class="danger" id="clearBtn">清空显示</button>
        <span class="meta" id="statusText"></span>
      </div>
    </div>
    <div id="tabs" class="tabs"></div>
    <div id="list"></div>
    <script>
      const statusText = document.getElementById("statusText");
      const cfgHome = document.getElementById("cfgHome");
      const watchHome = document.getElementById("watchHome");
      const replayLines = document.getElementById("replayLines");
      const includeAgent = document.getElementById("includeAgent");
      const displayMode = document.getElementById("displayMode");
      const pollInterval = document.getElementById("pollInterval");
      const scanInterval = document.getElementById("scanInterval");
      const translatorSel = document.getElementById("translator");
      const httpProfile = document.getElementById("httpProfile");
      const httpProfileAddBtn = document.getElementById("httpProfileAddBtn");
      const httpProfileRenameBtn = document.getElementById("httpProfileRenameBtn");
      const httpProfileDelBtn = document.getElementById("httpProfileDelBtn");
      const httpUrl = document.getElementById("httpUrl");
      const httpToken = document.getElementById("httpToken");
      const httpTimeout = document.getElementById("httpTimeout");
      const httpAuthEnv = document.getElementById("httpAuthEnv");
      const saveBtn = document.getElementById("saveBtn");
      const startBtn = document.getElementById("startBtn");
      const stopBtn = document.getElementById("stopBtn");
      const clearBtn = document.getElementById("clearBtn");

      let httpProfiles = [];
      let httpSelected = "";

      const tabs = document.getElementById("tabs");
      const list = document.getElementById("list");
      let currentKey = "all";
      const threadIndex = new Map(); // key -> { key, thread_id, file, count, last_ts }

      function formatTs(ts) {
        if (!ts) return { utc: "", local: "" };
        try {
          const d = new Date(ts);
          if (isNaN(d.getTime())) return { utc: ts, local: "" };
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
          return { utc: ts, local: `${d.toLocaleString()} (${tz})` };
        } catch (e) {
          return { utc: ts, local: "" };
        }
      }

      function keyOf(msg) {
        return (msg.thread_id || msg.file || "unknown");
      }

      function shortId(s) {
        if (!s) return "";
        if (s.length <= 10) return s;
        return s.slice(0, 6) + "…" + s.slice(-4);
      }

      function clearList() {
        while (list.firstChild) list.removeChild(list.firstChild);
      }

      function clearTabs() {
        while (tabs.firstChild) tabs.removeChild(tabs.firstChild);
      }

      function upsertThread(msg) {
        const key = keyOf(msg);
        const prev = threadIndex.get(key) || { key, thread_id: msg.thread_id || "", file: msg.file || "", count: 0, last_ts: "" };
        prev.count = (prev.count || 0) + 1;
        const ts = msg.ts || "";
        if (ts && (!prev.last_ts || ts > prev.last_ts)) prev.last_ts = ts;
        threadIndex.set(key, prev);
      }

      function renderTabs() {
        const items = Array.from(threadIndex.values()).sort((a,b) => (b.last_ts || "").localeCompare(a.last_ts || ""));
        clearTabs();
        const allBtn = document.createElement("button");
        allBtn.className = "tab" + (currentKey === "all" ? " active" : "");
        allBtn.textContent = `全部`;
        allBtn.onclick = async () => { currentKey = "all"; await refreshList(); };
        tabs.appendChild(allBtn);

        for (const t of items) {
          const btn = document.createElement("button");
          btn.className = "tab" + (currentKey === t.key ? " active" : "");
          const label = t.thread_id ? shortId(t.thread_id) : (t.file ? shortId(t.file.split("/").slice(-1)[0]) : "unknown");
          btn.innerHTML = `${label} <small>(${t.count || 0})</small>`;
          btn.title = t.thread_id || t.file || t.key;
          btn.onclick = async () => { currentKey = t.key; await refreshList(); };
          tabs.appendChild(btn);
        }
      }

      function render(msg) {
        const row = document.createElement("div");
        row.className = "row";
        const t = formatTs(msg.ts || "");
        const kind = msg.kind || "";
        const sid = msg.thread_id ? shortId(msg.thread_id) : (msg.file ? shortId((msg.file.split("/").slice(-1)[0] || msg.file)) : "");
        const mode = (displayMode.value || "both");
        const isThinking = (kind === "reasoning_summary" || kind === "agent_reasoning");
        const showEn = !isThinking ? true : (mode !== "zh");
        const showZh = !isThinking ? false : (mode !== "en");
        const zhText = (typeof msg.zh === "string") ? msg.zh : "";
        const hasZh = !!zhText.trim();

        const autoscroll = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 80);

        let body = "";
        if (kind === "tool_output") {
          const firstLine = (msg.text || "").split("\\n")[0] || "";
          body = `
            <details>
              <summary class="meta">工具输出（点击展开）: <code>${firstLine}</code></summary>
              <pre>${msg.text || ""}</pre>
            </details>
          `;
        } else if (kind === "tool_call") {
          body = `<pre>${msg.text || ""}</pre>`;
        } else if (kind === "user_message") {
          body = `<pre><b>用户</b>\\n${msg.text || ""}</pre>`;
        } else if (kind === "assistant_message") {
          body = `<pre><b>回答</b>\\n${msg.text || ""}</pre>`;
        } else if (isThinking) {
          body = `
            ${showEn ? `<pre><b>思考（EN）</b>\\n${msg.text || ""}</pre>` : ``}
            ${showZh && hasZh ? `<pre><b>思考（ZH）</b>\\n${zhText}</pre>` : ``}
          `;
        } else {
          // Fallback for unknown kinds.
          body = `<pre>${msg.text || ""}</pre>`;
        }

        row.innerHTML = `
          <div class="meta"><span class="badge kind-${kind}">${kind}</span>${t.local || t.utc} <span style="opacity:.7">${sid}</span></div>
          ${t.local && t.utc ? `<div class="meta" style="opacity:.85">UTC: <code>${t.utc}</code></div>` : ``}
          ${body}
        `;
        list.appendChild(row);
        if (autoscroll) window.scrollTo(0, document.body.scrollHeight);
      }

      function renderEmpty() {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML = `<div class="meta">暂无数据（或仍在回放中）：先等待 2-5 秒；如仍为空，请确认 sidecar 的 <code>--codex-home</code> 指向包含 <code>sessions/**/rollout-*.jsonl</code> 的目录，然后在 Codex 里发一条消息。也可以打开 <code>/api/messages</code> 验证是否已采集到数据。</div>`;
        list.appendChild(row);
      }

      function setStatus(s) {
        statusText.textContent = s || "";
      }

      function showHttpFields(show) {
        const els = [httpProfile, httpProfileAddBtn, httpProfileDelBtn, httpUrl, httpToken, httpTimeout, httpAuthEnv];
        for (const el of els) {
          el.disabled = !show;
          el.style.opacity = show ? "1" : "0.5";
        }
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

      function readHttpInputs() {
        return {
          url: httpUrl.value || "",
          token: httpToken.value || "",
          timeout_s: Number(httpTimeout.value || 3),
          auth_env: httpAuthEnv.value || "",
        };
      }

      function upsertSelectedProfileFromInputs() {
        if (!httpSelected) return;
        const cur = readHttpInputs();
        let found = false;
        httpProfiles = httpProfiles.map(p => {
          if (p && p.name === httpSelected) {
            found = true;
            return { ...p, ...cur, name: httpSelected };
          }
          return p;
        });
        if (!found) {
          httpProfiles.push({ name: httpSelected, ...cur });
        }
      }

      function applyProfileToInputs(name) {
        const p = httpProfiles.find(x => x && x.name === name);
        if (!p) return;
        httpUrl.value = p.url || "";
        httpToken.value = p.token || "";
        httpTimeout.value = p.timeout_s ?? 3;
        httpAuthEnv.value = p.auth_env || "";
      }

      function refreshHttpProfileSelect() {
        httpProfile.innerHTML = "";
        for (const p of httpProfiles) {
          if (!p || typeof p !== "object") continue;
          const opt = document.createElement("option");
          opt.value = p.name || "";
          opt.textContent = p.name || "";
          httpProfile.appendChild(opt);
        }
        if (httpSelected) httpProfile.value = httpSelected;
        if (!httpProfile.value && httpProfiles.length > 0) {
          httpSelected = httpProfiles[0].name || "";
          httpProfile.value = httpSelected;
        }
      }

      async function api(method, url, body) {
        const opts = { method, headers: { "Content-Type": "application/json; charset=utf-8" } };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const resp = await fetch(url, opts);
        return await resp.json();
      }

      async function loadControl() {
        try {
          const tr = await fetch("/api/translators").then(r => r.json());
          const translators = tr.translators || [];
          translatorSel.innerHTML = "";
          for (const t of translators) {
            const opt = document.createElement("option");
            opt.value = t.id;
            opt.textContent = t.label || t.id;
            translatorSel.appendChild(opt);
          }

          const c = await fetch("/api/config").then(r => r.json());
          const cfg = c.config || {};
          cfgHome.value = cfg.config_home || "";
          watchHome.value = cfg.watch_codex_home || "";
          replayLines.value = cfg.replay_last_lines ?? 0;
          includeAgent.value = cfg.include_agent_reasoning ? "1" : "0";
          displayMode.value = (localStorage.getItem("codex_sidecar_display_mode") || "both");
          pollInterval.value = cfg.poll_interval ?? 0.5;
          scanInterval.value = cfg.file_scan_interval ?? 2.0;
          translatorSel.value = cfg.translator_provider || "stub";
          const tc = cfg.translator_config || {};
          {
            const normalized = normalizeHttpProfiles(tc || {});
            httpProfiles = normalized.profiles;
            httpSelected = normalized.selected;
            refreshHttpProfileSelect();
            if (httpSelected) applyProfileToInputs(httpSelected);
          }

          showHttpFields((translatorSel.value || "") === "http");

          const st = await fetch("/api/status").then(r => r.json());
          let hint = "";
          if (st.env && st.env.auth_env) {
            hint = st.env.auth_env_set ? `（已检测到 ${st.env.auth_env}）` : `（未设置环境变量 ${st.env.auth_env}）`;
          }
          const cur = (st.watcher && st.watcher.current_file) ? st.watcher.current_file : "";
          setStatus(st.running ? `运行中：${cur} ${hint}` : `未运行 ${hint}`);
        } catch (e) {
          setStatus("控制面板加载失败");
        }
      }

      async function saveConfig() {
        const provider = translatorSel.value || "stub";
        let wasRunning = false;
        try {
          const st = await fetch("/api/status").then(r => r.json());
          wasRunning = !!(st && st.running);
        } catch (e) {}
        if (provider === "http") {
          if (!httpSelected && httpProfiles.length > 0) httpSelected = httpProfiles[0].name || "";
          if (!httpSelected) httpSelected = "默认";
          upsertSelectedProfileFromInputs();
          if (httpProfiles.length === 0) {
            httpProfiles = [{ name: httpSelected, ...readHttpInputs() }];
          }
          refreshHttpProfileSelect();
        }
        const patch = {
          watch_codex_home: watchHome.value || "",
          replay_last_lines: Number(replayLines.value || 0),
          include_agent_reasoning: includeAgent.value === "1",
          poll_interval: Number(pollInterval.value || 0.5),
          file_scan_interval: Number(scanInterval.value || 2.0),
          translator_provider: provider,
          translator_config: (provider === "http") ? {
            profiles: httpProfiles,
            selected: httpSelected,
          } : {},
        };
        await api("POST", "/api/config", patch);
        if (wasRunning) {
          // Config changes only take effect on watcher restart; prompt to apply immediately.
          if (confirm("已保存配置。需要重启监听使新配置生效吗？")) {
            await api("POST", "/api/control/stop");
            await api("POST", "/api/control/start");
          }
        }
        await loadControl();
        setStatus("已保存配置");
      }

      async function startWatch() {
        const r = await api("POST", "/api/control/start");
        await loadControl();
        setStatus(r.running ? "已开始监听" : "开始监听失败");
      }

      async function stopWatch() {
        const r = await api("POST", "/api/control/stop");
        await loadControl();
        setStatus(r.running ? "停止监听失败" : "已停止监听");
      }

      async function clearView() {
        await api("POST", "/api/control/clear");
        threadIndex.clear();
        currentKey = "all";
        await refreshList();
        setStatus("已清空显示");
      }

      async function refreshList() {
        try {
          let url = "/api/messages";
          // 当前 key 为 thread_id 时，走服务端过滤；否则退化为前端过滤（例如 key=file/unknown）
          if (currentKey !== "all") {
            const t = threadIndex.get(currentKey);
            if (t && t.thread_id) {
              url = `/api/messages?thread_id=${encodeURIComponent(t.thread_id)}`;
            }
          }
          const resp = await fetch(url);
          const data = await resp.json();
          const msgs = (data.messages || []);
          clearList();
          const filtered = currentKey === "all" ? msgs : msgs.filter(m => keyOf(m) === currentKey);
          if (filtered.length === 0) renderEmpty();
          else for (const m of filtered) render(m);
        } catch (e) {
          clearList();
          renderEmpty();
        }
        renderTabs();
      }

      async function bootstrap() {
        try {
          // 先加载 thread 列表（若为空也没关系），再加载消息列表。
          try {
            const tr = await fetch("/api/threads");
            const td = await tr.json();
            const threads = td.threads || [];
            for (const t of threads) threadIndex.set(t.key, t);
          } catch (e) {}
          await refreshList();
        } catch (e) {
          clearList();
          renderEmpty();
        }
      }
      translatorSel.addEventListener("change", () => {
        showHttpFields((translatorSel.value || "") === "http");
      });
      displayMode.addEventListener("change", async () => {
        localStorage.setItem("codex_sidecar_display_mode", displayMode.value || "both");
        await refreshList();
      });
      httpProfile.addEventListener("change", () => {
        upsertSelectedProfileFromInputs();
        httpSelected = httpProfile.value || "";
        if (httpSelected) applyProfileToInputs(httpSelected);
      });
      httpProfileAddBtn.addEventListener("click", () => {
        upsertSelectedProfileFromInputs();
        const name = (prompt("新 Profile 名称（用于在下拉中切换）") || "").trim();
        if (!name) return;
        if (httpProfiles.some(p => p && p.name === name)) {
          alert("该名称已存在");
          return;
        }
        httpProfiles.push({ name, ...readHttpInputs() });
        httpSelected = name;
        refreshHttpProfileSelect();
        httpProfile.value = httpSelected;
      });
      httpProfileRenameBtn.addEventListener("click", () => {
        upsertSelectedProfileFromInputs();
        if (!httpSelected) return;
        const name = (prompt("将当前 Profile 重命名为：", httpSelected) || "").trim();
        if (!name || name === httpSelected) return;
        if (httpProfiles.some(p => p && p.name === name)) {
          alert("该名称已存在");
          return;
        }
        httpProfiles = httpProfiles.map(p => (p && p.name === httpSelected) ? { ...p, name } : p);
        httpSelected = name;
        refreshHttpProfileSelect();
        httpProfile.value = httpSelected;
      });
      httpProfileDelBtn.addEventListener("click", () => {
        if (!httpSelected) return;
        if (!confirm(`删除 Profile：${httpSelected} ?`)) return;
        httpProfiles = httpProfiles.filter(p => !(p && p.name === httpSelected));
        httpSelected = httpProfiles.length > 0 ? (httpProfiles[0].name || "") : "";
        refreshHttpProfileSelect();
        if (httpSelected) applyProfileToInputs(httpSelected);
        else {
          httpUrl.value = "";
          httpTimeout.value = 3;
          httpAuthEnv.value = "";
        }
      });
      saveBtn.addEventListener("click", async () => { await saveConfig(); });
      startBtn.addEventListener("click", async () => { await startWatch(); });
      stopBtn.addEventListener("click", async () => { await stopWatch(); });
      clearBtn.addEventListener("click", async () => { await clearView(); });

      loadControl();
      bootstrap();
      const es = new EventSource("/events");
      es.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          upsertThread(msg);
          // 只渲染当前 tab（或全部）
          const k = keyOf(msg);
          if (currentKey === "all" || currentKey === k) render(msg);
          renderTabs();
        } catch (e) {}
      });
    </script>
  </body>
</html>
"""


class SidecarServer:
    def __init__(self, host: str, port: int, max_messages: int, controller: Optional[Any] = None) -> None:
        self._host = host
        self._port = port
        self._state = _State(max_messages=max_messages)
        self._httpd = ThreadingHTTPServer((host, port), _Handler)
        # Attach state to server instance for handler access.
        self._httpd.state = self._state  # type: ignore[attr-defined]
        self._httpd.controller = controller  # type: ignore[attr-defined]
        self._thread: Optional[threading.Thread] = None

    @property
    def state(self) -> _State:
        return self._state

    def set_controller(self, controller: Any) -> None:
        self._httpd.controller = controller  # type: ignore[attr-defined]

    def start_in_background(self) -> None:
        t = threading.Thread(target=self._httpd.serve_forever, name="sidecar-httpd", daemon=True)
        t.start()
        self._thread = t
        # Small delay to reduce race when watcher starts immediately.
        time.sleep(0.05)

    def shutdown(self) -> None:
        try:
            self._httpd.shutdown()
        except Exception:
            return
