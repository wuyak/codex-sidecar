import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from .config import SidecarConfig, find_recoverable_translator_snapshot, load_config, save_config
from .control.translator_build import build_translator, count_valid_http_profiles, select_http_profile
from .control.translator_specs import TRANSLATORS
from .watcher import HttpIngestClient, RolloutWatcher


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
        self._started_at: float = 0.0
        # Follow selection (UI runtime state; NOT persisted to config.json).
        self._selection_mode: str = "auto"  # auto|pin
        self._pinned_thread_id: str = ""
        self._pinned_file: str = ""

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

    def get_config(self) -> Dict[str, Any]:
        with self._lock:
            return self._cfg.to_dict()

    def recovery_info(self) -> Dict[str, Any]:
        """
        Return whether translator profiles are recoverable from local backups (without leaking secrets).
        """
        try:
            with self._lock:
                wh = Path(str(self._cfg.watch_codex_home or "")).expanduser()
            snap, source = find_recoverable_translator_snapshot(self._config_home, watch_codex_home=wh)
            return {"available": bool(snap), "source": source or ""}
        except Exception:
            return {"available": False, "source": ""}

    def update_config(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        allow_empty = bool(patch.pop("__allow_empty_translator_config", False))
        return self._patch_config(patch, persist=True, allow_empty_translator_config=allow_empty)

    def apply_runtime_overrides(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        patch.pop("__allow_empty_translator_config", None)
        return self._patch_config(patch, persist=False, allow_empty_translator_config=True)

    def recover_translator_config(self) -> Dict[str, Any]:
        """
        Recover translator config (HTTP profiles) from local backups (and legacy snapshots).
        """
        with self._lock:
            wh = Path(str(self._cfg.watch_codex_home or "")).expanduser()
        snap, source = find_recoverable_translator_snapshot(self._config_home, watch_codex_home=wh)
        if not snap:
            return {"ok": False, "error": "no_recovery_source"}

        with self._lock:
            cur = self._cfg.to_dict()
            provider = str(snap.get("translator_provider") or cur.get("translator_provider") or "http").strip() or "http"
            tc = snap.get("translator_config")
            if not isinstance(tc, dict):
                tc = {}
            cur["translator_provider"] = provider
            # Preserve other provider configs while restoring HTTP profiles.
            prev = cur.get("translator_config")
            merged = dict(prev) if isinstance(prev, dict) else {}
            merged["http"] = tc
            cur["translator_config"] = merged
            # config_home is immutable (controls where the config is stored)
            cur["config_home"] = str(self._config_home)
            self._cfg = SidecarConfig.from_dict(cur)
            save_config(self._config_home, self._cfg)
            return {"ok": True, "restored": True, "source": source, "config": self._cfg.to_dict()}

    def _patch_config(self, patch: Dict[str, Any], persist: bool, allow_empty_translator_config: bool) -> Dict[str, Any]:
        with self._lock:
            cur = self._cfg.to_dict()
            # merge shallow
            for k, v in patch.items():
                if k == "translator_config":
                    if isinstance(v, dict):
                        # One-level merge to preserve other provider configs (e.g. keep http profiles
                        # when saving openai config, and vice versa).
                        prev = cur.get(k)
                        if isinstance(prev, dict):
                            merged = dict(prev)
                            merged.update(v)
                            cur[k] = merged
                        else:
                            cur[k] = v
                    continue
                cur[k] = v
            # config_home is immutable (controls where the config is stored)
            cur["config_home"] = str(self._config_home)
            # Guard: avoid accidentally clearing HTTP profiles (user can recover or switch provider).
            try:
                provider = str(cur.get("translator_provider") or "stub").strip().lower()
                if provider == "http":
                    tc = cur.get("translator_config") or {}
                    if count_valid_http_profiles(tc) <= 0 and not allow_empty_translator_config:
                        raise ValueError("empty_http_profiles")
            except ValueError:
                raise
            except Exception:
                # On unexpected validation errors, do not block saving.
                pass

            self._cfg = SidecarConfig.from_dict(cur)
            if persist:
                save_config(self._config_home, self._cfg)
            return self._cfg.to_dict()

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
        m = str(mid or "").strip()
        if not m:
            return {"ok": False, "error": "missing_id"}

        try:
            msg = self._state.get_message(m)
        except Exception:
            msg = None
        if not isinstance(msg, dict):
            return {"ok": False, "error": "not_found"}

        kind = str(msg.get("kind") or "")
        if kind not in ("reasoning_summary", "agent_reasoning"):
            return {"ok": False, "error": "not_thinking"}

        text = str(msg.get("text") or "")
        if not text.strip():
            return {"ok": False, "error": "empty_text"}

        thread_id = str(msg.get("thread_id") or "")
        file_path = str(msg.get("file") or "")
        thread_key = thread_id or file_path or "unknown"

        watcher = None
        running = False
        with self._lock:
            watcher = self._watcher
            running = bool(self._thread is not None and self._thread.is_alive())
        if watcher is None or not running:
            return {"ok": False, "error": "not_running"}

        # Clear existing zh to make the UI show "ZH…" while re-translation is in-flight.
        try:
            self._state.add({"op": "update", "id": m, "zh": ""})
        except Exception:
            pass

        ok = False
        try:
            ok = bool(watcher.retranslate(m, text=text, thread_key=thread_key))
        except Exception:
            ok = False
        return {"ok": ok, "id": m, "queued": ok}

    def start(self) -> Dict[str, Any]:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return {"ok": True, "running": True}

            cfg = self._cfg
            self._last_error = ""
            self._started_at = time.time()

            stop_event = threading.Event()
            watcher = RolloutWatcher(
                codex_home=Path(cfg.watch_codex_home).expanduser(),
                ingest=HttpIngestClient(server_url=self._server_url),
                translator=build_translator(cfg),
                replay_last_lines=int(cfg.replay_last_lines),
                watch_max_sessions=int(getattr(cfg, "watch_max_sessions", 3) or 3),
                poll_interval_s=float(cfg.poll_interval),
                file_scan_interval_s=float(cfg.file_scan_interval),
                include_agent_reasoning=bool(cfg.include_agent_reasoning),
                follow_codex_process=bool(getattr(cfg, "follow_codex_process", False)),
                codex_process_regex=str(getattr(cfg, "codex_process_regex", "codex") or "codex"),
                only_follow_when_process=bool(getattr(cfg, "only_follow_when_process", True)),
            )
            try:
                watcher.set_follow(self._selection_mode, thread_id=self._pinned_thread_id, file=self._pinned_file)
            except Exception:
                pass
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
        env_hint = {}
        try:
            provider = str(cfg.get("translator_provider") or "")
            if provider in ("http", "openai"):
                auth_env = ""
                tc = cfg.get("translator_config") or {}
                if isinstance(tc, dict):
                    if provider == "http":
                        auth_env = str(select_http_profile(tc).get("auth_env") or "").strip()
                    else:
                        oc = tc.get("openai") if isinstance(tc.get("openai"), dict) else tc
                        auth_env = str((oc or {}).get("auth_env") or "").strip()
                if auth_env:
                    env_hint = {"auth_env": auth_env, "auth_env_set": bool(os.environ.get(auth_env))}
        except Exception:
            env_hint = {}
        return {
            "ok": True,
            "pid": os.getpid(),
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
            "env": env_hint,
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
