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
from .follow_targets import compute_follow_targets

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
        out: Dict[str, object] = {
            "current_file": str(self._current_file) if self._current_file is not None else "",
            "thread_id": self._thread_id or "",
            "offset": str(primary_offset),
            "line_no": str(primary_line_no),
            "last_error": self._last_error or "",
            "follow_mode": self._follow_mode or "",
            "selection_mode": sel,
            "pinned_thread_id": pin_tid,
            "pinned_file": pin_file,
            "watch_max_sessions": str(self._watch_max_sessions),
            "replay_last_lines": str(self._replay_last_lines),
            "poll_interval_s": str(self._poll_interval_s),
            "file_scan_interval_s": str(self._file_scan_interval_s),
            "follow_files": [str(p) for p in (self._follow_files or [])][:12],
            "codex_detected": "1" if self._codex_detected else "0",
            "codex_pids": ",".join(str(x) for x in self._codex_pids[:8]),
            "codex_candidate_pids": ",".join(str(x) for x in self._codex_candidate_pids[:8]),
            "codex_process_regex": self._follow_picker.codex_process_regex,
            "process_file": str(self._process_file) if self._process_file is not None else "",
            "process_files": [str(p) for p in (self._process_files or [])][:12],
        }
        try:
            if self._translate is not None:
                out["translate"] = self._translate.stats()
        except Exception:
            pass
        return out

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

    def set_follow_excludes(self, keys: Optional[List[str]] = None, files: Optional[List[str]] = None) -> None:
        """
        Update the exclusion set for follow targets at runtime.

        This powers the UI “关闭监听”：被关闭的会话不应再被 watcher 轮询/读取，也不应触发提示音。

        - keys: thread keys (usually rollout thread_id uuid)
        - files: absolute or CODEX_HOME-relative rollout file paths (must be under sessions/**)
        """
        raw_keys = keys if isinstance(keys, list) else []
        raw_files = files if isinstance(files, list) else []

        cleaned_keys: Set[str] = set()
        for x in raw_keys:
            try:
                s = str(x or "").strip()
            except Exception:
                s = ""
            if not s:
                continue
            # Keep it bounded to avoid untrusted UI inputs growing without limit.
            cleaned_keys.add(s[:256])
            if len(cleaned_keys) >= 1000:
                break

        cleaned_files: Set[Path] = set()
        sessions_root = (self._codex_home / "sessions").resolve()
        for x in raw_files:
            try:
                s = str(x or "").strip()
            except Exception:
                s = ""
            if not s:
                continue
            try:
                cand = Path(s).expanduser()
                if not cand.is_absolute():
                    cand = (self._codex_home / cand).resolve()
                else:
                    cand = cand.resolve()
                try:
                    _ = cand.relative_to(sessions_root)
                except Exception:
                    continue
                if cand.exists() and cand.is_file() and _ROLLOUT_RE.match(cand.name):
                    cleaned_files.add(cand)
            except Exception:
                continue
            if len(cleaned_files) >= 1000:
                break

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
            if force_switch:
                self._sync_follow_targets(force=True)
                self._last_file_scan_ts = now
            if now - self._last_file_scan_ts >= self._file_scan_interval_s:
                self._sync_follow_targets(force=False)
                self._last_file_scan_ts = now
            self._poll_follow_files()
            try:
                # When process-follow is enabled and no Codex process is detected, polling
                # the Codex TUI log at the normal "poll" cadence is mostly wasted work.
                # Throttle it to the scan cadence (still responsive enough, cheaper idle).
                do_tui = True
                if self._follow_mode in ("idle", "wait_codex") and (not self._codex_detected):
                    try:
                        last = float(self._last_tui_poll_ts or 0.0)
                    except Exception:
                        last = 0.0
                    if (now - last) < float(self._file_scan_interval_s or 0.0):
                        do_tui = False
                if do_tui:
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

        pick = self._follow_picker.pick(selection_mode=sel, pinned_thread_id=pin_tid, pinned_file=pin_file)
        picked = pick.picked
        self._process_file = pick.process_file
        try:
            self._process_files = list(pick.process_files or [])
        except Exception:
            self._process_files = []
        try:
            self._codex_candidate_pids = list(getattr(pick, "candidate_pids", None) or [])
        except Exception:
            self._codex_candidate_pids = []
        self._codex_detected = bool(pick.codex_detected)
        self._codex_pids = list(pick.codex_pids or [])
        self._follow_mode = str(pick.follow_mode or "")

        # If UI pins by thread id only, resolve to a concrete file path for later.
        if sel == "pin" and picked is not None:
            try:
                with self._follow_lock:
                    if self._pinned_file is None:
                        self._pinned_file = picked
                    if not self._pinned_thread_id:
                        tid = _parse_thread_id_from_filename(picked)
                        if tid:
                            self._pinned_thread_id = tid
            except Exception:
                pass

        # When we are explicitly in "idle / wait_codex / wait_rollout" mode, do not follow any file.
        if picked is None and self._follow_mode in ("idle", "wait_codex", "wait_rollout"):
            if force or self._follow_files:
                self._follow_files = []
                self._current_file = None
                self._thread_id = None
                self._offset = 0
                self._line_no = 0
                for cur in self._cursors.values():
                    cur.active = False
            return

        targets = compute_follow_targets(
            selection_mode=sel,
            watch_max_sessions=int(self._watch_max_sessions or 1),
            follow_mode=self._follow_mode,
            picked=picked,
            process_files=list(self._process_files or []),
            codex_home=self._codex_home,
            latest_rollout_files=_latest_rollout_files,
            exclude_keys=excl_keys,
            exclude_files=excl_files,
            parse_thread_id=_parse_thread_id_from_filename,
        )

        changed = force or (targets != self._follow_files)
        if not changed:
            return

        self._follow_files = targets

        keep = set(targets)
        now = time.time()
        for p, cur in list(self._cursors.items()):
            cur.active = p in keep
            if cur.active:
                cur.last_active_ts = now

        for p in targets:
            cur = self._cursors.get(p)
            if cur is None:
                tid = _parse_thread_id_from_filename(p) or ""
                cur = _FileCursor(path=p, thread_id=tid)
                self._cursors[p] = cur
            cur.active = True
            cur.last_active_ts = now
            if not cur.inited:
                cur.inited = True
                # Seek to end (follow only new writes), optionally replay last N lines.
                try:
                    cur.offset = int(p.stat().st_size)
                except Exception:
                    cur.offset = 0
                if self._replay_last_lines > 0:
                    replay_tail(
                        cur,
                        last_lines=self._replay_last_lines,
                        read_tail_lines=read_tail_lines,
                        stop_requested=self._stop_requested,
                        on_line=self._on_rollout_line,
                    )

        # Update "primary" fields for status and tool gate tagging.
        self._current_file = targets[0] if targets else None
        self._thread_id = _parse_thread_id_from_filename(targets[0]) if targets else None
        if self._current_file is not None:
            try:
                cur = self._cursors.get(self._current_file)
                if cur is not None:
                    self._offset = int(cur.offset)
                    self._line_no = int(cur.line_no)
            except Exception:
                pass

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
