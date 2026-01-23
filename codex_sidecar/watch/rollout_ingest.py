import hashlib
import json
import re
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from .rollout_extract import extract_rollout_items
from .tui_gate_helpers import redact_secrets, ts_age_s


def sha1_hex(s: str) -> str:
    return hashlib.sha1(str(s or "").encode("utf-8", errors="replace")).hexdigest()


_APPROVAL_WAIT_NOTIFY_DELAY_S = 1.25
_APPROVAL_RUNTIME_CUSHION_S = 0.9
_APPROVAL_RUNTIME_MAX_S = 600.0

_WALL_TIME_RE = re.compile(r"^Wall time:\s*([0-9]+(?:\.[0-9]+)?)\s*seconds\b", re.IGNORECASE)


def _iso_now() -> str:
    try:
        return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    except Exception:
        return ""


def _parse_call_id(text: str) -> str:
    lines = [ln for ln in str(text or "").splitlines() if ln is not None]
    if len(lines) >= 2 and str(lines[1] or "").startswith("call_id="):
        return str(lines[1]).split("=", 1)[1].strip()
    return ""


def _parse_tool_args(text: str) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    Parse rollout_extractor tool_call text.

    Format:
      title\\ncall_id=...\\n{json args}
    or:
      title\\n{json args}
    """
    lines = [ln for ln in str(text or "").splitlines() if ln is not None]
    title = (lines[0].strip() if lines else "") or "tool_call"
    args_raw = ""
    if len(lines) >= 2 and str(lines[1] or "").startswith("call_id="):
        args_raw = "\n".join(lines[2:]).strip()
    else:
        args_raw = "\n".join(lines[1:]).strip()
    if not (args_raw.startswith("{") and args_raw.endswith("}")):
        return (title, None)
    try:
        obj = json.loads(args_raw)
    except Exception:
        return (title, None)
    return (title, obj if isinstance(obj, dict) else None)


def _needs_terminal_approval(args: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(args, dict):
        return False
    sp = args.get("sandbox_permissions")
    if isinstance(sp, str) and sp.strip() == "require_escalated":
        return True
    if args.get("with_escalated_permissions") is True:
        return True
    return False


def _extract_gate_context(args: Optional[Dict[str, Any]]) -> Tuple[str, str]:
    just = ""
    cmd = ""
    if isinstance(args, dict):
        j = args.get("justification")
        if isinstance(j, str) and j.strip():
            just = redact_secrets(j.strip())
        c = args.get("command")
        if isinstance(c, str):
            cmd = c.strip()
        elif isinstance(c, list):
            try:
                cmd = " ".join(str(x) for x in c if x is not None).strip()
            except Exception:
                cmd = ""
    return (just, redact_secrets(cmd) if cmd else "")


def _classify_tool_output_result(tool_output_text: str) -> Tuple[str, Optional[int]]:
    s = str(tool_output_text or "")
    sl = s.lower()
    # Terminal approval outcomes (best-effort):
    # - "exec command rejected by user" means user denied at the gate.
    # - "aborted by user" means user cancelled the call (often while waiting).
    if "rejected by user" in sl:
        return ("rejected", None)
    if "aborted by user" in sl:
        return ("aborted", None)

    exit_code = None
    try:
        for ln in s.splitlines():
            if ln.startswith("Exit code:"):
                tail = ln.split(":", 1)[1].strip()
                try:
                    exit_code = int(tail)
                except Exception:
                    exit_code = None
                break
    except Exception:
        exit_code = None

    if exit_code is not None:
        return ("executed", exit_code)
    return ("released", None)


def _parse_wall_time_s(tool_output_text: str) -> Optional[float]:
    try:
        for ln in str(tool_output_text or "").splitlines():
            m = _WALL_TIME_RE.match(str(ln or "").strip())
            if not m:
                continue
            try:
                v = float(m.group(1))
            except Exception:
                v = None
            if v is None:
                return None
            if v < 0:
                return None
            return float(v)
    except Exception:
        return None
    return None


def _format_approval_gate_md(*, waiting: bool, tool: str, args: Optional[Dict[str, Any]], result: str) -> str:
    icon = "⏸️" if waiting else "▶️"
    title = "终端等待确认（tool gate）" if waiting else "终端已结束等待（tool gate released）"
    lines = [f"{icon} {title}"]

    tool_s = str(tool or "").strip() or "tool"
    lines.append("")
    lines.append(f"- 工具：`{tool_s}`")

    just, cmd = _extract_gate_context(args)
    if just:
        lines.append(f"- 理由：{just}")
    if cmd:
        # Avoid dumping huge scripts in a toast-like message; tool_call already contains full args.
        if len(cmd) <= 240:
            lines.append("")
            lines.append("```")
            lines.append(cmd)
            lines.append("```")
        else:
            lines.append(f"- 命令：{cmd[:200]}…（已截断）")

    if waiting:
        lines.append("")
        lines.append("请回到终端完成确认/授权后继续。")
        lines.append("（提示条会贴在对应会话标签页上方。）")
    else:
        rr = str(result or "").strip().lower()
        if rr == "rejected":
            lines.append("")
            lines.append("结果：已在终端拒绝该操作。")
        elif rr == "aborted":
            lines.append("")
            lines.append("结果：已在终端取消该操作。")
    return "\n".join(lines).strip()


class _ApprovalGateTracker:
    def __init__(
        self,
        *,
        dedupe: Callable[[str, str], bool],
        emit_ingest: Callable[[Dict[str, Any]], bool],
    ) -> None:
        self._dedupe = dedupe
        self._emit_ingest = emit_ingest
        # call_id -> pending
        self._pending: Dict[str, Dict[str, Any]] = {}
        # cmd_key -> EMA of observed runtime (seconds). Used to avoid false "waiting"
        # notifications for long-running commands that are already approved.
        self._runtime_ema: Dict[str, float] = {}

    def on_tool_call(
        self,
        *,
        ts: str,
        thread_id: str,
        tool_call_text: str,
        is_replay: bool,
        file_path: Path,
    ) -> None:
        call_id = _parse_call_id(tool_call_text)
        if not call_id:
            return
        tool, args = _parse_tool_args(tool_call_text)
        if not _needs_terminal_approval(args):
            return
        if call_id in self._pending:
            return

        _, cmd = _extract_gate_context(args)
        cmd_key = sha1_hex(f"{tool}\n{cmd}")
        expected_runtime = self._runtime_ema.get(cmd_key)
        delay_s = float(_APPROVAL_WAIT_NOTIFY_DELAY_S)
        if isinstance(expected_runtime, (int, float)) and expected_runtime >= 0:
            # Heuristic: if we have seen this exact command run before, only declare
            # "blocked waiting for terminal approval" after we exceed its expected
            # runtime (+ cushion). This avoids false positives when approval is
            # auto-granted but the command itself takes time.
            delay_s = max(delay_s, float(expected_runtime) + float(_APPROVAL_RUNTIME_CUSHION_S))

        self._pending[call_id] = {
            "ts": str(ts or ""),
            "thread_id": str(thread_id or ""),
            "tool": str(tool or ""),
            "args": args if isinstance(args, dict) else None,
            "file": str(file_path),
            "seen_mono": float(time.monotonic()),
            "wait_emitted": False,
            "replay": bool(is_replay),
            "cmd_key": str(cmd_key or ""),
            "delay_s": float(delay_s),
        }

    def on_tool_output(self, *, ts: str, tool_output_text: str, is_replay: bool) -> None:
        lines = [ln for ln in str(tool_output_text or "").splitlines() if ln is not None]
        if not lines:
            return
        head = str(lines[0] or "").strip()
        if not head.startswith("call_id="):
            return
        call_id = head.split("=", 1)[1].strip()
        if not call_id:
            return
        pending = self._pending.get(call_id)
        if not pending:
            return
        result, exit_code = _classify_tool_output_result(tool_output_text)
        # Learn typical runtime for this command so future auto-approved runs won't
        # be misclassified as "waiting" purely due to being long-running.
        try:
            if result == "executed":
                wt = _parse_wall_time_s(tool_output_text)
                if isinstance(wt, (int, float)) and 0 <= float(wt) <= float(_APPROVAL_RUNTIME_MAX_S):
                    ck = str(pending.get("cmd_key") or "").strip()
                    if ck:
                        old = self._runtime_ema.get(ck)
                        if isinstance(old, (int, float)) and old >= 0:
                            # EMA: bias towards new samples, but keep some stability.
                            alpha = 0.35
                            self._runtime_ema[ck] = float(alpha * float(wt) + (1.0 - alpha) * float(old))
                        else:
                            self._runtime_ema[ck] = float(wt)
        except Exception:
            pass
        if bool(pending.get("wait_emitted")):
            self._emit_gate(
                call_id,
                waiting=False,
                ts=str(ts or ""),
                replay=bool(is_replay),
                result=result,
                exit_code=exit_code,
            )
        try:
            self._pending.pop(call_id, None)
        except Exception:
            pass

    def poll(self) -> None:
        if not self._pending:
            return
        now_mono = float(time.monotonic())
        # Avoid mutating while iterating.
        for call_id, p in list(self._pending.items()):
            if not isinstance(p, dict):
                continue
            if bool(p.get("wait_emitted")):
                continue

            seen = float(p.get("seen_mono") or 0.0)
            elapsed = max(0.0, now_mono - seen) if seen > 0.0 else 0.0
            # If we have a parseable ISO timestamp, prefer it so a "already waiting"
            # approval is notified immediately after sidecar starts.
            try:
                age = ts_age_s(str(p.get("ts") or ""))
            except Exception:
                age = None
            if isinstance(age, (int, float)) and age >= 0:
                try:
                    elapsed = max(elapsed, float(age))
                except Exception:
                    pass

            delay_s = float(p.get("delay_s") or _APPROVAL_WAIT_NOTIFY_DELAY_S)
            if elapsed < delay_s:
                continue
            try:
                p["wait_emitted"] = True
            except Exception:
                pass
            self._emit_gate(call_id, waiting=True, ts=_iso_now(), replay=bool(p.get("replay")), result="waiting", exit_code=None)

    def _emit_gate(
        self,
        call_id: str,
        *,
        waiting: bool,
        ts: str,
        replay: bool,
        result: str,
        exit_code: Optional[int],
    ) -> None:
        pending = self._pending.get(call_id) or {}
        tool = str(pending.get("tool") or "")
        args = pending.get("args") if isinstance(pending.get("args"), dict) else None
        thread_id = str(pending.get("thread_id") or "")
        file_path = str(pending.get("file") or "")

        text = _format_approval_gate_md(waiting=waiting, tool=tool, args=args, result=str(result or ""))
        hid = sha1_hex(f"{file_path}:tool_gate:approval:{call_id}:{'wait' if waiting else 'released'}")
        if self._dedupe(hid, kind="tool_gate"):
            return
        just, cmd = _extract_gate_context(args)
        msg = {
            "id": hid[:16],
            "ts": str(ts or ""),
            "kind": "tool_gate",
            "text": text,
            "zh": "",
            "replay": bool(replay),
            "gate_id": str(call_id or ""),
            "gate_status": ("waiting" if waiting else "released"),
            "gate_source": "rollout",
            "gate_result": str(result or ""),
            "gate_exit_code": (int(exit_code) if isinstance(exit_code, int) else None),
            "gate_tool": str(tool or ""),
            "gate_justification": str(just or ""),
            "gate_command": str(cmd or ""),
            "thread_id": str(thread_id or ""),
            "file": file_path,
            "line": 0,
        }
        try:
            self._emit_ingest(msg)
        except Exception:
            return


class RolloutLineIngestor:
    """
    将 rollout JSONL 的单行解析为 UI 消息并推送。

    目标：把“解析/去重/翻译入队”等逻辑从 watcher 主循环中拆出来，
    使 watcher 只负责“选文件 + tail + 调度”。
    """

    def __init__(
        self,
        *,
        stop_requested: Callable[[], bool],
        dedupe: Callable[[str, str], bool],
        emit_ingest: Callable[[Dict[str, Any]], bool],
        translate_enqueue: Callable[..., bool],
    ) -> None:
        self._stop_requested = stop_requested
        self._dedupe = dedupe
        self._emit_ingest = emit_ingest
        self._translate_enqueue = translate_enqueue
        self._approval = _ApprovalGateTracker(dedupe=dedupe, emit_ingest=emit_ingest)

    def poll_tool_gates(self) -> None:
        """
        Called from watcher loop even when rollout JSONL doesn't grow.
        """
        if self._stop_requested():
            return
        try:
            self._approval.poll()
        except Exception:
            return

    def handle_line(
        self,
        bline: bytes,
        *,
        file_path: Path,
        line_no: int,
        is_replay: bool,
        thread_id: str,
        translate_mode: str,
    ) -> int:
        if self._stop_requested():
            return 0
        if not bline:
            return 0

        obj = None
        try:
            obj = json.loads(bline.decode("utf-8", errors="replace"))
        except Exception:
            obj = None
        if not isinstance(obj, dict):
            return 0

        ts, extracted = extract_rollout_items(obj)
        ingested = 0

        for item in extracted:
            if self._stop_requested():
                return ingested
            kind = str(item.get("kind", "") or "")
            text = str(item.get("text", "") or "")
            hid = sha1_hex(f"{file_path}:{kind}:{ts}:{text}")
            if self._dedupe(hid, kind=kind):
                continue

            # Track terminal-approval gates: rollout may stop growing while waiting,
            # so we must infer "blocked" via call_id + timeouts and emit tool_gate
            # from the watcher loop (poll_tool_gates).
            try:
                if kind == "tool_call" and text.strip():
                    self._approval.on_tool_call(
                        ts=str(ts or ""),
                        thread_id=str(thread_id or ""),
                        tool_call_text=text,
                        is_replay=bool(is_replay),
                        file_path=file_path,
                    )
                elif kind == "tool_output" and text.strip():
                    self._approval.on_tool_output(ts=str(ts or ""), tool_output_text=text, is_replay=bool(is_replay))
            except Exception:
                pass

            mid = hid[:16]
            msg = {
                "id": mid,
                "ts": ts,
                "kind": kind,
                "text": text,
                "zh": "",
                "replay": bool(is_replay),
                "thread_id": str(thread_id or ""),
                "file": str(file_path),
                "line": int(line_no),
            }
            if self._emit_ingest(msg):
                ingested += 1

                # 翻译走后台支路：
                # - auto：只自动翻译 reasoning_summary
                # - 回放阶段可聚合，实时阶段按单条慢慢补齐。
                if kind == "reasoning_summary" and translate_mode == "auto" and text.strip():
                    thread_key = str(thread_id or "") or str(file_path)
                    try:
                        self._translate_enqueue(mid=mid, text=text, thread_key=thread_key, batchable=bool(is_replay))
                    except Exception:
                        pass

        return ingested
