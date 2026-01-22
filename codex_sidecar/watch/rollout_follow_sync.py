from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, List, Optional, Set

from .follow_targets import compute_follow_targets
from .follow_picker import FollowPicker


@dataclass(frozen=True)
class FollowControls:
    selection_mode: str
    pinned_thread_id: str
    pinned_file: Optional[Path]
    exclude_keys: Set[str]
    exclude_files: Set[Path]
    watch_max_sessions: int


@dataclass(frozen=True)
class FollowSyncPlan:
    picked: Optional[Path]
    follow_mode: str

    process_file: Optional[Path]
    process_files: List[Path]
    codex_detected: bool
    codex_pids: List[int]
    candidate_pids: List[int]

    pinned_thread_id: str
    pinned_file: Optional[Path]

    targets: List[Path]
    idle: bool


def build_follow_sync_plan(
    *,
    follow_picker: FollowPicker,
    controls: FollowControls,
    codex_home: Path,
    latest_rollout_files: Callable[[Path, int], List[Path]],
    parse_thread_id: Callable[[Path], str],
) -> FollowSyncPlan:
    """
    Build a follow plan for RolloutWatcher._sync_follow_targets.

    This function is intentionally side-effect free:
    - It does not mutate RolloutWatcher fields.
    - It does not touch cursors/offsets/ingestion; it only decides targets.
    """
    pick = follow_picker.pick(
        selection_mode=str(controls.selection_mode or "auto").strip().lower(),
        pinned_thread_id=str(controls.pinned_thread_id or "").strip(),
        pinned_file=controls.pinned_file,
    )
    picked = getattr(pick, "picked", None)
    follow_mode = str(getattr(pick, "follow_mode", "") or "")

    idle = picked is None and follow_mode in ("idle", "wait_codex", "wait_rollout")

    process_file = getattr(pick, "process_file", None)
    try:
        process_files = list(getattr(pick, "process_files", None) or [])
    except Exception:
        process_files = []
    codex_detected = bool(getattr(pick, "codex_detected", False))
    try:
        codex_pids = list(getattr(pick, "codex_pids", None) or [])
    except Exception:
        codex_pids = []
    try:
        candidate_pids = list(getattr(pick, "candidate_pids", None) or [])
    except Exception:
        candidate_pids = []

    pinned_file = controls.pinned_file
    pinned_thread_id = str(controls.pinned_thread_id or "").strip()
    if str(controls.selection_mode or "").strip().lower() == "pin" and picked is not None:
        try:
            if pinned_file is None:
                pinned_file = picked
            if not pinned_thread_id:
                tid = str(parse_thread_id(picked) or "").strip()
                if tid:
                    pinned_thread_id = tid
        except Exception:
            pass

    targets: List[Path] = []
    if not idle:
        targets = compute_follow_targets(
            selection_mode=str(controls.selection_mode or "auto").strip().lower(),
            watch_max_sessions=max(1, int(controls.watch_max_sessions or 1)),
            follow_mode=follow_mode,
            picked=picked,
            process_files=process_files,
            codex_home=codex_home,
            latest_rollout_files=latest_rollout_files,
            exclude_keys=set(controls.exclude_keys or set()),
            exclude_files=set(controls.exclude_files or set()),
            parse_thread_id=parse_thread_id,
        )

    return FollowSyncPlan(
        picked=picked,
        follow_mode=follow_mode,
        process_file=process_file,
        process_files=process_files,
        codex_detected=codex_detected,
        codex_pids=codex_pids,
        candidate_pids=candidate_pids,
        pinned_thread_id=pinned_thread_id,
        pinned_file=pinned_file,
        targets=targets,
        idle=idle,
    )

