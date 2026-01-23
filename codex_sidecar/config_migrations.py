from __future__ import annotations

from pathlib import Path
from typing import Any, Callable


def ensure_cfg_invariants(
    cfg: Any,
    config_home: Path,
    *,
    default_watch_codex_home: Callable[[], str],
) -> None:
    # config_home is immutable (controls where the config is stored)
    try:
        cfg.config_home = str(config_home)
    except Exception:
        pass
    try:
        if not getattr(cfg, "watch_codex_home", ""):
            cfg.watch_codex_home = str(default_watch_codex_home() or "")
    except Exception:
        pass


def _migrate_stub_provider(cfg: Any, config_home: Path, *, save_config: Callable[[Path, Any], None]) -> None:
    # 兼容旧配置：移除 stub/none Provider 后，自动迁移到 openai（不丢失其他 provider 配置）。
    try:
        p = str(getattr(cfg, "translator_provider", "") or "").strip().lower()
        if p in ("stub", "none"):
            cfg.translator_provider = "openai"
            save_config(config_home, cfg)
    except Exception:
        pass


def _migrate_nvidia_model(cfg: Any, config_home: Path, *, save_config: Callable[[Path, Any], None]) -> None:
    # NVIDIA 翻译模型：仅保留 4 个可选项；同时修正历史遗留的错误 id（直接写回配置）。
    try:
        tc = getattr(cfg, "translator_config", None)
        if not isinstance(tc, dict):
            return
        nv = None
        if isinstance(tc.get("nvidia"), dict):
            nv = tc.get("nvidia")
        else:
            # Legacy config: translator_config stored NVIDIA fields at top-level.
            looks_like_nvidia = False
            for k in ("base_url", "api_key", "auth_env", "model", "rpm", "max_tokens", "timeout_s"):
                if k in tc:
                    looks_like_nvidia = True
                    break
            if looks_like_nvidia:
                nv = tc
        if not isinstance(nv, dict):
            return
        allowed = {
            "moonshotai/kimi-k2-instruct",
            "google/gemma-3-1b-it",
            "mistralai/mistral-7b-instruct-v0.3",
            "mistralai/ministral-14b-instruct-2512",
        }
        default_model = "moonshotai/kimi-k2-instruct"
        m = str(nv.get("model") or "").strip()
        if not m or m not in allowed:
            nv["model"] = default_model
            try:
                save_config(config_home, cfg)
            except Exception:
                pass
    except Exception:
        pass


def _migrate_replay_last_lines(cfg: Any, config_home: Path, *, save_config: Callable[[Path, Any], None]) -> None:
    # Migration: older default replay_last_lines=0 caused empty session list after restart
    # unless new output arrives. Align to CLI default (200) so “重启即恢复”开箱即用。
    try:
        if int(getattr(cfg, "replay_last_lines", 0) or 0) <= 0:
            cfg.replay_last_lines = 200
            save_config(config_home, cfg)
    except Exception:
        pass


def apply_inplace_migrations(cfg: Any, config_home: Path, *, save_config: Callable[[Path, Any], None]) -> None:
    _migrate_stub_provider(cfg, config_home, save_config=save_config)
    _migrate_nvidia_model(cfg, config_home, save_config=save_config)
    _migrate_replay_last_lines(cfg, config_home, save_config=save_config)

