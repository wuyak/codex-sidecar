import threading
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set

from ..translator import Translator

from .ingest_client import HttpIngestClient
from .rollout_paths import (
    _ROLLOUT_RE,
    _find_rollout_file_for_thread,
    _latest_rollout_files,
    _parse_thread_id_from_filename,
)
from .translation_pump import TranslationPump
from .follow_picker import FollowPicker
from .tail_lines import read_tail_lines
from .tui_gate import TuiGateTailer
from .dedupe_cache import DedupeCache
from .rollout_ingest import RolloutLineIngestor, sha1_hex
from .rollout_tailer import poll_one, replay_tail
from .rollout_follow_state import apply_follow_targets, now_ts
from .follow_control_helpers import clean_exclude_files, clean_exclude_keys, resolve_pinned_rollout_file
from .rollout_follow_sync import FollowControls, build_follow_sync_plan
from .rollout_watcher_loop import decide_follow_sync_force, should_poll_tui
from .rollout_watcher_status import build_watcher_status

@dataclass
class _FileCursor:
    path: Path
    thread_id: str
    offset: int = 0
    line_no: int = 0
    active: bool = False
    last_active_ts: float = 0.0
    inited: bool = False

class RolloutWatcher:
    def __init__(
        self,
        codex_home: Path,
        ingest: HttpIngestClient,
        translator: Translator,
        replay_last_lines: int,
        watch_max_sessions: int,
        translate_mode: str,
        poll_interval_s: float,
        file_scan_interval_s: float,
        follow_codex_process: bool = False,
        codex_process_regex: str = "codex",
        only_follow_when_process: bool = True,
    ) -> None:
        self._codex_home = codex_home
        self._ingest = ingest
        self._translator = translator
        self._replay_last_lines = max(0, int(replay_last_lines))
        self._watch_max_sessions = max(1, int(watch_max_sessions or 3))
        tm = str(translate_mode or "auto").strip().lower()
        self._translate_mode = tm if tm in ("auto", "manual") else "auto"
        self._poll_interval_s = max(0.05, float(poll_interval_s))
        self._file_scan_interval_s = max(0.2, float(file_scan_interval_s))
        self._follow_picker = FollowPicker(
            codex_home=self._codex_home,
            follow_codex_process=bool(follow_codex_process),
            codex_process_regex=str(codex_process_regex or "codex"),
            only_follow_when_process=bool(only_follow_when_process),
        )

        # Follow targets (multi-session).
        self._cursors: Dict[Path, _FileCursor] = {}
        self._follow_files: List[Path] = []
        # User-controlled exclusions (UI “关闭监听”): exclude by thread_id and/or file path.
        # Stored as sets and applied when computing follow targets.
        self._exclude_keys: Set[str] = set()
        self._exclude_files: Set[Path] = set()

        self._current_file: Optional[Path] = None
        self._offset: int = 0
        self._line_no: int = 0
        self._thread_id: Optional[str] = None
        self._dedupe = DedupeCache(max_size=5000)
        self._last_file_scan_ts = 0.0
        self._warned_missing = False
        self._last_error: str = ""
        self._follow_mode: str = "legacy"  # legacy|process|fallback|idle
        self._codex_detected: bool = False
        self._codex_pids: List[int] = []
        self._codex_candidate_pids: List[int] = []
        self._process_file: Optional[Path] = None
        self._process_files: List[Path] = []

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
        self._tui = TuiGateTailer(self._codex_home / "log" / "codex-tui.log")
        self._stop_event: Optional[threading.Event] = None
        self._last_tui_poll_ts: float = 0.0

        # Translation is decoupled from ingestion: watcher ingests EN first,
        # then a background worker translates and patches via op=update.
        self._translate = TranslationPump(
            translator=self._translator,
            emit_update=self._ingest.ingest,
            batch_size=5,
        )
        self._line_ingestor = RolloutLineIngestor(
            stop_requested=self._stop_requested,
            dedupe=self._dedupe,
            emit_ingest=self._ingest.ingest,
            translate_enqueue=self._translate.enqueue,
        )

    def _on_rollout_line(self, bline: bytes, *, file_path: Path, line_no: int, is_replay: bool, thread_id: str) -> int:
        try:
            return self._line_ingestor.handle_line(
                bline,
                file_path=file_path,
                line_no=int(line_no),
                is_replay=bool(is_replay),
                thread_id=str(thread_id or ""),
                translate_mode=str(self._translate_mode or "auto"),
            )
        except Exception:
            return 0

    def retranslate(self, mid: str, text: str, thread_key: str, fallback_zh: str = "") -> bool:
        """
        Force (re)translation for a single message id.
        Called from the HTTP control plane when user clicks "重译" in the UI.
        """
        if self._stop_requested():
            return False
        try:
            if self._translate is None:
                return False
            queued = self._translate.enqueue(
                mid=str(mid or "").strip(),
                text=str(text or ""),
                thread_key=str(thread_key or ""),
                batchable=False,
                force=True,
                fallback_zh=str(fallback_zh or ""),
            )
            return bool(queued)
        except Exception:
            return False

    def _stop_requested(self) -> bool:
        ev = self._stop_event
        if ev is None:
            return False
        try:
            return ev.is_set()
        except Exception:
            return False

    def status(self) -> Dict[str, object]:
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
        primary_offset = self._offset
        primary_line_no = self._line_no
        try:
            if self._current_file is not None:
                cur = self._cursors.get(self._current_file)
                if cur is not None:
                    primary_offset = int(cur.offset)
                    primary_line_no = int(cur.line_no)
        except Exception:
            primary_offset = self._offset
            primary_line_no = self._line_no
        translate_stats = None
        try:
            if self._translate is not None:
                translate_stats = self._translate.stats()
        except Exception:
            pass
        return build_watcher_status(
            current_file=self._current_file,
            thread_id=str(self._thread_id or ""),
            offset=int(primary_offset or 0),
            line_no=int(primary_line_no or 0),
            last_error=str(self._last_error or ""),
            follow_mode=str(self._follow_mode or ""),
            selection_mode=str(sel or "auto"),
            pinned_thread_id=str(pin_tid or ""),
            pinned_file=str(pin_file or ""),
            watch_max_sessions=int(self._watch_max_sessions or 0),
            replay_last_lines=int(self._replay_last_lines or 0),
            poll_interval_s=float(self._poll_interval_s or 0.0),
            file_scan_interval_s=float(self._file_scan_interval_s or 0.0),
            follow_files=list(self._follow_files or []),
            codex_detected=bool(self._codex_detected),
            codex_pids=list(self._codex_pids or []),
            codex_candidate_pids=list(self._codex_candidate_pids or []),
            codex_process_regex=str(self._follow_picker.codex_process_regex or ""),
            process_file=self._process_file,
            process_files=list(self._process_files or []),
            translate_stats=translate_stats if isinstance(translate_stats, dict) else None,
        )

    def set_translate_mode(self, mode: str) -> None:
        """
        运行时切换 translate_mode（auto/manual）。
        """
        tm = str(mode or "auto").strip().lower()
        if tm not in ("auto", "manual"):
            return
        self._translate_mode = tm

    def set_translator(self, translator: Translator) -> None:
        """
        运行时热加载翻译器配置（无需重启 watcher 线程）。
        """
        self._translator = translator
        try:
            if self._translate is not None:
                self._translate.set_translator(translator)
        except Exception:
            pass

    def set_watch_max_sessions(self, n: int) -> None:
        """
        运行时调整并行会话数量（tail 最近 N 个会话文件）。
        """
        try:
            nn = max(1, int(n or 1))
        except Exception:
            nn = 1
        self._watch_max_sessions = nn
        try:
            with self._follow_lock:
                self._follow_dirty = True
        except Exception:
            pass

    def set_replay_last_lines(self, n: int) -> None:
        """
        运行时调整启动/新文件初始化时的回放行数（仅影响后续新发现的会话文件）。
        """
        try:
            nn = max(0, int(n or 0))
        except Exception:
            nn = 0
        self._replay_last_lines = nn

    def set_poll_interval_s(self, seconds: float) -> None:
        """
        运行时调整轮询间隔（越小越实时，但 CPU/IO 更高）。
        """
        try:
            s = float(seconds)
        except Exception:
            s = 0.5
        self._poll_interval_s = max(0.05, s)

    def set_file_scan_interval_s(self, seconds: float) -> None:
        """
        运行时调整扫描间隔（影响发现新会话/进程定位切换的速度）。
        """
        try:
            s = float(seconds)
        except Exception:
            s = 2.0
        self._file_scan_interval_s = max(0.2, s)

    def set_follow_picker_config(self, *, follow_codex_process: bool, codex_process_regex: str, only_follow_when_process: bool) -> None:
        """
        运行时更新“进程定位/仅跟随进程/regex”配置。

        注意：仅影响后续的跟随选择；会触发一次立即重选/重扫。
        """
        try:
            self._follow_picker = FollowPicker(
                codex_home=self._codex_home,
                follow_codex_process=bool(follow_codex_process),
                codex_process_regex=str(codex_process_regex or "codex"),
                only_follow_when_process=bool(only_follow_when_process),
            )
        except Exception:
            return
        try:
            with self._follow_lock:
                self._follow_dirty = True
        except Exception:
            pass

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

        pinned_file = resolve_pinned_rollout_file(
            self._codex_home,
            file_path=fp,
            thread_id=tid,
            find_rollout_file_for_thread=_find_rollout_file_for_thread,
            rollout_re=_ROLLOUT_RE,
        )

        with self._follow_lock:
            self._selection_mode = m
            if m == "pin":
                self._pinned_thread_id = tid
                self._pinned_file = pinned_file
            else:
                self._pinned_thread_id = ""
                self._pinned_file = None
            self._follow_dirty = True

    def set_follow_excludes(self, keys: Optional[List[str]] = None, files: Optional[List[str]] = None) -> None:
        """
        Update the exclusion set for follow targets at runtime.

        This powers the UI “关闭监听”：被关闭的会话不应再被 watcher 轮询/读取，也不应触发提示音。

        - keys: thread keys (usually rollout thread_id uuid)
        - files: absolute or CODEX_HOME-relative rollout file paths (must be under sessions/**)
        """
        raw_keys = keys if isinstance(keys, list) else []
        raw_files = files if isinstance(files, list) else []

        cleaned_keys = clean_exclude_keys(raw_keys, max_items=1000, max_len=256)
        cleaned_files = clean_exclude_files(raw_files, codex_home=self._codex_home, rollout_re=_ROLLOUT_RE, max_items=1000)

        try:
            with self._follow_lock:
                self._exclude_keys = cleaned_keys
                self._exclude_files = cleaned_files
                self._follow_dirty = True
        except Exception:
            return

    def run(self, stop_event) -> None:
        # Keep a reference so inner loops can react quickly (e.g. stop in the middle of large file reads).
        self._stop_event = stop_event
        self._translate.start(stop_event)
        # Initial pick
        self._sync_follow_targets(force=True)
        if not self._follow_files and not self._warned_missing:
            if self._follow_mode in ("idle", "wait_codex", "wait_rollout"):
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
            force = decide_follow_sync_force(
                force_switch=force_switch,
                now_ts=float(now),
                last_scan_ts=float(self._last_file_scan_ts or 0.0),
                file_scan_interval_s=float(self._file_scan_interval_s or 0.0),
            )
            if force is not None:
                self._sync_follow_targets(force=bool(force))
                self._last_file_scan_ts = now
            self._poll_follow_files()
            try:
                if should_poll_tui(
                    follow_mode=self._follow_mode,
                    codex_detected=bool(self._codex_detected),
                    now_ts=float(now),
                    last_poll_ts=float(self._last_tui_poll_ts or 0.0),
                    file_scan_interval_s=float(self._file_scan_interval_s or 0.0),
                ):
                    self._last_tui_poll_ts = now
                    self._tui.poll(
                        thread_id=self._thread_id or "",
                        read_tail_lines=read_tail_lines,
                        sha1_hex=sha1_hex,
                        dedupe=self._dedupe,
                        ingest=self._ingest.ingest,
                    )
            except Exception:
                pass
            stop_event.wait(self._poll_interval_s)


    def _sync_follow_targets(self, force: bool) -> None:
        """
        Keep a stable set of followed session files.

        - auto: follow primary picked by FollowPicker + fill to N latest session files.
        - pin : primary pinned file, but still keep monitoring other latest sessions up to N
                (so new threads appear without requiring a manual "全部" refresh).
        """
        try:
            with self._follow_lock:
                sel = str(self._selection_mode or "auto").strip().lower()
                pin_tid = str(self._pinned_thread_id or "").strip()
                pin_file = self._pinned_file
                excl_keys = set(self._exclude_keys or set())
                excl_files = set(self._exclude_files or set())
        except Exception:
            sel = "auto"
            pin_tid = ""
            pin_file = None
            excl_keys = set()
            excl_files = set()

        plan = build_follow_sync_plan(
            follow_picker=self._follow_picker,
            controls=FollowControls(
                selection_mode=sel,
                pinned_thread_id=pin_tid,
                pinned_file=pin_file,
                exclude_keys=excl_keys,
                exclude_files=excl_files,
                watch_max_sessions=int(self._watch_max_sessions or 1),
            ),
            codex_home=self._codex_home,
            latest_rollout_files=_latest_rollout_files,
            parse_thread_id=_parse_thread_id_from_filename,
        )

        picked = plan.picked
        self._process_file = plan.process_file
        self._process_files = list(plan.process_files or [])
        self._codex_candidate_pids = list(plan.candidate_pids or [])
        self._codex_detected = bool(plan.codex_detected)
        self._codex_pids = list(plan.codex_pids or [])
        self._follow_mode = str(plan.follow_mode or "")

        # If UI pins by thread id only, resolve to a concrete file path for later.
        if sel == "pin" and picked is not None:
            try:
                with self._follow_lock:
                    if self._pinned_file is None and plan.pinned_file is not None:
                        self._pinned_file = plan.pinned_file
                    if not self._pinned_thread_id and plan.pinned_thread_id:
                        self._pinned_thread_id = plan.pinned_thread_id
            except Exception:
                pass

        # When we are explicitly in "idle / wait_codex / wait_rollout" mode, do not follow any file.
        if plan.idle:
            if force or self._follow_files:
                self._follow_files = []
                self._current_file = None
                self._thread_id = None
                self._offset = 0
                self._line_no = 0
                for cur in self._cursors.values():
                    cur.active = False
            return

        targets = list(plan.targets or [])

        changed = force or (targets != self._follow_files)
        if not changed:
            return

        self._follow_files = targets
        now = now_ts()
        cur_file, thread_id, primary_offset, primary_line_no = apply_follow_targets(
            targets=targets,
            cursors=self._cursors,
            new_cursor=_FileCursor,
            now=now,
            replay_last_lines=self._replay_last_lines,
            read_tail_lines=read_tail_lines,
            replay_tail=replay_tail,
            stop_requested=self._stop_requested,
            on_line=self._on_rollout_line,
            parse_thread_id=_parse_thread_id_from_filename,
            prev_primary_offset=int(self._offset or 0),
            prev_primary_line_no=int(self._line_no or 0),
        )

        # Update "primary" fields for status and tool gate tagging.
        self._current_file = cur_file
        self._thread_id = thread_id
        self._offset = int(primary_offset or 0)
        self._line_no = int(primary_line_no or 0)

        try:
            if targets:
                joined = " | ".join(str(p) for p in targets[:6])
                print(f"[sidecar] follow_files={len(targets)} primary={targets[0]} | {joined}", file=sys.stderr)
        except Exception:
            pass

    def _poll_follow_files(self) -> None:
        for path in list(self._follow_files):
            if self._stop_requested():
                break
            cur = self._cursors.get(path)
            if cur is None or not cur.active:
                continue
            is_primary = bool(self._current_file == path)

            def _on_primary_progress(offset: int, line_no: int) -> None:
                if not is_primary:
                    return
                self._offset = int(offset)
                self._line_no = int(line_no)

            poll_one(
                cur,
                stop_requested=self._stop_requested,
                on_line=self._on_rollout_line,
                on_primary_progress=_on_primary_progress if is_primary else None,
                on_error=lambda: setattr(self, "_last_error", "poll_failed"),
            )
