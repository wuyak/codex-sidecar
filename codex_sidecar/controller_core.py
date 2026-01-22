import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from .config import SidecarConfig, load_config, save_config
from .control.watcher_factory import build_rollout_watcher
from .control.translator_build import build_translator as _build_translator_impl, count_valid_http_profiles, select_http_profile
from .control.translate_api import translate_items as _translate_items, translate_probe as _translate_probe, translate_text as _translate_text
from .control.translator_specs import TRANSLATORS
from .security import restore_masked_secrets_in_patch
from .translator import Translator
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
        """
        Reveal a single secret value for UI "显示/隐藏" controls.

        Notes:
        - `/api/config` always returns a redacted view, so UI must call this endpoint
          to show original values on demand.
        - This returns only the requested field (not the whole config).
        """
        p = str(provider or "").strip().lower()
        f = str(field or "").strip().lower()
        prof = str(profile or "").strip()
        with self._lock:
            cfg = self._cfg.to_dict()
        tc = cfg.get("translator_config")
        if not isinstance(tc, dict):
            tc = {}

        def _as_dict(x):
            return x if isinstance(x, dict) else {}

        if p == "openai":
            o = _as_dict(tc.get("openai") if isinstance(tc.get("openai"), dict) else tc)
            if f == "api_key":
                return {"ok": True, "provider": p, "field": f, "value": str(o.get("api_key") or "")}
            if f == "base_url":
                return {"ok": True, "provider": p, "field": f, "value": str(o.get("base_url") or "")}
            return {"ok": False, "error": "unknown_field"}

        if p == "nvidia":
            n = _as_dict(tc.get("nvidia") if isinstance(tc.get("nvidia"), dict) else tc)
            if f == "api_key":
                return {"ok": True, "provider": p, "field": f, "value": str(n.get("api_key") or "")}
            return {"ok": False, "error": "unknown_field"}

        if p == "http":
            h = _as_dict(tc.get("http") if isinstance(tc.get("http"), dict) else tc)
            profiles = h.get("profiles") if isinstance(h.get("profiles"), list) else []
            if f != "token":
                return {"ok": False, "error": "unknown_field"}
            if not prof:
                # best-effort: use selected profile if not specified
                try:
                    prof = str(h.get("selected") or "").strip()
                except Exception:
                    prof = ""
            if profiles:
                for pr in profiles:
                    if not isinstance(pr, dict):
                        continue
                    if str(pr.get("name") or "").strip() == prof:
                        return {"ok": True, "provider": p, "field": f, "profile": prof, "value": str(pr.get("token") or "")}
                # Not found: return empty (do not error, UI may be on a new profile)
                return {"ok": True, "provider": p, "field": f, "profile": prof, "value": ""}
            # legacy: {token: "..."}
            return {"ok": True, "provider": p, "field": f, "profile": prof, "value": str(h.get("token") or "")}

        return {"ok": False, "error": "unknown_provider"}

    def update_config(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        allow_empty = bool(patch.pop("__allow_empty_translator_config", False))
        return self._patch_config(patch, persist=True, allow_empty_translator_config=allow_empty)

    def apply_runtime_overrides(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        patch.pop("__allow_empty_translator_config", None)
        return self._patch_config(patch, persist=False, allow_empty_translator_config=True)

    def _patch_config(self, patch: Dict[str, Any], persist: bool, allow_empty_translator_config: bool) -> Dict[str, Any]:
        prev_tm = "auto"
        prev_provider = "openai"
        touched_translator = False
        out_cfg: Dict[str, Any] = {}
        with self._lock:
            cur = self._cfg.to_dict()
            # UI may send masked placeholders back; restore existing secrets to avoid persisting "********".
            patch = restore_masked_secrets_in_patch(patch, current_cfg=cur)
            prev_tm = str(cur.get("translate_mode") or "auto").strip().lower()
            prev_provider = str(cur.get("translator_provider") or "openai").strip().lower()
            touched_translator = ("translator_provider" in patch) or ("translator_config" in patch)
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
                provider = str(cur.get("translator_provider") or "openai").strip().lower()
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
        if watcher is None or not running or cfg is None:
            return

        # Hot-apply translate_mode for the running watcher (no restart required).
        try:
            next_tm = str(getattr(cfg, "translate_mode", "auto") or "auto").strip().lower()
            if next_tm and next_tm != str(prev_tm or ""):
                watcher.set_translate_mode(next_tm)
        except Exception:
            pass

        # Hot-reload translator/provider config for the running watcher.
        try:
            next_provider = str(getattr(cfg, "translator_provider", "") or "").strip().lower()
            if bool(touched_translator) or next_provider != str(prev_provider or ""):
                tr = self._build_translator(cfg) or _build_translator_impl(cfg)
                watcher.set_translator(tr)
        except Exception:
            pass

        # Hot-apply watcher runtime settings where it's safe (no full restart required).
        # Note: watch_codex_home still requires stop/start to take effect.
        try:
            watcher.set_watch_max_sessions(int(getattr(cfg, "watch_max_sessions", 3) or 3))
            watcher.set_replay_last_lines(int(getattr(cfg, "replay_last_lines", 0) or 0))
            watcher.set_poll_interval_s(float(getattr(cfg, "poll_interval", 0.5) or 0.5))
            watcher.set_file_scan_interval_s(float(getattr(cfg, "file_scan_interval", 2.0) or 2.0))
            watcher.set_follow_picker_config(
                follow_codex_process=bool(getattr(cfg, "follow_codex_process", False)),
                codex_process_regex=str(getattr(cfg, "codex_process_regex", "codex") or "codex"),
                only_follow_when_process=bool(getattr(cfg, "only_follow_when_process", True)),
            )
        except Exception:
            pass

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
        if kind != "reasoning_summary":
            return {"ok": False, "error": "not_thinking"}

        text = str(msg.get("text") or "")
        if not text.strip():
            return {"ok": False, "error": "empty_text"}

        prev_zh = str(msg.get("zh") or "")

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

        queued = False
        try:
            queued = bool(watcher.retranslate(m, text=text, thread_key=thread_key, fallback_zh=prev_zh))
        except Exception:
            queued = False
        if not queued:
            return {"ok": False, "id": m, "queued": False, "error": "enqueue_failed"}

        # Clear existing error (but keep previous zh until the new translation succeeds).
        try:
            self._state.add({"op": "update", "id": m, "translate_error": ""})
        except Exception:
            pass
        return {"ok": True, "id": m, "queued": True}

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

        cleaned_keys: Set[str] = set()
        for x in raw_keys:
            try:
                s = str(x or "").strip()
            except Exception:
                s = ""
            if not s:
                continue
            cleaned_keys.add(s[:256])
            if len(cleaned_keys) >= 1000:
                break

        cleaned_files: Set[str] = set()
        for x in raw_files:
            try:
                s = str(x or "").strip()
            except Exception:
                s = ""
            if not s:
                continue
            cleaned_files.add(s[:2048])
            if len(cleaned_files) >= 1000:
                break

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
