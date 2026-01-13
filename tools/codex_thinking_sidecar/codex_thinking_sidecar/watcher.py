import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set

from .translator import Translator


_ROLLOUT_RE = re.compile(
    r"^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([0-9a-fA-F-]{36})\.jsonl$"
)


def _latest_rollout_file(codex_home: Path) -> Optional[Path]:
    sessions = codex_home / "sessions"
    if not sessions.exists():
        return None
    # Layout: sessions/YYYY/MM/DD/rollout-*.jsonl
    globbed = list(sessions.glob("*/*/*/rollout-*.jsonl"))
    if not globbed:
        return None
    globbed.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return globbed[0]


def _parse_thread_id_from_filename(path: Path) -> Optional[str]:
    m = _ROLLOUT_RE.match(path.name)
    if not m:
        return None
    return m.group(1)


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
    ) -> None:
        self._codex_home = codex_home
        self._ingest = ingest
        self._translator = translator
        self._replay_last_lines = max(0, int(replay_last_lines))
        self._poll_interval_s = max(0.05, float(poll_interval_s))
        self._file_scan_interval_s = max(0.2, float(file_scan_interval_s))
        self._include_agent_reasoning = include_agent_reasoning

        self._current_file: Optional[Path] = None
        self._offset: int = 0
        self._line_no: int = 0
        self._thread_id: Optional[str] = None

        self._seen: Set[str] = set()
        self._seen_max = 5000
        self._last_file_scan_ts = 0.0
        self._warned_missing = False
        self._last_error: str = ""

    def status(self) -> Dict[str, str]:
        return {
            "current_file": str(self._current_file) if self._current_file is not None else "",
            "thread_id": self._thread_id or "",
            "offset": str(self._offset),
            "line_no": str(self._line_no),
            "last_error": self._last_error or "",
        }

    def run(self, stop_event) -> None:
        # Initial pick
        self._switch_to_latest_if_needed(force=True)
        if self._current_file is None and not self._warned_missing:
            print(
                f"[sidecar] 未找到会话文件：{self._codex_home}/sessions/**/rollout-*.jsonl",
                file=sys.stderr,
            )
            self._warned_missing = True
        while not stop_event.is_set():
            now = time.time()
            if now - self._last_file_scan_ts >= self._file_scan_interval_s:
                self._switch_to_latest_if_needed(force=False)
                self._last_file_scan_ts = now
            self._poll_once()
            stop_event.wait(self._poll_interval_s)

    def _switch_to_latest_if_needed(self, force: bool) -> None:
        latest = _latest_rollout_file(self._codex_home)
        if latest is None:
            return
        if force or self._current_file is None or latest != self._current_file:
            self._current_file = latest
            self._thread_id = _parse_thread_id_from_filename(latest)
            self._offset = 0
            self._line_no = 0
            print(f"[sidecar] follow_file={latest}", file=sys.stderr)
            if self._replay_last_lines > 0:
                self._replay_tail(latest, self._replay_last_lines)
            else:
                # Seek to end (follow only new writes)
                try:
                    self._offset = latest.stat().st_size
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
                ingested += self._handle_line(bline, file_path=path, line_no=self._line_no)

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
                    bline = f.readline()
                    if not bline:
                        break
                    self._offset = f.tell()
                    self._line_no += 1
                    self._handle_line(bline.rstrip(b"\n"), file_path=path, line_no=self._line_no)
        except Exception:
            try:
                self._last_error = "poll_failed"
            except Exception:
                pass
            return

    def _handle_line(self, bline: bytes, file_path: Path, line_no: int) -> int:
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
            # Only translate "thinking" content; keep tool/user/assistant as-is.
            if kind in ("reasoning_summary", "agent_reasoning"):
                zh = self._translator.translate(text)
            else:
                zh = ""
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
            msg = {
                "id": hid[:16],
                "ts": ts,
                "kind": kind,
                "text": text,
                "zh": zh,
                "thread_id": self._thread_id or "",
                "file": str(file_path),
                "line": line_no,
            }
            if self._ingest.ingest(msg):
                ingested += 1
        return ingested

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
