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
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
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
            cfg = self._controller.get_config()
            payload = {"ok": True, "config": cfg}
            if isinstance(cfg, dict):
                payload.update(cfg)
            self._send_json(HTTPStatus.OK, payload)
            return

        if path == "/api/status":
            self._send_json(HTTPStatus.OK, self._controller.status())
            return

        if path == "/api/translators":
            payload = self._controller.translators()
            try:
                translators = payload.get("translators")
                if isinstance(translators, list):
                    for t in translators:
                        if isinstance(t, dict) and "id" in t and "name" not in t:
                            t["name"] = t["id"]
            except Exception:
                pass
            self._send_json(HTTPStatus.OK, payload)
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
        if self.path == "/api/config/recover":
            r = self._controller.recover_translator_config()
            if not isinstance(r, dict) or not r.get("ok"):
                self._send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "no_recovery_source"})
                return
            cfg = r.get("config")
            payload = {"ok": True, "restored": True, "source": r.get("source") or "", "config": cfg}
            if isinstance(cfg, dict):
                payload.update(cfg)
            self._send_json(HTTPStatus.OK, payload)
            return

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
            payload = {"ok": True, "config": cfg}
            if isinstance(cfg, dict):
                payload.update(cfg)
            self._send_json(HTTPStatus.OK, payload)
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
	      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"; margin: 0; background:#fff; }
	      #sidebar { position: fixed; top: 16px; left: 16px; bottom: 16px; width: 260px; overflow: auto; border: 1px solid #ddd; border-radius: 12px; padding: 12px; background:#fff; }
	      #main { margin: 16px 16px 16px 292px; }
	      .row { border: 1px solid #ddd; border-left: 4px solid #e5e7eb; border-radius: 8px; padding: 12px; margin: 10px 0; }
	      .row.kind-user_message { border-left-color:#38bdf8; }
	      .row.kind-assistant_message { border-left-color:#4ade80; }
	      .row.kind-tool_call, .row.kind-tool_output { border-left-color:#fbbf24; }
	      .row.kind-reasoning_summary, .row.kind-agent_reasoning { border-left-color:#c4b5fd; }
	      .meta { color: #555; font-size: 12px; }
	      .meta-line { display:flex; align-items:center; gap:8px; }
	      .meta-left { display:flex; align-items:center; gap:8px; flex-wrap:wrap; min-width: 0; }
	      .meta-right { margin-left:auto; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
	      .meta-line .timestamp { font-variant-numeric: tabular-nums; }
	      pre { white-space: pre-wrap; word-break: break-word; margin: 8px 0 0; }
	      .badge { display:inline-block; padding:2px 8px; border-radius:999px; background:#f1f5f9; font-size:12px; margin-right:8px; }
	      .badge.kind-user_message, .badge.kind-user { background:#e0f2fe; }
	      .badge.kind-assistant_message, .badge.kind-assistant { background:#dcfce7; }
      .badge.kind-tool_call, .badge.kind-tool_output { background:#fef9c3; }
      .tabs { display:flex; flex-direction:column; gap:6px; margin: 10px 0 0; }
      .tab { border: 1px solid #ddd; background:#fff; padding:6px 10px; border-radius: 10px; cursor:pointer; font-size: 12px; text-align:left; width: 100%; }
      .tab.active { background:#111827; color:#fff; border-color:#111827; }
      .tab small { opacity: .75; }
      .grid { display:grid; grid-template-columns: 220px 1fr; gap: 8px 10px; align-items:center; margin-top: 10px; }
      .grid input, .grid select { width: 100%; padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px; }
      .btns { display:flex; gap: 8px; flex-wrap:wrap; margin-top: 10px; }
      button { border: 1px solid #ddd; background:#fff; padding: 7px 10px; border-radius: 8px; cursor:pointer; }
      button.primary { background:#111827; color:#fff; border-color:#111827; }
	      button.danger { background:#fee2e2; border-color:#fecaca; }
	      .muted { opacity: .8; }
	      .float-nav { position: fixed; left: 16px; right: auto; bottom: 16px; display:flex; flex-direction:column; gap:8px; z-index: 1000; }
	      .float-nav button { padding: 8px 10px; border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.08); }
	      .tool-card { background:#f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px; margin-top: 8px; }
	      .tool-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
	      .tool-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
	      .tool-toggle { border: 1px solid #e2e8f0; background:#fff; padding: 2px 8px; border-radius: 999px; cursor:pointer; font-size: 12px; color:#334155; }
	      .tool-toggle:hover { background:#f1f5f9; }
	      .tool-details { margin-top: 8px; }
	      .hidden { display: none; }
	      .pill { display:inline-block; padding:2px 8px; border-radius:999px; border:1px solid #e2e8f0; background:#fff; font-size:12px; }
	      .tool-meta { display:flex; flex-wrap:wrap; gap:10px; margin-top: 6px; color:#555; font-size: 12px; }
	      .pre-wrap { position: relative; }
	      .copy-btn { position:absolute; top: 8px; right: 8px; padding: 4px 8px; border-radius: 8px; font-size: 12px; border: 1px solid rgba(148,163,184,.55); background: rgba(15,23,42,.88); color:#e2e8f0; cursor:pointer; opacity: 0; transition: opacity .15s; }
	      .copy-btn.light { background:#fff; color:#0f172a; border-color:#e2e8f0; }
	      .pre-wrap:hover .copy-btn { opacity: 1; }
	      .copy-btn:active { transform: translateY(1px); }
	      pre.code { background:#0b1020; color:#e5e7eb; padding: 10px; border-radius: 10px; overflow:auto; white-space: pre; word-break: normal; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; line-height: 1.35; }
	      pre.code .diff-line { display:block; padding: 0 6px; border-radius: 6px; }
	      pre.code .diff-add { background: rgba(34, 197, 94, .16); }
	      pre.code .diff-del { background: rgba(239, 68, 68, .16); }
	      pre.code .diff-ellipsis { color:#94a3b8; }
	      .change-head { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
	      .md { font-size: 13px; line-height: 1.6; }
	      .md h1, .md h2, .md h3 { margin: 10px 0 6px; line-height: 1.25; }
	      .md p { margin: 6px 0; }
	      .md ul { margin: 6px 0 6px 18px; padding: 0; }
	      .md li { margin: 2px 0; }
	      .md code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; background:#f1f5f9; padding: 1px 6px; border-radius: 6px; }
	      .md pre code { background: transparent; padding: 0; }
	      .think-split { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0; }
	    </style>
	  </head>
	  <body>
    <div id="sidebar">
      <div class="meta"><b>会话切换</b></div>
      <div id="tabs" class="tabs"></div>
    </div>
    <div id="main">
      <h2>Codex Thinking Sidecar（旁路思考摘要）</h2>
      <p class="meta">实时订阅：<code>/events</code>（SSE），最近数据：<code>/api/messages</code>，会话列表：<code>/api/threads</code></p>
      <div class="row" id="control">
        <div class="meta"><b>控制面板</b> <span class="muted">（可选：启用“自动开始监听”，则无需手动点“开始监听”）</span></div>
        <div class="grid">
          <div class="meta">配置目录（只读）</div><div><input id="cfgHome" readonly /></div>
          <div class="meta">监视目录（CODEX_HOME）</div><div><input id="watchHome" placeholder="/home/kino/.codex 或 /mnt/c/Users/.../.codex" /></div>
          <div class="meta">自动开始监听（UI）</div><div><select id="autoStart"><option value="0">否</option><option value="1">是</option></select></div>
          <div class="meta">基于 Codex 进程定位</div><div><select id="followProc"><option value="0">否</option><option value="1">是</option></select></div>
          <div class="meta">仅在检测到进程时跟随</div><div><select id="onlyWhenProc"><option value="1">是</option><option value="0">否</option></select></div>
          <div class="meta">Codex 进程匹配（regex）</div><div><input id="procRegex" placeholder="codex" /></div>
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
          <button id="recoverBtn">恢复配置</button>
          <button class="primary" id="startBtn">开始监听</button>
          <button id="stopBtn">停止监听</button>
          <button class="danger" id="clearBtn">清空显示</button>
          <span class="meta" id="statusText"></span>
        </div>
        <details id="debugDetails" style="margin-top:8px;">
          <summary class="meta">调试信息（配置加载/缓存排查）</summary>
          <pre id="debugText" class="meta" style="white-space:pre-wrap; user-select:text;"></pre>
        </details>
	      </div>
	      <div id="list"></div>
	    </div>
	    <div class="float-nav" aria-label="scroll">
	      <button id="scrollTopBtn" type="button" title="回到页面顶部">↑ 顶部</button>
	      <button id="scrollBottomBtn" type="button" title="回到页面底部">↓ 底部</button>
	    </div>
	    <script>
      const statusText = document.getElementById("statusText");
      const debugText = document.getElementById("debugText");
      const cfgHome = document.getElementById("cfgHome");
      const watchHome = document.getElementById("watchHome");
      const autoStart = document.getElementById("autoStart");
      const followProc = document.getElementById("followProc");
      const onlyWhenProc = document.getElementById("onlyWhenProc");
      const procRegex = document.getElementById("procRegex");
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
	      const recoverBtn = document.getElementById("recoverBtn");
	      const startBtn = document.getElementById("startBtn");
	      const stopBtn = document.getElementById("stopBtn");
	      const clearBtn = document.getElementById("clearBtn");
	      const scrollTopBtn = document.getElementById("scrollTopBtn");
	      const scrollBottomBtn = document.getElementById("scrollBottomBtn");

      let httpProfiles = [];
      let httpSelected = "";

      const tabs = document.getElementById("tabs");
      const list = document.getElementById("list");
      let currentKey = "all";
      const threadIndex = new Map(); // key -> { key, thread_id, file, count, last_ts }
      const callIndex = new Map(); // call_id -> { tool_name, args_raw, args_obj }

	      function formatTs(ts) {
	        if (!ts) return { utc: "", local: "" };
	        try {
	          const d = new Date(ts);
	          if (isNaN(d.getTime())) return { utc: ts, local: "" };
	          // 默认按北京时间展示，减少跨时区/UTC 对照带来的视觉噪音。
	          const bj = d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
	          return { utc: ts, local: bj };
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

      function safeJsonParse(s) {
        const raw = String(s ?? "").trim();
        if (!raw) return null;
        if (!(raw.startsWith("{") || raw.startsWith("["))) return null;
        try { return JSON.parse(raw); } catch (e) { return null; }
      }

      function safeDomId(s) {
        const raw = String(s ?? "");
        if (!raw) return "";
        return raw.replace(/[^a-z0-9_-]/gi, "_");
      }

      async function copyToClipboard(text) {
        const t = String(text ?? "");
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(t);
            return true;
          }
        } catch (_) {}
        try {
          const ta = document.createElement("textarea");
          ta.value = t;
          ta.setAttribute("readonly", "readonly");
          ta.style.position = "fixed";
          ta.style.left = "-9999px";
          document.body.appendChild(ta);
          ta.select();
          const ok = document.execCommand("copy");
          document.body.removeChild(ta);
          return !!ok;
        } catch (_) {
          return false;
        }
      }

      function decoratePreBlocks(root) {
        if (!root || !root.querySelectorAll) return;
        const pres = root.querySelectorAll("pre");
        for (const pre of pres) {
          try {
            if (!pre || !pre.parentElement) continue;
            if (pre.parentElement.classList && pre.parentElement.classList.contains("pre-wrap")) continue;
            const wrap = document.createElement("div");
            wrap.className = "pre-wrap";
            const btn = document.createElement("button");
            btn.type = "button";
            const isDark = pre.classList && pre.classList.contains("code");
            btn.className = "copy-btn" + (isDark ? "" : " light");
            btn.textContent = "复制";
            btn.title = "复制内容";
            btn.onclick = async (e) => {
              try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
              const ok = await copyToClipboard(pre.textContent || "");
              const old = btn.textContent;
              btn.textContent = ok ? "已复制" : "复制失败";
              setTimeout(() => { btn.textContent = old; }, 900);
            };
            pre.parentNode.insertBefore(wrap, pre);
            wrap.appendChild(btn);
            wrap.appendChild(pre);
          } catch (_) {}
        }
      }

      function decorateMdBlocks(root) {
        if (!root || !root.querySelectorAll) return;
        const blocks = root.querySelectorAll("div.md");
        for (const md of blocks) {
          try {
            if (!md || !md.parentElement) continue;
            if (md.parentElement.classList && md.parentElement.classList.contains("pre-wrap")) continue;
            const wrap = document.createElement("div");
            wrap.className = "pre-wrap";
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "copy-btn light";
            btn.textContent = "复制";
            btn.title = "复制内容";
            btn.onclick = async (e) => {
              try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
              const ok = await copyToClipboard(md.innerText || md.textContent || "");
              const old = btn.textContent;
              btn.textContent = ok ? "已复制" : "复制失败";
              setTimeout(() => { btn.textContent = old; }, 900);
            };
            md.parentNode.insertBefore(wrap, md);
            wrap.appendChild(btn);
            wrap.appendChild(md);
          } catch (_) {}
        }
      }

      function wireToolToggles(root) {
        if (!root || !root.querySelectorAll) return;
        const btns = root.querySelectorAll("button.tool-toggle[data-target]");
        for (const btn of btns) {
          try {
            if (btn.__wired) continue;
            btn.__wired = true;
            btn.onclick = (e) => {
              try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
              const id = btn.getAttribute("data-target") || "";
              if (!id) return;
              let el = null;
              try { el = document.getElementById(id); } catch (_) {}
              if (!el) return;
              const swapId = btn.getAttribute("data-swap") || "";
              let swapEl = null;
              if (swapId) {
                try { swapEl = document.getElementById(swapId); } catch (_) {}
              }
              const willHide = !el.classList.contains("hidden");
              if (willHide) el.classList.add("hidden");
              else el.classList.remove("hidden");
              if (swapEl) {
                if (willHide) swapEl.classList.remove("hidden");
                else swapEl.classList.add("hidden");
              }
              btn.textContent = willHide ? "详情" : "收起";
            };
          } catch (_) {}
        }
      }

      function decorateRow(row) {
        decoratePreBlocks(row);
        decorateMdBlocks(row);
        wireToolToggles(row);
      }

      function parseToolCallText(text) {
        const lines = String(text ?? "").split("\\n");
        const toolName = (lines[0] || "").trim();
        let callId = "";
        let idx = 1;
        if ((lines[1] || "").startsWith("call_id=")) {
          callId = (lines[1] || "").slice("call_id=".length).trim();
          idx = 2;
        }
        const argsRaw = lines.slice(idx).join("\\n");
        return { toolName, callId, argsRaw };
      }

	      function parseToolOutputText(text) {
	        const lines = String(text ?? "").split("\\n");
        let callId = "";
        let idx = 0;
        if ((lines[0] || "").startsWith("call_id=")) {
          callId = (lines[0] || "").slice("call_id=".length).trim();
          idx = 1;
        }
        // Defensive: 某些输出可能重复带 call_id 行；去掉前导的 call_id 行。
        while ((lines[idx] || "").startsWith("call_id=")) idx += 1;
        const outputRaw = lines.slice(idx).join("\\n");
	        return { callId, outputRaw };
	      }

      function statusIcon(status) {
        const s = String(status || "").toLowerCase();
        if (s === "completed" || s === "done") return "✅";
        if (s === "in_progress" || s === "running") return "▶";
        if (s === "pending" || s === "todo") return "⏳";
        if (s === "canceled" || s === "cancelled") return "🚫";
        if (s === "failed" || s === "error") return "❌";
        return "•";
      }

	      function summarizeCommand(cmd, maxLen = 96) {
	        const lines = String(cmd ?? "").split("\\n");
	        const skip = (t) => {
	          const s = String(t || "").trim();
	          if (!s) return true;
	          if (s.startsWith("#!")) return true;
	          if (s.startsWith("#")) return true;
	          if (s.startsWith("set -")) return true; // 常见 bash prologue（如 set -euo pipefail）
	          return false;
	        };
	        let line = "";
	        for (const ln of lines) {
	          if (skip(ln)) continue;
	          line = String(ln || "").trim();
	          break;
	        }
	        if (!line) line = String(cmd ?? "").split("\\n")[0].trim();
	        if (!line) return "";
	        if (line.length <= maxLen) return line;
	        return line.slice(0, Math.max(0, maxLen - 1)) + "…";
	      }
	
	      function commandPreview(cmd, maxLen = 220) {
	        const lines = String(cmd ?? "").split("\\n");
	        const skip = (t) => {
	          const s = String(t || "").trim();
	          if (!s) return true;
	          if (s.startsWith("#!")) return true;
	          if (s.startsWith("#")) return true;
	          if (s.startsWith("set -")) return true;
	          return false;
	        };
	        const kept = [];
	        for (const ln of lines) {
	          if (skip(ln)) continue;
	          kept.push(String(ln || "").trim());
	        }
	        if (kept.length === 0) return summarizeCommand(cmd, maxLen);
	        let s = kept[0];
	        if (kept.length > 1) s += ` (… +${kept.length - 1} 行)`;
	        if (s.length <= maxLen) return s;
	        return s.slice(0, Math.max(0, maxLen - 1)) + "…";
	      }
	
	      function wrapWords(text, width = 78) {
	        const raw = String(text ?? "").trim();
	        if (!raw) return [];
	        const words = raw.split(/\\s+/).filter(Boolean);
	        const out = [];
	        let line = "";
	        const push = () => { if (line) out.push(line); line = ""; };
	        for (const w of words) {
	          if (w.length > width) {
	            push();
	            for (let i = 0; i < w.length; i += width) out.push(w.slice(i, i + width));
	            continue;
	          }
	          if (!line) { line = w; continue; }
	          if ((line + " " + w).length <= width) line += " " + w;
	          else { push(); line = w; }
	        }
	        push();
	        return out;
	      }
	
	      function normalizeNonEmptyLines(s) {
	        const lines = String(s ?? "").split("\\n");
	        // trim leading/trailing empties
	        let a = 0;
	        let b = lines.length;
	        while (a < b && !String(lines[a] || "").trim()) a++;
	        while (b > a && !String(lines[b - 1] || "").trim()) b--;
	        return lines.slice(a, b).map(x => String(x ?? "").replace(/\\s+$/g, ""));
	      }
	
	      function excerptLines(lines, maxLines = 6) {
	        const xs = Array.isArray(lines) ? lines : [];
	        if (xs.length <= maxLines) return { lines: xs, truncated: false };
	        const head = xs.slice(0, 3);
	        const tail = xs.slice(-3);
	        return { lines: head.concat(["…（展开查看更多）"], tail), truncated: true };
	      }
	
	      function wrapCommandForDisplay(cmdOne, width = 78) {
	        const raw = String(cmdOne ?? "").trim();
	        if (!raw) return [];
	        const words = raw.split(/\\s+/).filter(Boolean);
	        const splitTokens = (xs, sep) => {
	          const out = [];
	          let cur = [];
	          for (const w of xs) {
	            if (w === sep) {
	              if (cur.length) out.push(cur);
	              cur = [w];
	              continue;
	            }
	            cur.push(w);
	          }
	          if (cur.length) out.push(cur);
	          return out;
	        };

	        // Prefer breaking at control operators/pipes for readability.
	        let segs = [words];
	        for (const sep of ["||", "&&", "|"]) {
	          const next = [];
	          for (const seg of segs) {
	            if (seg.includes(sep)) next.push(...splitTokens(seg, sep));
	            else next.push(seg);
	          }
	          segs = next;
	        }

	        const lines = [];
	        for (const seg of segs) {
	          const s = seg.join(" ").trim();
	          if (!s) continue;
	          const wrapped = wrapWords(s, width);
	          for (const w of wrapped) lines.push(w);
	        }
	        if (lines.length) return lines;
	        return wrapWords(raw, width);
	      }
	
	      function wrapTreeContent(line, width = 74) {
	        const raw = String(line ?? "");
	        if (!raw) return [];
	        if (raw.length <= width) return [raw];
	        const out = [];
	        let rest = raw;
	        while (rest.length > width) {
	          let cut = rest.lastIndexOf(" ", width);
	          if (cut < 12) cut = width;
	          out.push(rest.slice(0, cut));
	          rest = rest.slice(cut).replace(/^\\s+/, "");
	        }
	        if (rest) out.push(rest);
	        return out;
	      }

	      function normalizeTreeLine(line) {
	        const s = String(line ?? "");
	        // Reduce ugly indentation for typical `nl -ba` / line-numbered outputs.
	        if (/^\\s+\\d+(\\s|$)/.test(s)) return s.replace(/^\\s+/, "");
	        return s;
	      }
	
	      function countEscapedNewlines(s) {
	        try {
	          const m = String(s ?? "").match(/\\n/g);
	          return m ? m.length : 0;
	        } catch (_) {
	          return 0;
	        }
	      }
	
	      function formatRgOutput(lines, maxHits = 1) {
	        const xs = Array.isArray(lines) ? lines : [];
	        const out = [];
	        let used = 0;
	        for (const ln of xs) {
	          if (used >= maxHits) break;
	          const m = String(ln ?? "").match(/^(.+?):(\\d+):(.*)$/);
	          if (m && m[1] && String(m[1]).includes("/")) {
	            const path = String(m[1] || "");
	            const rest = String(m[3] || "");
	            const parts = path.split("/");
	            const base = parts.pop() || path;
	            const dir = (parts.join("/") + "/") || path;
	            out.push(dir);
	            out.push(`${base}:`);
	            const n = countEscapedNewlines(rest);
	            if (n > 0) out.push(`… +${n} lines`);
	          } else {
	            out.push(String(ln ?? ""));
	          }
	          used += 1;
	        }
	        const remaining = xs.length - used;
	        if (remaining > 0) out.push(`… +${remaining} matches`);
	        return out;
	      }
	
	      function summarizeOutputLines(lines, maxLines = 6) {
	        const xs = Array.isArray(lines) ? lines : [];
	        const clipped = xs.map((ln) => {
	          const s = String(ln ?? "");
	          if (s.length <= 240) return s;
	          return s.slice(0, 239) + "…";
	        });
	        if (clipped.length <= maxLines) return clipped;
	        const head = clipped.slice(0, maxLines);
	        const remaining = clipped.length - maxLines;
	        return head.concat([`… +${remaining} lines`]);
	      }
	
	      function formatShellRun(cmdFull, outputBody, exitCode) {
	        const cmdOne = commandPreview(cmdFull, 400);
	        const outAll = normalizeNonEmptyLines(outputBody);
	        const cmdWrap = wrapCommandForDisplay(cmdOne, 78);
	        const firstCmd = String(cmdOne ?? "").trim();
	        const isRg = /^rg\\b/.test(firstCmd);
	        const pick = (outAll.length > 0)
	          ? (isRg ? formatRgOutput(outAll, 1) : summarizeOutputLines(outAll, 6))
	          : [];
	        const lines = [];
	        if (cmdWrap.length > 0) {
	          lines.push(`• Ran ${cmdWrap[0]}`);
	          for (let i = 1; i < cmdWrap.length; i++) lines.push(`  │ ${cmdWrap[i]}`);
	        } else {
	          lines.push("• Ran shell_command");
	        }
	        if (pick.length > 0) {
	          const p0 = wrapTreeContent(normalizeTreeLine(pick[0]), 74);
	          if (p0.length > 0) {
	            lines.push(`  └ ${p0[0]}`);
	            for (let j = 1; j < p0.length; j++) lines.push(`     ${p0[j]}`);
	          } else {
	            lines.push("  └ (no output)");
	          }
	          for (let i = 1; i < pick.length; i++) {
	            const ps = wrapTreeContent(normalizeTreeLine(pick[i]), 74);
	            for (const seg of ps) lines.push(`     ${seg}`);
	          }
	        } else if (exitCode !== null && exitCode !== 0) {
	          lines.push("  └ (no output)");
	        } else {
	          lines.push("  └ (no output)");
	        }
	        return lines.join("\\n");
	      }

	      function formatShellRunExpanded(cmdFull, outputBody, exitCode) {
	        const cmdOne = commandPreview(cmdFull, 400);
	        const outAll = normalizeNonEmptyLines(outputBody);
	        const cmdWrap = wrapCommandForDisplay(cmdOne, 78);
	        const firstCmd = String(cmdOne ?? "").trim();
	        const isRg = /^rg\\b/.test(firstCmd);
	        const pick = (outAll.length > 0)
	          ? (isRg ? formatRgOutput(outAll, 6) : summarizeOutputLines(outAll, 24))
	          : [];
	        const lines = [];
	        if (cmdWrap.length > 0) {
	          lines.push(`• Ran ${cmdWrap[0]}`);
	          for (let i = 1; i < cmdWrap.length; i++) lines.push(`  │ ${cmdWrap[i]}`);
	        } else {
	          lines.push("• Ran shell_command");
	        }
	        if (pick.length > 0) {
	          const p0 = wrapTreeContent(normalizeTreeLine(pick[0]), 74);
	          if (p0.length > 0) {
	            lines.push(`  └ ${p0[0]}`);
	            for (let j = 1; j < p0.length; j++) lines.push(`     ${p0[j]}`);
	          } else {
	            lines.push("  └ (no output)");
	          }
	          for (let i = 1; i < pick.length; i++) {
	            const ps = wrapTreeContent(normalizeTreeLine(pick[i]), 74);
	            for (const seg of ps) lines.push(`     ${seg}`);
	          }
	        } else if (exitCode !== null && exitCode !== 0) {
	          lines.push("  └ (no output)");
	        } else {
	          lines.push("  └ (no output)");
	        }
	        return lines.join("\\n");
	      }

	      function summarizeApplyPatchFiles(argsRaw) {
	        const lines = String(argsRaw ?? "").split("\\n");
	        const out = [];
	        const rx = /^\\*\\*\\*\\s+(Add File|Update File|Delete File):\\s+(.+)$/;
	        for (const ln of lines) {
	          const m = String(ln ?? "").match(rx);
	          if (!m) continue;
	          const path = String(m[2] ?? "").trim();
	          if (!path) continue;
	          out.push(path);
	        }
	        return Array.from(new Set(out));
	      }

	      function extractApplyPatchOutputText(outputBody) {
	        const raw = String(outputBody ?? "").trim();
	        if (!raw) return "";
	        const obj = safeJsonParse(raw);
	        if (obj && typeof obj === "object" && typeof obj.output === "string") return String(obj.output || "");
	        return raw;
	      }

	      function formatOutputTree(headerLine, lines, maxLines = 12) {
	        const xs = Array.isArray(lines) ? lines : normalizeNonEmptyLines(String(lines ?? ""));
	        const pick = summarizeOutputLines(xs, maxLines);
	        const out = [];
	        out.push(headerLine || "• Output");
	        if (pick.length === 0) {
	          out.push("  └ (no output)");
	          return out.join("\\n");
	        }
	        const p0 = wrapTreeContent(normalizeTreeLine(pick[0]), 74);
	        if (p0.length > 0) {
	          out.push(`  └ ${p0[0]}`);
	          for (let j = 1; j < p0.length; j++) out.push(`     ${p0[j]}`);
	        } else {
	          out.push("  └ (no output)");
	        }
	        for (let i = 1; i < pick.length; i++) {
	          const ps = wrapTreeContent(normalizeTreeLine(pick[i]), 74);
	          for (const seg of ps) out.push(`     ${seg}`);
	        }
	        return out.join("\\n");
	      }

	      function formatApplyPatchRun(argsRaw, outputBody, maxLines = 10) {
	        const files = summarizeApplyPatchFiles(argsRaw);
	        const fileNote = (files.length === 1) ? ` (${files[0]})` : (files.length > 1 ? ` (${files.length} files)` : "");
	        const text = extractApplyPatchOutputText(outputBody);
	        const lines = normalizeNonEmptyLines(text);
	        return formatOutputTree(`• Applied patch${fileNote}`, lines, maxLines);
	      }
	
	      function isCodexEditSummary(text) {
	        const s = String(text ?? "");
	        return /(^|\\n)•\\s+(Edited|Added|Deleted|Created|Updated|Removed)\\s+/m.test(s);
	      }
	
	      function joinWrappedExcerptLines(lines) {
	        const xs = Array.isArray(lines) ? lines.map(x => String(x ?? "")) : [];
	        const out = [];
	        for (const ln of xs) {
	          const t = String(ln ?? "");
	          const isContinuation = /^\\s{6,}\\S/.test(t) && !/^\\s*\\d+\\s/.test(t) && !/^\\s*\\(\\+/.test(t) && !/^\\s*•\\s+/.test(t);
	          if (isContinuation && out.length > 0) {
	            out[out.length - 1] = `${out[out.length - 1]} ${t.trim()}`;
	          } else {
	            out.push(t);
	          }
	        }
	        return out;
	      }
	
	      function parseCodexEditSummary(text) {
	        const lines = String(text ?? "").split("\\n");
	        const sections = [];
	        let cur = null;
	        const flush = () => { if (cur) sections.push(cur); cur = null; };
	        for (const ln of lines) {
	          const m = ln.match(/^•\\s+(Edited|Added|Deleted|Created|Updated|Removed)\\s+(.+?)\\s*$/);
	          if (m) {
	            flush();
	            cur = { action: m[1], path: m[2], stats: \"\", excerpt: [] };
	            continue;
	          }
	          if (cur && !cur.stats && /^\\(\\+\\d+\\s+-\\d+\\)\\s*$/.test(String(ln || \"\").trim())) {
	            cur.stats = String(ln || \"\").trim();
	            continue;
	          }
	          if (cur) cur.excerpt.push(ln);
	        }
	        flush();
	        return sections;
	      }
	
	      function actionZh(action) {
	        const a = String(action || \"\");
	        if (a === \"Edited\") return \"修改\";
	        if (a === \"Added\" || a === \"Created\") return \"新增\";
	        if (a === \"Deleted\" || a === \"Removed\") return \"删除\";
	        if (a === \"Updated\") return \"更新\";
	        return a;
	      }
	
	      function diffClassForLine(ln) {
	        const s = String(ln ?? \"\");
	        const m = s.match(/^\\s*\\d+\\s+([+-])\\s/);
	        if (m) return (m[1] === \"+\") ? \"diff-add\" : \"diff-del\";
	        if (s.includes(\"⋮\") || s.includes(\"…\")) return \"diff-ellipsis\";
	        return \"\";
	      }
	
	      function renderDiffBlock(lines) {
	        const xs = Array.isArray(lines) ? lines : [];
	        const html = [];
	        for (const ln of xs) {
	          const cls = diffClassForLine(ln);
	          html.push(`<span class=\"diff-line ${cls}\">${escapeHtml(ln)}</span>`);
	        }
	        return html.join(\"\\n\");
	      }
	
	      function renderCodexEditSummary(text) {
	        const sections = parseCodexEditSummary(text);
	        if (!sections.length) return \"\";
	        const blocks = [];
	        for (const sec of sections) {
	          const exJoined = joinWrappedExcerptLines(sec.excerpt);
	          const exLines = normalizeNonEmptyLines(exJoined.join(\"\\n\"));
	          const shown = excerptLines(exLines, 14).lines;
	          const title = `${actionZh(sec.action)}: ${sec.path}`;
	          blocks.push(`
	            <details class=\"tool-card\">
	              <summary class=\"meta\">改动（点击展开）: <code>${escapeHtml(title)}${sec.stats ? ` ${escapeHtml(sec.stats)}` : ``}</code></summary>
	              <pre class=\"code\">${renderDiffBlock(shown)}</pre>
	              <details>
	                <summary class=\"meta\">原始文本</summary>
	                <pre>${escapeHtml(text)}</pre>
	              </details>
	            </details>
	          `);
	        }
	        return blocks.join(\"\\n\");
	      }

	      function extractExitCode(outputRaw) {
	        const lines = String(outputRaw ?? "").split("\\n");
	        for (const ln of lines) {
	          if (ln.startsWith("Exit code:")) {
	            const v = ln.split(":", 2)[1] || "";
	            const n = parseInt(v.trim(), 10);
	            return Number.isFinite(n) ? n : null;
	          }
	        }
	        return null;
	      }
	
	      function extractWallTime(outputRaw) {
	        const lines = String(outputRaw ?? "").split("\\n");
	        for (const ln of lines) {
	          if (ln.startsWith("Wall time:")) {
	            const v = ln.split(":", 2)[1] || "";
	            return v.trim();
	          }
	        }
	        return "";
	      }
	
	      function extractOutputBody(outputRaw) {
	        const lines = String(outputRaw ?? "").split("\\n");
	        for (let i = 0; i < lines.length; i++) {
	          if ((lines[i] || "").trim() === "Output:") {
	            const body = lines.slice(i + 1).join("\\n");
	            return body.replace(/^\\n+/, "");
	          }
	        }
	        return String(outputRaw ?? "");
	      }

      function firstMeaningfulLine(s) {
        const lines = String(s ?? "").split("\\n");
        for (const ln of lines) {
          const t = ln.trim();
          if (!t) continue;
          if (t.startsWith("call_id=")) continue;
          return t;
        }
        return "";
      }

      function renderInlineMarkdown(text) {
        const raw = String(text ?? "");
        if (!raw) return "";
        const parts = raw.split("`");
        const out = [];
        for (let i = 0; i < parts.length; i++) {
          const seg = parts[i] ?? "";
          if ((i % 2) === 1) {
            out.push(`<code>${escapeHtml(seg)}</code>`);
          } else {
            let h = escapeHtml(seg);
            h = h.replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
            out.push(h);
          }
        }
        return out.join("");
      }

      function renderMarkdown(md) {
        const src = String(md ?? "").replace(/\\r\\n/g, "\\n").replace(/\\r/g, "\\n");
        const lines = src.split("\\n");
        const blocks = [];
        let inCode = false;
        let codeLines = [];
        let para = [];
        let listItems = null;

        const flushPara = () => {
          if (!para.length) return;
          const text = para.join(" ").replace(/\\s+/g, " ").trim();
          para = [];
          if (!text) return;
          blocks.push(`<p>${renderInlineMarkdown(text)}</p>`);
        };

        const flushList = () => {
          if (!listItems || listItems.length === 0) { listItems = null; return; }
          const lis = listItems.map((it) => `<li>${renderInlineMarkdown(it)}</li>`).join("");
          blocks.push(`<ul>${lis}</ul>`);
          listItems = null;
        };

        const flushCode = () => {
          const body = codeLines.join("\\n").replace(/\\n+$/g, "");
          codeLines = [];
          blocks.push(`<pre class="code">${escapeHtml(body)}</pre>`);
        };

        for (let i = 0; i < lines.length; i++) {
          const ln = String(lines[i] ?? "");
          const t = ln.trimEnd();

          const fence = t.match(/^\\s*```/);
          if (fence) {
            if (inCode) {
              flushCode();
              inCode = false;
            } else {
              flushPara();
              flushList();
              inCode = true;
            }
            continue;
          }

          if (inCode) {
            codeLines.push(ln);
            continue;
          }

          if (!t.trim()) {
            flushPara();
            flushList();
            continue;
          }

          const bh = t.match(/^\\s*\\*\\*([^*]+)\\*\\*\\s*$/);
          if (bh) {
            flushPara();
            flushList();
            const text = String(bh[1] ?? "").trim();
            blocks.push(`<h3>${renderInlineMarkdown(text)}</h3>`);
            continue;
          }

          const h = t.match(/^\\s*(#{1,3})\\s+(.*)$/);
          if (h) {
            flushPara();
            flushList();
            const level = Math.min(3, Math.max(1, (h[1] || "").length));
            const text = String(h[2] ?? "").trim();
            blocks.push(`<h${level}>${renderInlineMarkdown(text)}</h${level}>`);
            continue;
          }

          const li = t.match(/^\\s*[-*]\\s+(.*)$/);
          if (li) {
            flushPara();
            if (!listItems) listItems = [];
            listItems.push(String(li[1] ?? "").trim());
            continue;
          }

          flushList();
          para.push(t.trim());
        }

        if (inCode) flushCode();
        flushPara();
        flushList();
        return blocks.join("\\n");
      }

      function rolloutStampFromFile(filePath) {
        try {
          const base = (filePath || "").split("/").slice(-1)[0] || "";
          const m = base.match(new RegExp("^rollout-(\\\\d{4}-\\\\d{2}-\\\\d{2})T(\\\\d{2}-\\\\d{2}-\\\\d{2})-"));
          if (!m) return "";
          return `${m[1]} ${String(m[2] || "").replace(/-/g, ":")}`;
        } catch (e) {
          return "";
        }
      }

      function threadLabel(t) {
        const stamp = rolloutStampFromFile(t.file || "");
        const idPart = t.thread_id ? shortId(t.thread_id) : shortId(((t.file || "").split("/").slice(-1)[0]) || (t.key || ""));
        if (stamp && idPart) return `${stamp} · ${idPart}`;
        return idPart || stamp || "unknown";
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
        allBtn.textContent = "全部";
        allBtn.onclick = async () => { currentKey = "all"; await refreshList(); };
        tabs.appendChild(allBtn);

        for (const t of items) {
          const btn = document.createElement("button");
          btn.className = "tab" + (currentKey === t.key ? " active" : "");
          const label = threadLabel(t);
          const labelSpan = document.createElement("span");
          labelSpan.textContent = label;
          const small = document.createElement("small");
          small.textContent = `(${t.count || 0})`;
          btn.appendChild(labelSpan);
          btn.appendChild(document.createTextNode(" "));
          btn.appendChild(small);
          btn.title = t.thread_id || t.file || t.key;
          btn.onclick = async () => { currentKey = t.key; await refreshList(); };
          tabs.appendChild(btn);
        }
      }

	      function render(msg) {
	        const row = document.createElement("div");
	        const t = formatTs(msg.ts || "");
	        const kind = msg.kind || "";
	        const kindClass = String(kind || "").replace(/[^a-z0-9_-]/gi, "-");
	        row.className = "row" + (kindClass ? ` kind-${kindClass}` : "");
	        try {
	          const fullId = msg.thread_id || msg.file || "";
	          row.title = fullId ? `${kind} ${fullId}` : String(kind || "");
	        } catch (e) {}
	        const sid = msg.thread_id ? shortId(msg.thread_id) : (msg.file ? shortId((msg.file.split("/").slice(-1)[0] || msg.file)) : "");
        const mode = (displayMode.value || "both");
        const isThinking = (kind === "reasoning_summary" || kind === "agent_reasoning");
        const showEn = !isThinking ? true : (mode !== "zh");
        const showZh = !isThinking ? false : (mode !== "en");
        const zhText = (typeof msg.zh === "string") ? msg.zh : "";
        const hasZh = !!zhText.trim();

        const autoscroll = (window.innerHeight + window.scrollY) >= (document.body.scrollHeight - 80);

	        let body = "";
	        let metaLeftExtra = "";
	        let metaRightExtra = "";
		        if (kind === "tool_output") {
		          const parsed = parseToolOutputText(msg.text || "");
		          const callId = parsed.callId || "";
		          const outputRaw = parsed.outputRaw || "";
		          const meta = callId ? callIndex.get(callId) : null;
		          const toolName = meta && meta.tool_name ? String(meta.tool_name) : "";
			          const exitCode = extractExitCode(outputRaw);
			          const outputBody = extractOutputBody(outputRaw);
			          const cmdFull = (meta && meta.args_obj && toolName === "shell_command") ? String(meta.args_obj.command || "") : "";
			          const argsRaw = (meta && meta.args_raw) ? String(meta.args_raw || "") : "";
		          const detailsId = ("tool_" + safeDomId((msg.id || callId || "") + "_details"));
		          const summaryId = ("tool_" + safeDomId((msg.id || callId || "") + "_summary"));

			          let runShort = "";
			          let expandedText = "";

			          if (toolName === "shell_command" && cmdFull) {
			            runShort = formatShellRun(cmdFull, outputBody, exitCode);
			            const runLong = formatShellRunExpanded(cmdFull, outputBody, exitCode);
			            if (runLong && runLong !== runShort) expandedText = runLong;
			          } else if (toolName === "apply_patch") {
			            runShort = formatApplyPatchRun(argsRaw, outputBody, 8);
			            const runLong = formatApplyPatchRun(argsRaw, outputBody, 120);
			            const parts = [];
			            if (argsRaw.trim()) parts.push(argsRaw.trim());
			            if (runLong && runLong.trim()) parts.push(runLong.trim());
			            expandedText = parts.join("\\n\\n");
			          } else if (toolName === "view_image") {
			            const p = (meta && meta.args_obj) ? String(meta.args_obj.path || "") : "";
			            const base = (p.split(/[\\\\/]/).pop() || "").trim();
			            const first = firstMeaningfulLine(outputBody) || "attached local image";
			            runShort = `• ${first}${base ? `: ${base}` : ``}`;
			          } else {
			            const header = `• ${toolName || "tool_output"}`;
			            const lines = normalizeNonEmptyLines(outputBody);
			            runShort = formatOutputTree(header, lines, 10);
			            const runLong = formatOutputTree(header, lines, 120);
			            if (runLong && runLong !== runShort) expandedText = runLong;
			          }

		          if (!String(runShort || "").trim()) {
		            const header = `• ${toolName || "tool_output"}`;
		            runShort = formatOutputTree(header, normalizeNonEmptyLines(outputBody), 10);
		          }

			          const hasDetails = !!String(expandedText || "").trim();
			          const detailsHtml = hasDetails ? `<pre id="${escapeHtml(detailsId)}" class="code hidden">${escapeHtml(expandedText)}</pre>` : ``;
			          if (hasDetails) metaRightExtra = `<button class="tool-toggle" type="button" data-target="${escapeHtml(detailsId)}" data-swap="${escapeHtml(summaryId)}">详情</button>`;
			          body = `
			            <div class="tool-card">
			              ${runShort ? `<pre id="${escapeHtml(summaryId)}" class="code">${escapeHtml(runShort)}</pre>` : ``}
			              ${detailsHtml}
			            </div>
			          `;
			        } else if (kind === "tool_call") {
		          const parsed = parseToolCallText(msg.text || "");
		          const toolName = parsed.toolName || "tool_call";
		          const callId = parsed.callId || "";
		          const argsRaw = parsed.argsRaw || "";
		          const argsObj = safeJsonParse(argsRaw);
		          if (callId) callIndex.set(callId, { tool_name: toolName, args_raw: argsRaw, args_obj: argsObj });
		          // Avoid duplicate clutter: tool_output already renders the useful summary for these.
		          if (toolName === "shell_command" || toolName === "view_image" || toolName === "apply_patch") return;

	          if (toolName === "update_plan" && argsObj && typeof argsObj === "object") {
	            const explanation = (typeof argsObj.explanation === "string") ? argsObj.explanation : "";
	            const plan = Array.isArray(argsObj.plan) ? argsObj.plan : [];
	            const items = [];
	            for (const it of plan) {
	              if (!it || typeof it !== "object") continue;
	              const st = statusIcon(it.status);
	              const step = String(it.step || "").trim();
	              if (!step) continue;
	              items.push(`- ${st} ${step}`);
	            }
	            const md = [
	              "**更新计划**",
	              ...(items.length ? items : ["- （无变更）"]),
	              ...(explanation.trim() ? ["", "**说明**", explanation.trim()] : []),
	            ].join("\\n");
	            metaLeftExtra = `<span class="pill">更新计划</span><span class="pill">${escapeHtml(String(items.length || 0))} 项</span>`;
	            body = `<div class="md">${renderMarkdown(md)}</div>`;
	          } else if (toolName === "shell_command" && argsObj && typeof argsObj === "object") {
	            const wd = String(argsObj.workdir || "").trim();
	            const cmd = String(argsObj.command || "");
	            const timeoutMs = argsObj.timeout_ms;
	            const cmdSummary = summarizeCommand(cmd) || "shell_command";
	            body = `
	              <details class="tool-card">
	                <summary class="meta">执行命令（点击展开）: <code>${escapeHtml(cmdSummary)}</code></summary>
	                <div class="tool-meta">
	                  <span class="pill">工具：<code>shell_command</code></span>
	                  ${callId ? `<span class="pill">call_id：<code>${escapeHtml(callId)}</code></span>` : ``}
	                  ${wd ? `<span class="pill">workdir：<code>${escapeHtml(wd)}</code></span>` : ``}
	                  ${Number.isFinite(Number(timeoutMs)) ? `<span class="pill">timeout_ms：<code>${escapeHtml(timeoutMs)}</code></span>` : ``}
	                </div>
	                <pre class="code">${escapeHtml(cmd)}</pre>
	                <details>
	                  <summary class="meta">原始参数</summary>
	                  <pre>${escapeHtml(argsRaw)}</pre>
	                </details>
	              </details>
	            `;
	          } else {
	            const pretty = argsObj ? JSON.stringify(argsObj, null, 2) : argsRaw;
	            body = `
	              <details class="tool-card">
	                <summary class="meta">工具调用（点击展开）: <code>${escapeHtml(toolName)}</code></summary>
	                <div class="tool-meta">
	                  <span class="pill">工具：<code>${escapeHtml(toolName)}</code></span>
	                  ${callId ? `<span class="pill">call_id：<code>${escapeHtml(callId)}</code></span>` : ``}
	                </div>
	                <pre>${escapeHtml(pretty || "")}</pre>
	              </details>
	            `;
	          }
	        } else if (kind === "user_message") {
	          body = `<pre><b>用户</b>\\n${escapeHtml(msg.text || "")}</pre>`;
	        } else if (kind === "assistant_message") {
	          const txt = String(msg.text || "");
	          if (isCodexEditSummary(txt)) {
	            body = renderCodexEditSummary(txt) || `<pre>${escapeHtml(txt)}</pre>`;
	          } else {
	            body = `<div class="md">${renderMarkdown(txt)}</div>`;
	          }
	        } else if (isThinking) {
	          const pills = [];
	          if (showEn) pills.push(`<span class="pill">思考（EN）</span>`);
	          if (showZh && hasZh) pills.push(`<span class="pill">思考（ZH）</span>`);
	          metaLeftExtra = pills.join("");
	          const enHtml = showEn ? `<div class="md">${renderMarkdown(msg.text || "")}</div>` : "";
	          const zhHtml = (showZh && hasZh) ? `<div class="md think-split">${renderMarkdown(zhText)}</div>` : "";
	          body = `${enHtml}${zhHtml}` || `<div class="meta">（空）</div>`;
        } else {
          // Fallback for unknown kinds.
          body = `<pre>${escapeHtml(msg.text || "")}</pre>`;
        }

	        row.innerHTML = `
	          <div class="meta meta-line">
	            <div class="meta-left">
	              <span class="timestamp">${escapeHtml(t.local || t.utc)}</span>
	              ${metaLeftExtra || ""}
	            </div>
	            <div class="meta-right">
	              ${metaRightExtra || ""}
	            </div>
	          </div>
	          ${body}
	        `;
	        decorateRow(row);
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

      function setDebug(s) {
        if (!debugText) return;
        debugText.textContent = s || "";
      }

      function fmtErr(e) {
        try {
          if (!e) return "unknown";
          if (typeof e === "string") return e;
          const msg = e.message ? String(e.message) : String(e);
          const st = e.stack ? String(e.stack) : "";
          return st ? `${msg}\n${st}` : msg;
        } catch (_) {
          return "unknown";
        }
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
        const opts = { method, cache: "no-store", headers: { "Content-Type": "application/json; charset=utf-8" } };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const resp = await fetch(url, opts);
        return await resp.json();
      }

      async function loadControl() {
        const ts = Date.now();
        let debugLines = [];
        setDebug("");

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
          translatorSel.innerHTML = "";
          for (const t of translators) {
            const opt = document.createElement("option");
            opt.value = t.id || t.name || "";
            opt.textContent = t.label || t.id || t.name || "";
            translatorSel.appendChild(opt);
          }
        } catch (e) {
          debugLines.push(`[error] render translators: ${fmtErr(e)}`);
        }

        // 2) Config
        let cfg = {};
        try {
          const c = await fetch(`/api/config?t=${ts}`, { cache: "no-store" }).then(r => r.json());
          cfg = c.config || c || {};
        } catch (e) {
          debugLines.push(`[error] /api/config: ${fmtErr(e)}`);
          cfg = {};
        }

        // 3) Apply config to UI（尽量继续，不让某个字段报错导致整体“全无”）
        try {
          cfgHome.value = cfg.config_home || "";
          watchHome.value = cfg.watch_codex_home || "";
          autoStart.value = cfg.auto_start ? "1" : "0";
          followProc.value = cfg.follow_codex_process ? "1" : "0";
          onlyWhenProc.value = (cfg.only_follow_when_process === false) ? "0" : "1";
          procRegex.value = cfg.codex_process_regex || "codex";
          replayLines.value = cfg.replay_last_lines ?? 0;
          includeAgent.value = cfg.include_agent_reasoning ? "1" : "0";
          displayMode.value = (localStorage.getItem("codex_sidecar_display_mode") || "both");
          pollInterval.value = cfg.poll_interval ?? 0.5;
          scanInterval.value = cfg.file_scan_interval ?? 2.0;
          {
            const want = cfg.translator_provider || "stub";
            translatorSel.value = want;
            if (translatorSel.value !== want) translatorSel.value = "stub";
          }
          const tc = cfg.translator_config || {};
          {
            const normalized = normalizeHttpProfiles(tc || {});
            httpProfiles = normalized.profiles;
            httpSelected = normalized.selected;
            refreshHttpProfileSelect();
            if (httpSelected) applyProfileToInputs(httpSelected);
          }
          showHttpFields((translatorSel.value || "") === "http");
        } catch (e) {
          debugLines.push(`[error] apply config: ${fmtErr(e)}`);
        }

        // 4) Status（运行态提示）
        try {
          const st = await fetch(`/api/status?t=${ts}`, { cache: "no-store" }).then(r => r.json());
          let hint = "";
          if (st.env && st.env.auth_env) {
            hint = st.env.auth_env_set ? `（已检测到 ${st.env.auth_env}）` : `（未设置环境变量 ${st.env.auth_env}）`;
          }
          const w = (st && st.watcher) ? st.watcher : {};
          const cur = w.current_file || "";
          const mode = w.follow_mode || "";
          const detected = (w.codex_detected === "1");
          const pids = w.codex_pids || "";
          const procFile = w.process_file || "";
          let detail = "";
          if (mode === "idle") detail = "（等待 Codex 进程）";
          else if (mode === "process") detail = pids ? `（process | pid:${pids}）` : "（process）";
          else if (mode === "fallback") detail = detected && pids ? `（fallback | pid:${pids}）` : "（fallback）";
          else if (mode) detail = `(${mode})`;
          if (st.running) {
            if (cur) setStatus(`运行中：${cur} ${detail} ${hint}`.trim());
            else setStatus(`运行中：${detail} ${hint}`.trim());
          } else {
            setStatus(`未运行 ${hint}`.trim());
          }
        } catch (e) {
          debugLines.push(`[warn] /api/status: ${fmtErr(e)}`);
        }

        // 5) Debug summary（不打印 token/url）
        try {
          const profNames = (httpProfiles || []).map(p => (p && p.name) ? String(p.name) : "").filter(Boolean);
          const cfgHomePath = String(cfg.config_home || "").replace(/\\/+$/, "");
          const cfgFile = cfgHomePath ? `${cfgHomePath}/tmp/codex_thinking_sidecar.config.json` : "";
          debugLines.unshift(
            `config_home: ${cfg.config_home || ""}`,
            `watch_codex_home: ${cfg.watch_codex_home || ""}`,
            `config_file: ${cfgFile}`,
            `translator_provider: ${cfg.translator_provider || ""}`,
            `http_profiles: ${profNames.length}${profNames.length ? " (" + profNames.join(", ") + ")" : ""}`,
            `http_selected: ${httpSelected || ""}`,
          );
        } catch (e) {
          debugLines.push(`[warn] debug: ${fmtErr(e)}`);
        }
        if (debugLines.length) setDebug(debugLines.join("\\n"));
      }

      async function saveConfig() {
        const provider = translatorSel.value || "stub";
        let wasRunning = false;
        try {
          const st = await fetch(`/api/status?t=${Date.now()}`, { cache: "no-store" }).then(r => r.json());
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
          auto_start: autoStart.value === "1",
          follow_codex_process: followProc.value === "1",
          only_follow_when_process: onlyWhenProc.value === "1",
          codex_process_regex: (procRegex.value || "codex").trim(),
          replay_last_lines: Number(replayLines.value || 0),
          include_agent_reasoning: includeAgent.value === "1",
          poll_interval: Number(pollInterval.value || 0.5),
          file_scan_interval: Number(scanInterval.value || 2.0),
          translator_provider: provider,
        };
        if (provider === "http") {
          patch.translator_config = { profiles: httpProfiles, selected: httpSelected };
        }
        await api("POST", "/api/config", patch);
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
        await loadControl();
        setStatus("已保存配置");
      }

      async function recoverConfig() {
        if (!confirm("将从本机配置备份尝试恢复翻译 Profiles，并覆盖当前翻译配置。是否继续？")) return;
        try {
          const r = await api("POST", "/api/config/recover", {});
          await loadControl();
          const src = (r && r.source) ? `（${r.source}）` : "";
          setStatus(`已恢复配置${src}`);
        } catch (e) {
          const msg = `恢复失败：${fmtErr(e)}`;
          setStatus(msg);
          setDebug(msg);
        }
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
        callIndex.clear();
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
          callIndex.clear();
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
	      recoverBtn.addEventListener("click", async () => { await recoverConfig(); });
	      startBtn.addEventListener("click", async () => { await startWatch(); });
	      stopBtn.addEventListener("click", async () => { await stopWatch(); });
	      clearBtn.addEventListener("click", async () => { await clearView(); });
	      if (scrollTopBtn) scrollTopBtn.addEventListener("click", () => { window.scrollTo({ top: 0, behavior: "smooth" }); });
	      if (scrollBottomBtn) scrollBottomBtn.addEventListener("click", () => { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); });

      let bootAutoStarted = false;
      async function maybeAutoStartOnce() {
        if (bootAutoStarted) return;
        bootAutoStarted = true;
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

      (async () => {
        await loadControl();
        await maybeAutoStartOnce();
        await loadControl();
        await bootstrap();
      })();
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
