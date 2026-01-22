import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from .config import SidecarConfig, load_config, save_config
from .control.config_patch import apply_config_patch
from .control.reveal_secret import reveal_secret as _reveal_secret
from .control.watcher_factory import build_rollout_watcher
from .control.translator_build import build_translator as _build_translator_impl
from .control.translate_api import translate_items as _translate_items, translate_probe as _translate_probe, translate_text as _translate_text
from .control.retranslate_api import retranslate_one as _retranslate_one
from .control.translator_specs import TRANSLATORS
from .control.watcher_hot_updates import apply_watcher_hot_updates as _apply_watcher_hot_updates
from .translator import Translator
from .watcher import HttpIngestClient, RolloutWatcher
from .watch.follow_control_helpers import clean_exclude_keys as _clean_exclude_keys


class SidecarController:
    def __init__(self, config_home: Path, server_url: str, state) -> None:
        self._config_home = config_home
        self._server_url = server_url
        self._state = state

        self._lock = threading.Lock()
        self._cfg: SidecarConfig = load_config(config_home)

        self._thread: Optional[threading.Thread] = None
        self._stop_event: Optional[threading.Event] = None
        self._watcher: Optional[RolloutWatcher] = None
        self._process_stop_event: Optional[threading.Event] = None
        self._process_restart_event: Optional[threading.Event] = None
        self._last_error: str = ""
        # Stable identifier for the lifetime of this process instance.
        # Note: process restart may be in-place (execv, PID unchanged), so PID alone is not enough.
        self._boot_id: str = f"{os.getpid()}@{time.time():.6f}"
        self._started_at: float = 0.0
        # Follow selection (UI runtime state; NOT persisted to config.json).
        self._selection_mode: str = "auto"  # auto|pin
        self._pinned_thread_id: str = ""
        self._pinned_file: str = ""
        # Follow exclusions (UI runtime state; NOT persisted to config.json).
        # Used to implement “关闭监听”：被关闭的会话不应再被 watcher 轮询/读取。
        self._follow_exclude_keys: Set[str] = set()
        self._follow_exclude_files: Set[str] = set()

    def set_process_stop_event(self, stop_event: threading.Event) -> None:
        """
        Inject the main process stop_event so HTTP handlers can request a graceful exit.
        """
        with self._lock:
            self._process_stop_event = stop_event

    def set_process_restart_event(self, restart_event: threading.Event) -> None:
        """
        Inject a restart_event so HTTP handlers can request a full process restart.
        """
        with self._lock:
            self._process_restart_event = restart_event

    def translators(self) -> Dict[str, Any]:
        return {"translators": [t.__dict__ for t in TRANSLATORS]}

    def _translator_error(self, tr: Translator) -> str:
        err = ""
        try:
            err = str(getattr(tr, "last_error", "") or "").strip()
        except Exception:
            err = ""
        if err.startswith("WARN:"):
            err = err[len("WARN:") :].strip()
        return err

    def _translator_model(self, tr: Translator, provider_fallback: str) -> str:
        model = ""
        try:
            model = str(getattr(tr, "_resolved_model", "") or getattr(tr, "model", "") or "").strip()
        except Exception:
            model = ""
        if not model:
            model = str(provider_fallback or "").strip()
        return model

    def _build_translator(self, cfg: SidecarConfig) -> Optional[Translator]:
        try:
            # Late-bind build_translator via the public controller module so tests/tools
            # can patch `codex_sidecar.controller.build_translator` without reaching into
            # this internal module.
            from . import controller as _controller_mod  # local import avoids import-time cycles

            fn = getattr(_controller_mod, "build_translator", None)
            if callable(fn):
                return fn(cfg)
        except Exception:
            pass
        try:
            return _build_translator_impl(cfg)
        except Exception:
            return None

    def translate_probe(self) -> Dict[str, Any]:
        with self._lock:
            cfg = self._cfg
        return _translate_probe(
            cfg=cfg,
            build_translator=self._build_translator,
            translator_error=self._translator_error,
            translator_model=self._translator_model,
        )

    def translate_text(self, text: str) -> Dict[str, Any]:
        with self._lock:
            cfg = self._cfg
        return _translate_text(
            cfg=cfg,
            build_translator=self._build_translator,
            translator_error=self._translator_error,
            translator_model=self._translator_model,
            text=text,
        )

    def translate_items(self, items: Any) -> Dict[str, Any]:
        with self._lock:
            cfg = self._cfg
        return _translate_items(
            cfg=cfg,
            build_translator=self._build_translator,
            translator_error=self._translator_error,
            translator_model=self._translator_model,
            items=items,
        )

    def get_config(self) -> Dict[str, Any]:
        with self._lock:
            return self._cfg.to_dict()

    def reveal_secret(self, provider: str, field: str, profile: str = "") -> Dict[str, Any]:
        with self._lock:
            cfg = self._cfg.to_dict()
        return _reveal_secret(cfg, provider, field, profile=str(profile or ""))

    def update_config(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        allow_empty = bool(patch.pop("__allow_empty_translator_config", False))
        return self._patch_config(patch, persist=True, allow_empty_translator_config=allow_empty)

    def apply_runtime_overrides(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        patch.pop("__allow_empty_translator_config", None)
        return self._patch_config(patch, persist=False, allow_empty_translator_config=True)

    def _patch_config(self, patch: Dict[str, Any], persist: bool, allow_empty_translator_config: bool) -> Dict[str, Any]:
        out_cfg: Dict[str, Any] = {}
        with self._lock:
            res = apply_config_patch(
                current_cfg=self._cfg,
                config_home=self._config_home,
                patch=patch,
                allow_empty_translator_config=allow_empty_translator_config,
            )
            prev_tm = res.prev_translate_mode
            prev_provider = res.prev_provider
            touched_translator = bool(res.touched_translator)
            self._cfg = res.cfg
            if persist:
                save_config(self._config_home, self._cfg)
            out_cfg = self._cfg.to_dict()

        try:
            self._apply_watcher_hot_updates(
                prev_tm=prev_tm, prev_provider=prev_provider, touched_translator=touched_translator
            )
        except Exception:
            pass
        return out_cfg

    def _apply_watcher_hot_updates(self, *, prev_tm: str, prev_provider: str, touched_translator: bool) -> None:
        watcher = None
        running = False
        cfg = None
        try:
            with self._lock:
                watcher = self._watcher
                running = bool(self._thread is not None and self._thread.is_alive())
                cfg = self._cfg
        except Exception:
            return
        _apply_watcher_hot_updates(
            watcher=watcher,
            running=running,
            cfg=cfg,
            prev_translate_mode=str(prev_tm or ""),
            prev_provider=str(prev_provider or ""),
            touched_translator=bool(touched_translator),
            build_translator=self._build_translator,
            build_translator_fallback=_build_translator_impl,
        )

    def clear_messages(self) -> None:
        try:
            self._state.clear()
        except Exception:
            return

    def retranslate(self, mid: str) -> Dict[str, Any]:
        """
        Force (re)translation for a single message id.
        Used by the UI "翻译/重译" button on thinking rows.
        """
        def _resolve() -> Tuple[Optional[RolloutWatcher], bool]:
            with self._lock:
                watcher = self._watcher
                running = bool(self._thread is not None and self._thread.is_alive())
            return watcher, running

        return _retranslate_one(
            mid,
            get_message=self._state.get_message,
            clear_error=lambda m: self._state.add({"op": "update", "id": m, "translate_error": ""}),
            resolve_watcher=_resolve,
        )

    def start(self) -> Dict[str, Any]:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return {"ok": True, "running": True}

            cfg = self._cfg
            self._last_error = ""
            self._started_at = time.time()

            stop_event = threading.Event()
            watcher = build_rollout_watcher(
                cfg=cfg,
                server_url=self._server_url,
                build_translator=self._build_translator,
                build_translator_fallback=_build_translator_impl,
                selection_mode=self._selection_mode,
                pinned_thread_id=self._pinned_thread_id,
                pinned_file=self._pinned_file,
                exclude_keys=set(self._follow_exclude_keys or set()),
                exclude_files=set(self._follow_exclude_files or set()),
            )
            self._stop_event = stop_event
            self._watcher = watcher

            t = threading.Thread(target=self._run_watcher, name="sidecar-watcher", daemon=True)
            self._thread = t
            t.start()

        return {"ok": True, "running": True}

    def set_follow(self, mode: str, thread_id: str = "", file: str = "") -> Dict[str, Any]:
        """
        Control which rollout file is followed.

        - auto: sidecar picks latest / process-based file
        - pin : lock to a specific thread_id / file (from UI sidebar selection)
        """
        m = str(mode or "").strip().lower()
        if m not in ("auto", "pin"):
            m = "auto"
        tid = str(thread_id or "").strip()
        fp = str(file or "").strip()
        watcher = None
        with self._lock:
            self._selection_mode = m
            self._pinned_thread_id = tid
            self._pinned_file = fp
            watcher = self._watcher
        if watcher is not None:
            try:
                watcher.set_follow(m, thread_id=tid, file=fp)
            except Exception:
                pass
        return {"ok": True, "mode": m, "thread_id": tid, "file": fp}

    def set_follow_excludes(self, keys: Optional[List[str]] = None, files: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Update watcher follow exclusions (UI “关闭监听” list).

        This is runtime state and intentionally not persisted to config.json.
        """
        raw_keys = keys if isinstance(keys, list) else []
        raw_files = files if isinstance(files, list) else []

        cleaned_keys = _clean_exclude_keys(raw_keys, max_items=1000, max_len=256)
        cleaned_files = _clean_exclude_keys(raw_files, max_items=1000, max_len=2048)

        watcher = None
        running = False
        with self._lock:
            self._follow_exclude_keys = cleaned_keys
            self._follow_exclude_files = cleaned_files
            watcher = self._watcher
            running = bool(self._thread is not None and self._thread.is_alive())
        if watcher is not None and running:
            try:
                watcher.set_follow_excludes(keys=list(cleaned_keys), files=list(cleaned_files))
            except Exception:
                pass

        return {
            "ok": True,
            "exclude_keys": sorted(list(cleaned_keys)),
            "exclude_files": sorted(list(cleaned_files)),
        }

    def _run_watcher(self) -> None:
        try:
            watcher = None
            stop_event = None
            with self._lock:
                watcher = self._watcher
                stop_event = self._stop_event
            if watcher is None or stop_event is None:
                return
            watcher.run(stop_event=stop_event)
        except Exception as e:
            with self._lock:
                self._last_error = str(e)

    def stop(self) -> Dict[str, Any]:
        """
        Stop watcher thread.

        Important: do NOT clear thread references before it actually exits;
        otherwise callers may start a second watcher while the previous one is
        still alive (causing duplicate ingestion and extra translation requests).
        """
        with self._lock:
            t = self._thread
            ev = self._stop_event
        if ev is not None:
            ev.set()
        if t is not None and t.is_alive():
            # NOTE: translation may be blocked by network; rely on per-request timeout.
            t.join(timeout=2.0)
        still_running = bool(t is not None and t.is_alive())
        if not still_running:
            with self._lock:
                self._thread = None
                self._stop_event = None
                self._watcher = None
            return {"ok": True, "running": False}
        # Keep state so status() remains accurate and start() won't spawn duplicates.
        with self._lock:
            if not self._last_error:
                self._last_error = "stop_timeout"
        return {"ok": True, "running": True, "stop_timeout": True}

    def status(self) -> Dict[str, Any]:
        with self._lock:
            # Lazy cleanup: if a previous stop() timed out but the thread has since exited,
            # clear references so UI buttons/status don't get stuck in a confusing state.
            try:
                if self._thread is not None and (not self._thread.is_alive()):
                    self._thread = None
                    self._stop_event = None
                    self._watcher = None
                    if self._last_error == "stop_timeout":
                        self._last_error = ""
            except Exception:
                pass

            running = self._thread is not None and self._thread.is_alive()
            watcher = self._watcher
            last_error = self._last_error
            started_at = self._started_at
            cfg = self._cfg.to_dict()
            sel_mode = self._selection_mode
            pin_tid = self._pinned_thread_id
            pin_file = self._pinned_file

        ws = watcher.status() if watcher is not None else {}
        return {
            "ok": True,
            "pid": os.getpid(),
            "boot_id": self._boot_id,
            "running": running,
            "started_at": started_at,
            "last_error": last_error or ws.get("last_error") or "",
            "watcher": ws,
            "follow": {
                "mode": sel_mode,
                "thread_id": pin_tid,
                "file": pin_file,
            },
            "config": cfg,
        }

    def request_shutdown(self) -> Dict[str, Any]:
        """
        Stop the watcher (if running) and request the whole sidecar process to exit.
        """
        try:
            self.stop()
        except Exception:
            pass
        ev = None
        with self._lock:
            ev = self._process_stop_event
        if ev is not None:
            ev.set()
        return {"ok": True}

    def request_restart(self) -> Dict[str, Any]:
        """
        Stop the watcher (if running) and request the whole sidecar process to restart.
        """
        try:
            self.stop()
        except Exception:
            pass
        stop_ev = None
        restart_ev = None
        with self._lock:
            stop_ev = self._process_stop_event
            restart_ev = self._process_restart_event
        if restart_ev is not None:
            restart_ev.set()
        if stop_ev is not None:
            stop_ev.set()
        return {"ok": True}
