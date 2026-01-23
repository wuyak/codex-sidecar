import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from codex_sidecar.watch.rollout_ingest import _ApprovalGateTracker


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


class _Emitter:
    def __init__(self) -> None:
        self.items = []

    def emit(self, msg) -> bool:
        self.items.append(msg)
        return True


def test_runtime_aware_delay_avoids_false_waiting_for_long_running_auto_approved_commands() -> None:
    """
    If a require_escalated command is auto-approved and simply takes time to run,
    the tracker should not emit a "waiting" gate purely due to runtime.
    """
    em = _Emitter()
    tr = _ApprovalGateTracker(dedupe=lambda _hid, kind: False, emit_ingest=em.emit)

    cmd = "bash -lc 'sleep 3; echo hi'"
    args = {"command": cmd, "sandbox_permissions": "require_escalated", "justification": "x"}

    # First run: record runtime (3s) for this exact command.
    call_id_1 = "call_1"
    tool_call_text_1 = "shell_command\ncall_id={}\n{}".format(call_id_1, json.dumps(args, ensure_ascii=False))
    tr.on_tool_call(
        ts=_iso(datetime.now(timezone.utc)),
        thread_id="t",
        tool_call_text=tool_call_text_1,
        is_replay=False,
        file_path=Path("/tmp/rollout.jsonl"),
    )
    tr.on_tool_output(
        ts=_iso(datetime.now(timezone.utc)),
        tool_output_text="call_id={}\nExit code: 0\nWall time: 3 seconds\nOutput:\nhi\n".format(call_id_1),
        is_replay=False,
    )

    # Second run: same command, but only ~2.3s have elapsed — under expected runtime + cushion.
    call_id_2 = "call_2"
    tool_call_text_2 = "shell_command\ncall_id={}\n{}".format(call_id_2, json.dumps(args, ensure_ascii=False))
    ts_2 = _iso(datetime.now(timezone.utc) - timedelta(seconds=2.3))
    tr.on_tool_call(
        ts=ts_2,
        thread_id="t",
        tool_call_text=tool_call_text_2,
        is_replay=False,
        file_path=Path("/tmp/rollout.jsonl"),
    )
    tr.poll()

    assert em.items == []


def test_default_delay_emits_waiting_when_output_is_missing() -> None:
    em = _Emitter()
    tr = _ApprovalGateTracker(dedupe=lambda _hid, kind: False, emit_ingest=em.emit)

    args = {"command": "echo hi", "sandbox_permissions": "require_escalated", "justification": "x"}
    call_id = "call_1"
    tool_call_text = "shell_command\ncall_id={}\n{}".format(call_id, json.dumps(args, ensure_ascii=False))
    ts = _iso(datetime.now(timezone.utc) - timedelta(seconds=2.3))
    tr.on_tool_call(
        ts=ts,
        thread_id="t",
        tool_call_text=tool_call_text,
        is_replay=False,
        file_path=Path("/tmp/rollout.jsonl"),
    )
    tr.poll()

    assert len(em.items) == 1
    assert em.items[0].get("kind") == "tool_gate"
    assert em.items[0].get("gate_status") == "waiting"

