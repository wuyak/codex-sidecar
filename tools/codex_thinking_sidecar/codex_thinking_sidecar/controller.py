import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from .config import SidecarConfig, load_config, save_config
from .translator import HttpTranslator, NoneTranslator, StubTranslator, Translator
from .watcher import HttpIngestClient, RolloutWatcher


@dataclass
class TranslatorSpec:
    id: str
    label: str
    fields: Dict[str, Dict[str, Any]]


TRANSLATORS = [
    TranslatorSpec(id="stub", label="Stub（占位）", fields={}),
    TranslatorSpec(id="none", label="None（不翻译）", fields={}),
    TranslatorSpec(
        id="http",
        label="HTTP（通用适配器）",
        fields={
            "url": {"type": "string", "label": "翻译服务 URL", "placeholder": "http://127.0.0.1:9000/translate"},
            "token": {"type": "string", "label": "Token（可选）", "placeholder": "用于 Authorization Header 或 URL 中 {token} 替换"},
            "timeout_s": {"type": "number", "label": "超时（秒）", "default": 3},
            "auth_env": {"type": "string", "label": "认证环境变量名（可选）", "placeholder": "CODEX_TRANSLATE_TOKEN"},
            "auth_header": {"type": "string", "label": "认证 Header（可选）", "default": "Authorization"},
            "auth_prefix": {"type": "string", "label": "认证前缀（可选）", "default": "Bearer "},
        },
    ),
]


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
        self._last_error: str = ""
        self._started_at: float = 0.0

    def translators(self) -> Dict[str, Any]:
        return {"translators": [t.__dict__ for t in TRANSLATORS]}

    def get_config(self) -> Dict[str, Any]:
        with self._lock:
            return self._cfg.to_dict()

    def update_config(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        return self._patch_config(patch, persist=True)

    def apply_runtime_overrides(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        return self._patch_config(patch, persist=False)

    def _patch_config(self, patch: Dict[str, Any], persist: bool) -> Dict[str, Any]:
        with self._lock:
            cur = self._cfg.to_dict()
            # merge shallow
            for k, v in patch.items():
                if k == "translator_config":
                    if isinstance(v, dict):
                        cur[k] = v
                    continue
                cur[k] = v
            # config_home is immutable (controls where the config is stored)
            cur["config_home"] = str(self._config_home)
            self._cfg = SidecarConfig.from_dict(cur)
            if persist:
                save_config(self._config_home, self._cfg)
            return self._cfg.to_dict()

    def clear_messages(self) -> None:
        try:
            self._state.clear()
        except Exception:
            return

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
                translator=self._build_translator(cfg),
                replay_last_lines=int(cfg.replay_last_lines),
                poll_interval_s=float(cfg.poll_interval),
                file_scan_interval_s=float(cfg.file_scan_interval),
                include_agent_reasoning=bool(cfg.include_agent_reasoning),
            )
            self._stop_event = stop_event
            self._watcher = watcher

            t = threading.Thread(target=self._run_watcher, name="sidecar-watcher", daemon=True)
            self._thread = t
            t.start()

        return {"ok": True, "running": True}

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
        with self._lock:
            t = self._thread
            ev = self._stop_event
            self._thread = None
            self._stop_event = None
            self._watcher = None
        if ev is not None:
            ev.set()
        if t is not None and t.is_alive():
            t.join(timeout=2.0)
        return {"ok": True, "running": False}

    def status(self) -> Dict[str, Any]:
        with self._lock:
            running = self._thread is not None and self._thread.is_alive()
            watcher = self._watcher
            last_error = self._last_error
            started_at = self._started_at
            cfg = self._cfg.to_dict()

        ws = watcher.status() if watcher is not None else {}
        env_hint = {}
        try:
            if (cfg.get("translator_provider") or "") == "http":
                auth_env = ""
                tc = cfg.get("translator_config") or {}
                if isinstance(tc, dict):
                    auth_env = str(self._select_http_profile(tc).get("auth_env") or "").strip()
                if auth_env:
                    env_hint = {"auth_env": auth_env, "auth_env_set": bool(os.environ.get(auth_env))}
        except Exception:
            env_hint = {}
        return {
            "ok": True,
            "running": running,
            "started_at": started_at,
            "last_error": last_error or ws.get("last_error") or "",
            "watcher": ws,
            "config": cfg,
            "env": env_hint,
        }

    def _build_translator(self, cfg: SidecarConfig) -> Translator:
        provider = (cfg.translator_provider or "stub").strip().lower()
        if provider == "none":
            return NoneTranslator()
        if provider == "http":
            tc = cfg.translator_config or {}
            selected = self._select_http_profile(tc if isinstance(tc, dict) else {})
            url = str(selected.get("url") or "").strip()
            timeout_s = float(selected.get("timeout_s") or 3.0)
            auth_env = str(selected.get("auth_env") or "").strip()
            auth_token = str(selected.get("token") or "").strip()
            auth_header = str(selected.get("auth_header") or "Authorization").strip() or "Authorization"
            auth_prefix = str(selected.get("auth_prefix") or "Bearer ").strip()
            return HttpTranslator(
                url=url,
                timeout_s=timeout_s,
                auth_env=auth_env,
                auth_token=auth_token,
                auth_header=auth_header,
                auth_prefix=auth_prefix,
            )
        return StubTranslator()

    @staticmethod
    def _select_http_profile(tc: Dict[str, Any]) -> Dict[str, Any]:
        """
        兼容两种结构：

        1) 旧版：translator_config = {url, timeout_s, auth_env, ...}
        2) 多 profile：translator_config = {profiles:[{name,url,...},...], selected:"name"}
        """
        try:
            profiles = tc.get("profiles")
            selected = str(tc.get("selected") or "").strip()
            if isinstance(profiles, list) and profiles:
                chosen = None
                if selected:
                    for p in profiles:
                        if isinstance(p, dict) and str(p.get("name") or "").strip() == selected:
                            chosen = p
                            break
                if chosen is None:
                    for p in profiles:
                        if isinstance(p, dict):
                            chosen = p
                            break
                if isinstance(chosen, dict):
                    return chosen
        except Exception:
            pass
        return tc if isinstance(tc, dict) else {}
