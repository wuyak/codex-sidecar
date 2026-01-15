import hashlib
import json
import os
import queue
import re
import threading
import sys
import time
import urllib.error
import urllib.request
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Deque, Dict, Iterable, List, Optional, Pattern, Set, Tuple

from .translator import NoneTranslator, Translator

from .watch.procfs import _proc_iter_fd_targets, _proc_list_pids, _proc_read_cmdline, _proc_read_ppid
from .watch.rollout_paths import _ROLLOUT_RE, _find_rollout_file_for_thread, _latest_rollout_file, _parse_thread_id_from_filename
from .watch.translate_batch import _pack_translate_batch, _unpack_translate_batch
from .watch.translation_pump import TranslationPump
from .watch.follow_picker import FollowPicker


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")













def _sha1_hex(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", errors="replace")).hexdigest()










@dataclass
class HttpIngestClient:
    server_url: str
    timeout_s: float = 2.0

    def ingest(self, msg: dict) -> bool:
        url = self.server_url.rstrip("/") + "/ingest"
        data = json.dumps(msg, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, method="POST")
        req.add_header("Content-Type", "application/json; charset=utf-8")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                return 200 <= resp.status < 300
        except (urllib.error.URLError, urllib.error.HTTPError):
            return False


class RolloutWatcher:
    def __init__(
        self,
        codex_home: Path,
        ingest: HttpIngestClient,
        translator: Translator,
        replay_last_lines: int,
        poll_interval_s: float,
        file_scan_interval_s: float,
        include_agent_reasoning: bool,
        follow_codex_process: bool = False,
        codex_process_regex: str = "codex",
        only_follow_when_process: bool = True,
    ) -> None:
        self._codex_home = codex_home
        self._ingest = ingest
        self._translator = translator
        self._replay_last_lines = max(0, int(replay_last_lines))
        self._poll_interval_s = max(0.05, float(poll_interval_s))
        self._file_scan_interval_s = max(0.2, float(file_scan_interval_s))
        self._include_agent_reasoning = include_agent_reasoning
        self._follow_picker = FollowPicker(
            codex_home=self._codex_home,
            follow_codex_process=bool(follow_codex_process),
            codex_process_regex=str(codex_process_regex or "codex"),
            only_follow_when_process=bool(only_follow_when_process),
        )

        self._current_file: Optional[Path] = None
        self._offset: int = 0
        self._line_no: int = 0
        self._thread_id: Optional[str] = None

        self._seen: Set[str] = set()
        self._seen_max = 5000
        self._last_file_scan_ts = 0.0
        self._warned_missing = False
        self._last_error: str = ""
        self._follow_mode: str = "legacy"  # legacy|process|fallback|idle
        self._codex_detected: bool = False
        self._codex_pids: List[int] = []
        self._process_file: Optional[Path] = None

        # Follow strategy:
        # - auto: pick follow file via existing logic (latest / process-based)
        # - pin:  lock to a specific thread/file (user-selected in UI)
        self._follow_lock = threading.Lock()
        self._selection_mode: str = "auto"  # auto|pin
        self._pinned_thread_id: str = ""
        self._pinned_file: Optional[Path] = None
        self._follow_dirty: bool = False

        # Codex TUI log tail: surface "waiting for tool gate" so UI can show
        # "needs confirmation" states even when no new rollout lines appear.
        self._tui_log_path = (self._codex_home / "log" / "codex-tui.log")
        self._tui_inited = False
        self._tui_offset = 0
        self._tui_buf = b""
        self._tui_last_toolcall: Optional[Dict[str, object]] = None
        self._tui_gate_waiting: bool = False
        self._stop_event: Optional[threading.Event] = None

        # Translation is decoupled from ingestion: watcher ingests EN first,
        # then a background worker translates and patches via op=update.
        self._translate = TranslationPump(
            translator=self._translator,
            emit_update=self._ingest.ingest,
            batch_size=5,
        )

    def _stop_requested(self) -> bool:
        ev = self._stop_event
        if ev is None:
            return False
        try:
            return ev.is_set()
        except Exception:
            return False

    def status(self) -> Dict[str, str]:
        sel = "auto"
        pin_tid = ""
        pin_file = ""
        try:
            with self._follow_lock:
                sel = self._selection_mode or "auto"
                pin_tid = self._pinned_thread_id or ""
                pin_file = str(self._pinned_file) if self._pinned_file is not None else ""
        except Exception:
            sel = "auto"
        return {
            "current_file": str(self._current_file) if self._current_file is not None else "",
            "thread_id": self._thread_id or "",
            "offset": str(self._offset),
            "line_no": str(self._line_no),
            "last_error": self._last_error or "",
            "follow_mode": self._follow_mode or "",
            "selection_mode": sel,
            "pinned_thread_id": pin_tid,
            "pinned_file": pin_file,
            "codex_detected": "1" if self._codex_detected else "0",
            "codex_pids": ",".join(str(x) for x in self._codex_pids[:8]),
            "codex_process_regex": self._follow_picker.codex_process_regex,
            "process_file": str(self._process_file) if self._process_file is not None else "",
        }

    def set_follow(self, mode: str, thread_id: str = "", file: str = "") -> None:
        """
        Update follow strategy at runtime (called from HTTP control plane).

        - mode=auto: use existing selection strategy (latest/process)
        - mode=pin : lock to a specific thread_id or file path
        """
        m = str(mode or "").strip().lower()
        if m not in ("auto", "pin"):
            m = "auto"
        tid = str(thread_id or "").strip()
        fp = str(file or "").strip()

        pinned_file: Optional[Path] = None
        if fp:
            try:
                cand = Path(fp).expanduser()
                if not cand.is_absolute():
                    cand = (self._codex_home / cand).resolve()
                else:
                    cand = cand.resolve()
                sessions_root = (self._codex_home / "sessions").resolve()
                try:
                    _ = cand.relative_to(sessions_root)
                except Exception:
                    cand = None  # type: ignore[assignment]
                if cand is not None and cand.exists() and cand.is_file() and _ROLLOUT_RE.match(cand.name):
                    pinned_file = cand
            except Exception:
                pinned_file = None

        if pinned_file is None and tid:
            pinned_file = _find_rollout_file_for_thread(self._codex_home, tid)

        with self._follow_lock:
            self._selection_mode = m
            if m == "pin":
                self._pinned_thread_id = tid
                self._pinned_file = pinned_file
            else:
                self._pinned_thread_id = ""
                self._pinned_file = None
            self._follow_dirty = True

    def run(self, stop_event) -> None:
        # Keep a reference so inner loops can react quickly (e.g. stop in the middle of large file reads).
        self._stop_event = stop_event
        self._translate.start(stop_event)
        # Initial pick
        self._switch_to_latest_if_needed(force=True)
        if self._current_file is None and not self._warned_missing:
            if self._follow_mode == "idle":
                print("[sidecar] 等待 Codex 进程（尚未开始跟随会话文件）", file=sys.stderr)
            else:
                print(
                    f"[sidecar] 未找到会话文件：{self._codex_home}/sessions/**/rollout-*.jsonl",
                    file=sys.stderr,
                )
            self._warned_missing = True
        while not stop_event.is_set():
            now = time.time()
            # Follow mode changed (e.g. UI pinned a thread): force a rescan/switch immediately.
            force_switch = False
            try:
                with self._follow_lock:
                    if self._follow_dirty:
                        self._follow_dirty = False
                        force_switch = True
            except Exception:
                force_switch = False
            if force_switch:
                self._switch_to_latest_if_needed(force=True)
                self._last_file_scan_ts = now
            if now - self._last_file_scan_ts >= self._file_scan_interval_s:
                self._switch_to_latest_if_needed(force=False)
                self._last_file_scan_ts = now
            self._poll_once()
            self._poll_tui_log()
            stop_event.wait(self._poll_interval_s)


    def _switch_to_latest_if_needed(self, force: bool) -> None:
        pick = self._follow_picker.pick(
            selection_mode=self._selection_mode,
            pinned_thread_id=self._pinned_thread_id,
            pinned_file=self._pinned_file,
        )
        picked = pick.picked
        self._process_file = pick.process_file
        self._codex_detected = bool(pick.codex_detected)
        self._codex_pids = list(pick.codex_pids or [])
        self._follow_mode = str(pick.follow_mode or "")
        if self._selection_mode == "pin" and picked is not None and self._pinned_file is None:
            self._pinned_file = picked
            tid = _parse_thread_id_from_filename(picked)
            if tid:
                self._pinned_thread_id = tid
        if picked is None:
            return
        if force or self._current_file is None or picked != self._current_file:
            self._current_file = picked
            self._thread_id = _parse_thread_id_from_filename(picked)
            self._offset = 0
            self._line_no = 0
            print(f"[sidecar] follow_file={picked}", file=sys.stderr)
            if self._replay_last_lines > 0:
                self._replay_tail(picked, self._replay_last_lines)
            else:
                # Seek to end (follow only new writes)
                try:
                    self._offset = picked.stat().st_size
                except Exception:
                    self._offset = 0


    def _read_tail_lines(self, path: Path, last_lines: int, max_bytes: int = 32 * 1024 * 1024) -> List[bytes]:
        """
        从文件尾部向前读取，尽量精确获取最后 N 行，避免单纯固定字节数导致“回放不足”。

        - last_lines: 需要的行数（不含可能的前置 partial line）
        - max_bytes: 最多读取的字节数上限，防止极端大文件占用过高
        """
        try:
            size = path.stat().st_size
        except Exception:
            return []

        if size == 0:
            return []

        block = 256 * 1024
        want = max(1, last_lines + 1)
        buf = b""
        read_bytes = 0
        pos = size

        while pos > 0 and buf.count(b"\n") < want and read_bytes < max_bytes:
            step = block if pos >= block else pos
            pos -= step
            try:
                with path.open("rb") as f:
                    f.seek(pos)
                    chunk = f.read(step)
            except Exception:
                break
            buf = chunk + buf
            read_bytes += len(chunk)

        lines = buf.splitlines()
        # If we didn't start from 0, we may have a partial first line; drop it.
        if pos != 0 and lines:
            lines = lines[1:]
        return lines[-last_lines:] if last_lines > 0 else lines

    def _replay_tail(self, path: Path, last_lines: int) -> None:
        # After replay, continue following from EOF.
        try:
            self._offset = path.stat().st_size
        except Exception:
            self._offset = 0

        # Heuristic: If the newest N lines contain no reasoning items (e.g., huge tool outputs),
        # expand the replay window to find at least some reasoning for quick validation.
        max_lines = 5000
        replay_lines = max(0, int(last_lines))
        if replay_lines == 0:
            return

        total_ingested = 0
        while True:
            tail = self._read_tail_lines(path, last_lines=replay_lines)
            ingested = 0
            for bline in tail:
                self._line_no += 1
                ingested += self._handle_line(bline, file_path=path, line_no=self._line_no, is_replay=True)

            total_ingested += ingested
            if total_ingested > 0 or replay_lines >= max_lines:
                break
            replay_lines = min(max_lines, replay_lines * 5)

    def _poll_once(self) -> None:
        path = self._current_file
        if path is None:
            return
        try:
            with path.open("rb") as f:
                f.seek(self._offset)
                while True:
                    if self._stop_requested():
                        break
                    bline = f.readline()
                    if not bline:
                        break
                    self._offset = f.tell()
                    self._line_no += 1
                    self._handle_line(bline.rstrip(b"\n"), file_path=path, line_no=self._line_no, is_replay=False)
        except Exception:
            try:
                self._last_error = "poll_failed"
            except Exception:
                pass
            return

    def _handle_line(self, bline: bytes, file_path: Path, line_no: int, is_replay: bool) -> int:
        # If user clicked “停止监听”, avoid ingesting more lines even if we're still finishing in-flight work.
        if self._stop_requested():
            return 0
        if not bline:
            return 0
        try:
            obj = json.loads(bline.decode("utf-8", errors="replace"))
        except Exception:
            return 0

        ts = obj.get("timestamp") or ""
        top_type = obj.get("type")
        payload = obj.get("payload") or {}

        extracted: List[Dict[str, str]] = []

        if top_type == "response_item":
            # Assistant / User messages (final output and input echo)
            if payload.get("type") == "message":
                role = payload.get("role")
                # Prefer event_msg.user_message for user input (more concise).
                if role == "assistant":
                    content = payload.get("content")
                    parts: List[str] = []
                    if isinstance(content, list):
                        for c in content:
                            if isinstance(c, dict) and isinstance(c.get("text"), str):
                                txt = c.get("text") or ""
                                if txt.strip():
                                    parts.append(txt)
                    if parts:
                        extracted.append({"kind": f"{role}_message", "text": "\n".join(parts)})

            if payload.get("type") == "reasoning":
                summary = payload.get("summary")
                if isinstance(summary, list):
                    parts = []
                    for item in summary:
                        if isinstance(item, dict) and item.get("type") == "summary_text":
                            txt = item.get("text")
                            if isinstance(txt, str) and txt.strip():
                                parts.append(txt)
                    if parts:
                        extracted.append({"kind": "reasoning_summary", "text": "\n".join(parts)})

            # Tool calls / outputs (CLI tools, custom tools, web search)
            ptype = payload.get("type")
            if ptype in ("function_call", "custom_tool_call", "web_search_call"):
                name = ""
                call_id = ""
                if isinstance(payload.get("name"), str):
                    name = payload.get("name") or ""
                if isinstance(payload.get("call_id"), str):
                    call_id = payload.get("call_id") or ""
                if ptype == "web_search_call":
                    action = payload.get("action")
                    text = json.dumps(action, ensure_ascii=False) if isinstance(action, (dict, list)) else str(action or "")
                    title = "web_search_call"
                else:
                    key = "arguments" if ptype == "function_call" else "input"
                    raw = payload.get(key)
                    text = str(raw or "")
                    title = name or ptype
                prefix = f"call_id={call_id}\n" if call_id else ""
                extracted.append(
                    {
                        "kind": "tool_call",
                        "text": f"{title}\n{prefix}{text}".rstrip(),
                    }
                )

            if ptype in ("function_call_output", "custom_tool_call_output"):
                call_id = payload.get("call_id") if isinstance(payload.get("call_id"), str) else ""
                out = payload.get("output")
                text = str(out or "")
                prefix = f"call_id={call_id}\n" if call_id else ""
                extracted.append(
                    {
                        "kind": "tool_output",
                        "text": f"{prefix}{text}".rstrip(),
                    }
                )

        if self._include_agent_reasoning and top_type == "event_msg":
            if payload.get("type") == "agent_reasoning":
                txt = payload.get("text")
                if isinstance(txt, str) and txt.strip():
                    extracted.append({"kind": "agent_reasoning", "text": txt})

        # User message echo in event stream (usually the most concise)
        if top_type == "event_msg":
            if payload.get("type") == "user_message":
                msg = payload.get("message")
                if isinstance(msg, str) and msg.strip():
                    extracted.append({"kind": "user_message", "text": msg})

        ingested = 0
        for item in extracted:
            kind = item["kind"]
            text = item["text"]
            # Dedup across replay expansions.
            #
            # - reasoning_summary: 通常每条是“最终摘要”，用 timestamp 参与 key 能更好地区分不同轮次
            # - agent_reasoning: 往往是流式/重复广播（同一段 text 可能出现多次），避免把 ts 纳入 key
            #   以减少 UI 里“同一段内容重复两次”的噪音
            if kind == "agent_reasoning":
                hid = _sha1_hex(f"{file_path}:{kind}:{text}")
            else:
                hid = _sha1_hex(f"{file_path}:{kind}:{ts}:{text}")
            if self._dedupe(hid, kind=kind):
                continue
            if self._stop_requested():
                return ingested
            mid = hid[:16]
            is_thinking = kind in ("reasoning_summary", "agent_reasoning")
            msg = {
                "id": mid,
                "ts": ts,
                "kind": kind,
                "text": text,
                "zh": "",
                "thread_id": self._thread_id or "",
                "file": str(file_path),
                "line": line_no,
            }
            if self._ingest.ingest(msg):
                ingested += 1
                if is_thinking and text.strip():
                    # 翻译走后台支路：回放阶段可聚合，实时阶段按单条慢慢补齐。
                    thread_key = (self._thread_id or "") or str(file_path)
                    self._translate.enqueue(mid=mid, text=text, thread_key=thread_key, batchable=is_replay)
        return ingested

    def _poll_tui_log(self) -> None:
        """
        Tail ~/.codex/log/codex-tui.log and emit tool gate status to UI.

        说明：
        - 该日志属于 Codex TUI 交互层；当需要用户在终端确认/授权时，rollout JSONL 可能暂时不再增长，
          导致 UI “看起来卡住”。这里把关键状态转成一条消息推送到 UI。
        - 为避免刷屏，只解析非常少量的关键行：ToolCall / waiting for tool gate / tool gate released。
        """
        path = self._tui_log_path
        try:
            if not path.exists():
                return
        except Exception:
            return

        # One-time init: scan tail for a "currently waiting" state.
        if not self._tui_inited:
            self._tui_inited = True
            try:
                st = path.stat()
                self._tui_offset = int(st.st_size)
            except Exception:
                self._tui_offset = 0
            try:
                tail = self._read_tail_lines(path, last_lines=240, max_bytes=2 * 1024 * 1024)
                self._tui_scan_gate_state(tail, synthetic_only=True)
            except Exception:
                pass

        try:
            st = path.stat()
            size = int(st.st_size)
        except Exception:
            return
        if self._tui_offset > size:
            # Truncated/rotated.
            self._tui_offset = 0
            self._tui_buf = b""

        try:
            with path.open("rb") as f:
                f.seek(self._tui_offset)
                chunk = f.read(256 * 1024)
                self._tui_offset = int(f.tell())
        except Exception:
            return
        if not chunk:
            return

        buf = self._tui_buf + chunk
        parts = buf.split(b"\n")
        self._tui_buf = parts.pop() if parts else b""
        if parts:
            self._tui_scan_gate_state(parts, synthetic_only=False)

    def _tui_scan_gate_state(self, lines: List[bytes], synthetic_only: bool) -> None:
        last_wait: Optional[Tuple[str, Optional[Dict[str, object]]]] = None
        gate_waiting = bool(self._tui_gate_waiting)
        last_toolcall = self._tui_last_toolcall

        for bline in lines:
            try:
                raw = bline.decode("utf-8", errors="replace")
            except Exception:
                continue
            line = _ANSI_RE.sub("", raw).strip("\r")
            if not line.strip():
                continue

            ts, msg = self._tui_split_ts(line)
            if not msg:
                continue

            toolcall = self._tui_parse_toolcall(msg)
            if toolcall is not None:
                toolcall["ts"] = ts
                last_toolcall = toolcall
                continue

            if "waiting for tool gate" in msg:
                gate_waiting = True
                last_wait = (ts, last_toolcall)
                if not synthetic_only:
                    self._emit_tool_gate(ts, waiting=True, toolcall=last_toolcall)
                continue

            if "tool gate released" in msg:
                if gate_waiting and not synthetic_only:
                    self._emit_tool_gate(ts, waiting=False, toolcall=last_toolcall)
                gate_waiting = False
                last_wait = None
                continue

        # If we're only doing a synthetic init scan, emit a single "still waiting" message.
        if synthetic_only and gate_waiting and last_wait is not None:
            ts, tc = last_wait
            self._emit_tool_gate(ts, waiting=True, toolcall=tc, synthetic=True)

        self._tui_last_toolcall = last_toolcall
        self._tui_gate_waiting = gate_waiting

    @staticmethod
    def _tui_split_ts(line: str) -> Tuple[str, str]:
        """
        codex-tui.log format (after stripping ANSI):
          2026-01-14T12:34:56.123Z  INFO waiting for tool gate
        """
        s = (line or "").lstrip()
        if not s:
            return ("", "")
        parts = s.split(" ", 1)
        if len(parts) < 2:
            return ("", s)
        ts = parts[0].strip()
        rest = parts[1].strip()
        if ts and ("T" in ts) and (ts[0:4].isdigit()):
            return (ts, rest)
        return ("", s)

    @staticmethod
    def _tui_parse_toolcall(msg: str) -> Optional[Dict[str, object]]:
        # Example:
        #   INFO ToolCall: shell {"command":[...],"with_escalated_permissions":true,"justification":"..."}
        if "ToolCall:" not in msg:
            return None
        try:
            after = msg.split("ToolCall:", 1)[1].strip()
            if not after:
                return None
            tool, rest = (after.split(" ", 1) + [""])[:2]
            tool = tool.strip()
            rest = rest.strip()
            payload = None
            if rest.startswith("{") and rest.endswith("}"):
                try:
                    payload = json.loads(rest)
                except Exception:
                    payload = None
            return {"tool": tool, "payload": payload, "raw": rest}
        except Exception:
            return None

    @staticmethod
    def _map_tui_tool_name(tool: str) -> str:
        t = str(tool or "").strip()
        if t == "shell":
            return "shell_command"
        return t or "tool"

    @staticmethod
    def _redact_secrets(s: str) -> str:
        # Best-effort redaction for common token formats.
        out = str(s or "")
        out = re.sub(r"\b(sk-[A-Za-z0-9]{8,})\b", "sk-***", out)
        out = re.sub(r"\b(bearer)\s+[A-Za-z0-9._-]{12,}\b", r"\1 ***", out, flags=re.IGNORECASE)
        return out

    def _format_tool_gate_md(self, waiting: bool, toolcall: Optional[Dict[str, object]]) -> str:
        icon = "⏸️" if waiting else "▶️"
        title = "终端等待确认（tool gate）" if waiting else "终端已确认（tool gate released）"
        lines = [f"{icon} {title}"]

        if toolcall:
            tool = self._map_tui_tool_name(str(toolcall.get("tool") or ""))
            payload = toolcall.get("payload") if isinstance(toolcall.get("payload"), dict) else None
            if tool:
                lines.append("")
                lines.append(f"- 工具：`{tool}`")
            if payload and isinstance(payload, dict):
                just = payload.get("justification")
                if isinstance(just, str) and just.strip():
                    lines.append(f"- 理由：{self._redact_secrets(just.strip())}")
                cmd = payload.get("command")
                cmd_s = ""
                if isinstance(cmd, list):
                    try:
                        cmd_s = " ".join(str(x) for x in cmd if x is not None)
                    except Exception:
                        cmd_s = ""
                elif isinstance(cmd, str):
                    cmd_s = cmd
                if cmd_s.strip():
                    cmd_s = self._redact_secrets(cmd_s.strip())
                    lines.append("")
                    lines.append("```")
                    lines.append(cmd_s)
                    lines.append("```")

        if waiting:
            lines.append("")
            lines.append("请回到终端完成确认/授权后，UI 才会继续刷新后续输出。")
        return "\n".join(lines).strip()

    def _emit_tool_gate(
        self,
        ts: str,
        waiting: bool,
        toolcall: Optional[Dict[str, object]],
        synthetic: bool = False,
    ) -> None:
        if not ts:
            try:
                ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
            except Exception:
                ts = ""
        text = self._format_tool_gate_md(waiting=waiting, toolcall=toolcall)
        # Synthetic init scan: avoid spamming a "released" event, only show if waiting.
        if synthetic and not waiting:
            return

        file_path = str(self._tui_log_path)
        try:
            hid = _sha1_hex(f"{file_path}:tool_gate:{ts}:{text}")
        except Exception:
            hid = _sha1_hex(f"{file_path}:tool_gate::{text}")
        if self._dedupe(hid, kind="tool_gate"):
            return
        msg = {
            "id": hid[:16],
            "ts": ts,
            "kind": "tool_gate",
            "text": text,
            "zh": "",
            "thread_id": self._thread_id or "",
            "file": file_path,
            "line": 0,
        }
        try:
            self._ingest.ingest(msg)
        except Exception:
            return

    def _dedupe(self, key: str, kind: str) -> bool:
        if key in self._seen:
            return True
        self._seen.add(key)
        if len(self._seen) > self._seen_max:
            # Cheap pruning: approximate by clearing periodically.
            # (OK for a sidecar; duplicates are benign and bounded.)
            self._seen.clear()
            # Keep a marker so we don't immediately re-add duplicates in the same run loop.
            self._seen.add(key)
        return False
