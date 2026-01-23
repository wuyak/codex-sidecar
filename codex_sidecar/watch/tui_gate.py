import re
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .tui_gate_helpers import (
    format_tool_gate_md as _format_tool_gate_md_impl,
    map_tool_name as _map_tool_name_impl,
    parse_toolcall as _parse_toolcall_impl,
    redact_secrets as _redact_secrets_impl,
    split_ts as _split_ts_impl,
    ts_age_s as _ts_age_s_impl,
)

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_WAIT_RE = re.compile(r"^INFO\s+waiting\s+for\s+tool\s+gate\s*$")
_RELEASE_RE = re.compile(r"^INFO\s+tool\s+gate\s+released\s*$")

# Only notify the UI if the terminal approval is *actually* blocking for a moment.
# This avoids noisy "blink" toasts when the approval is auto-resolved quickly.
_WAIT_NOTIFY_DELAY_S = 1.25


class TuiGateTailer:
    """
    Tail ~/.codex/log/codex-tui.log and emit tool gate status to UI.

    说明：
    - 该日志属于 Codex TUI 交互层；当需要用户在终端确认/授权时，rollout JSONL 可能暂时不再增长，
      导致 UI “看起来卡住”。这里把关键状态转成一条消息推送到 UI。
    - 为避免刷屏，只解析非常少量的关键行：ToolCall / waiting for tool gate / tool gate released。
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._inited = False
        self._offset = 0
        self._buf = b""
        self._last_toolcall: Optional[Dict[str, object]] = None
        self._gate_waiting = False
        self._wait_observed_at = 0.0
        self._wait_ts = ""
        self._wait_toolcall: Optional[Dict[str, object]] = None
        self._wait_emitted = False

    def poll(
        self,
        *,
        thread_id: str,
        read_tail_lines: Callable[..., List[bytes]],
        sha1_hex: Callable[[str], str],
        dedupe: Callable[[str, str], bool],
        ingest: Callable[[Dict[str, Any]], bool],
    ) -> None:
        path = self._path
        try:
            if not path.exists():
                return
        except Exception:
            return

        if not self._inited:
            self._inited = True
            try:
                st = path.stat()
                self._offset = int(st.st_size)
            except Exception:
                self._offset = 0
            try:
                tail = read_tail_lines(path, last_lines=240, max_bytes=2 * 1024 * 1024)
                self._scan_gate_state(
                    tail,
                    synthetic_only=True,
                    thread_id=thread_id,
                    sha1_hex=sha1_hex,
                    dedupe=dedupe,
                    ingest=ingest,
                )
            except Exception:
                pass

        try:
            st = path.stat()
            size = int(st.st_size)
        except Exception:
            return
        if self._offset > size:
            # Truncated/rotated.
            self._offset = 0
            self._buf = b""
        if self._offset == size:
            # Even if codex-tui.log hasn't grown, we may still be in a waiting state
            # and need to fire the delayed "waiting" notification once.
            try:
                self._maybe_emit_delayed_wait(
                    thread_id=thread_id,
                    sha1_hex=sha1_hex,
                    dedupe=dedupe,
                    ingest=ingest,
                )
            except Exception:
                pass
            return

        try:
            with path.open("rb") as f:
                f.seek(self._offset)
                chunk = f.read(256 * 1024)
                self._offset = int(f.tell())
        except Exception:
            return
        if not chunk:
            return

        buf = self._buf + chunk
        parts = buf.split(b"\n")
        self._buf = parts.pop() if parts else b""
        if parts:
            self._scan_gate_state(
                parts,
                synthetic_only=False,
                thread_id=thread_id,
                sha1_hex=sha1_hex,
                dedupe=dedupe,
                ingest=ingest,
            )
        try:
            self._maybe_emit_delayed_wait(
                thread_id=thread_id,
                sha1_hex=sha1_hex,
                dedupe=dedupe,
                ingest=ingest,
            )
        except Exception:
            pass

    def _scan_gate_state(
        self,
        lines: List[bytes],
        *,
        synthetic_only: bool,
        thread_id: str,
        sha1_hex: Callable[[str], str],
        dedupe: Callable[[str, str], bool],
        ingest: Callable[[Dict[str, Any]], bool],
    ) -> None:
        last_wait: Optional[Tuple[str, Optional[Dict[str, object]]]] = None
        gate_waiting = bool(self._gate_waiting)
        last_toolcall = self._last_toolcall
        wait_observed_at = float(self._wait_observed_at or 0.0)
        wait_ts = str(self._wait_ts or "")
        wait_toolcall = self._wait_toolcall
        wait_emitted = bool(self._wait_emitted)

        for bline in lines:
            try:
                raw = bline.decode("utf-8", errors="replace")
            except Exception:
                continue
            line = _ANSI_RE.sub("", raw).strip("\r")
            if not line.strip():
                continue

            ts, msg = self._split_ts(line)
            if not msg:
                continue

            if ts:
                toolcall = self._parse_toolcall(msg)
                if toolcall is not None:
                    toolcall["ts"] = ts
                    last_toolcall = toolcall
                    continue

            if ts and _WAIT_RE.match(msg):
                last_wait = (ts, last_toolcall)
                # codex-tui.log may emit repeated "waiting" lines while blocked.
                # We only treat it as "actionable waiting" after a small delay,
                # otherwise quick auto-resolved approvals would spam the UI.
                if not gate_waiting:
                    gate_waiting = True
                    wait_observed_at = time.monotonic()
                    wait_ts = ts
                    wait_toolcall = last_toolcall
                    wait_emitted = False
                else:
                    if wait_toolcall is None and last_toolcall is not None:
                        wait_toolcall = last_toolcall
                continue

            if ts and _RELEASE_RE.match(msg):
                if gate_waiting and wait_emitted and not synthetic_only:
                    self._emit_tool_gate(
                        ts,
                        waiting=False,
                        toolcall=last_toolcall,
                        thread_id=thread_id,
                        sha1_hex=sha1_hex,
                        dedupe=dedupe,
                        ingest=ingest,
                    )
                gate_waiting = False
                last_wait = None
                wait_observed_at = 0.0
                wait_ts = ""
                wait_toolcall = None
                wait_emitted = False
                continue

        # If we're only doing a synthetic init scan, emit a single "still waiting" message.
        if synthetic_only and gate_waiting and last_wait is not None:
            ts, tc = last_wait
            # Avoid reporting stale "waiting" states from old sessions/log tails.
            # This can happen if a previous Codex run crashed while waiting, leaving the last line as "waiting".
            age_s = self._ts_age_s(ts)
            if age_s is not None and age_s > 90.0:
                gate_waiting = False
                last_wait = None
            else:
                self._emit_tool_gate(
                    ts,
                    waiting=True,
                    toolcall=tc,
                    thread_id=thread_id,
                    sha1_hex=sha1_hex,
                    dedupe=dedupe,
                    ingest=ingest,
                    synthetic=True,
                )
                wait_observed_at = time.monotonic()
                wait_ts = ts
                wait_toolcall = tc
                wait_emitted = True

        self._last_toolcall = last_toolcall
        self._gate_waiting = gate_waiting
        self._wait_observed_at = float(wait_observed_at or 0.0)
        self._wait_ts = str(wait_ts or "")
        self._wait_toolcall = wait_toolcall
        self._wait_emitted = bool(wait_emitted)

    @staticmethod
    def _split_ts(line: str) -> Tuple[str, str]:
        """
        codex-tui.log format (after stripping ANSI):
          2026-01-14T12:34:56.123Z  INFO waiting for tool gate
        """
        return _split_ts_impl(line)

    @staticmethod
    def _parse_toolcall(msg: str) -> Optional[Dict[str, object]]:
        return _parse_toolcall_impl(msg)

    @staticmethod
    def _ts_age_s(ts: str) -> Optional[float]:
        return _ts_age_s_impl(ts)

    @staticmethod
    def _map_tool_name(tool: str) -> str:
        return _map_tool_name_impl(tool)

    @staticmethod
    def _redact_secrets(s: str) -> str:
        return _redact_secrets_impl(s)

    def _format_tool_gate_md(self, waiting: bool, toolcall: Optional[Dict[str, object]], *, synthetic: bool) -> str:
        return _format_tool_gate_md_impl(waiting=waiting, toolcall=toolcall, synthetic=synthetic)

    def _emit_tool_gate(
        self,
        ts: str,
        *,
        waiting: bool,
        toolcall: Optional[Dict[str, object]],
        thread_id: str,
        sha1_hex: Callable[[str], str],
        dedupe: Callable[[str, str], bool],
        ingest: Callable[[Dict[str, Any]], bool],
        synthetic: bool = False,
    ) -> None:
        if not ts:
            try:
                ts = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
            except Exception:
                ts = ""
        text = self._format_tool_gate_md(waiting=waiting, toolcall=toolcall, synthetic=synthetic)
        # Synthetic init scan: avoid spamming a "released" event, only show if waiting.
        if synthetic and not waiting:
            return

        file_path = str(self._path)
        try:
            hid = sha1_hex(f"{file_path}:tool_gate:{ts}:{text}")
        except Exception:
            hid = sha1_hex(f"{file_path}:tool_gate::{text}")
        if dedupe(hid, "tool_gate"):
            return
        msg = {
            "id": hid[:16],
            "ts": ts,
            "kind": "tool_gate",
            "text": text,
            "zh": "",
            "thread_id": str(thread_id or ""),
            "file": file_path,
            "line": 0,
        }
        try:
            ingest(msg)
        except Exception:
            return

    def _maybe_emit_delayed_wait(
        self,
        *,
        thread_id: str,
        sha1_hex: Callable[[str], str],
        dedupe: Callable[[str, str], bool],
        ingest: Callable[[Dict[str, Any]], bool],
    ) -> None:
        if not bool(self._gate_waiting):
            return
        if bool(self._wait_emitted):
            return
        started = float(self._wait_observed_at or 0.0)
        if started <= 0.0:
            return
        try:
            now = time.monotonic()
        except Exception:
            return
        if (now - started) < float(_WAIT_NOTIFY_DELAY_S):
            return
        self._wait_emitted = True
        ts = str(self._wait_ts or "")
        tc = self._wait_toolcall
        self._emit_tool_gate(
            ts,
            waiting=True,
            toolcall=tc,
            thread_id=thread_id,
            sha1_hex=sha1_hex,
            dedupe=dedupe,
            ingest=ingest,
        )
