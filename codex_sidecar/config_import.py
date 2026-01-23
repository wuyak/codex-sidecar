import json
import os
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .config_migrations import ensure_cfg_invariants


def try_import_from_legacy_homes(
    config_home: Path,
    *,
    config_path: Callable[[Path], Path],
    from_dict: Callable[[Dict[str, Any]], Any],
    save_config: Callable[[Path, Any], None],
    default_watch_codex_home: Callable[[], str],
) -> Optional[Any]:
    # Migration: if the default config_home changes across versions, try importing the most
    # recent config from previous locations once so users don't "lose" settings after upgrade.
    #
    # Candidates:
    # - ./.codex-thinking-sidecar/config.json (previous local default)
    # - CODEX_HOME/tmp/codex-thinking-sidecar/config.json (a previous default)
    # - XDG (~/.config/codex-thinking-sidecar/config.json) (older default)
    try:
        cur_home = Path(config_home)
        legacy_homes = []
        try:
            legacy_homes.append((Path.cwd() / ".codex-thinking-sidecar").resolve())
        except Exception:
            legacy_homes.append(Path.cwd() / ".codex-thinking-sidecar")
        try:
            codex_home = Path(default_watch_codex_home()).expanduser()
            legacy_homes.append((codex_home / "tmp" / "codex-thinking-sidecar").resolve())
        except Exception:
            pass
        try:
            base = os.environ.get("XDG_CONFIG_HOME")
            xdg_home = (Path(base).expanduser() if base else (Path.home() / ".config")) / "codex-thinking-sidecar"
            legacy_homes.append(xdg_home.resolve())
        except Exception:
            pass

        candidates = []
        for home in legacy_homes:
            try:
                if home.resolve() == cur_home.resolve():
                    continue
            except Exception:
                if str(home) == str(cur_home):
                    continue
            p = config_path(home)
            if p.exists() and p.is_file():
                candidates.append(p)

        if candidates:
            try:
                candidates = sorted(candidates, key=lambda x: x.stat().st_mtime, reverse=True)
            except Exception:
                pass

        for cand in candidates:
            try:
                raw = cand.read_text(encoding="utf-8")
                obj = json.loads(raw)
                if not isinstance(obj, dict):
                    continue
                cfg = from_dict(obj)
                ensure_cfg_invariants(cfg, config_home, default_watch_codex_home=default_watch_codex_home)
                try:
                    save_config(config_home, cfg)
                except Exception:
                    pass
                return cfg
            except Exception:
                continue
    except Exception:
        pass
    return None


def try_import_from_legacy_snapshots(
    config_home: Path,
    *,
    legacy_config_path: Callable[[Path], Path],
    from_dict: Callable[[Dict[str, Any]], Any],
    save_config: Callable[[Path, Any], None],
    default_watch_codex_home: Callable[[], str],
) -> Optional[Any]:
    # First-run migration: try legacy snapshots in CODEX_HOME/tmp if present.
    #
    # Older versions stored config in:
    #   $CODEX_HOME/tmp/codex_thinking_sidecar.config.json
    # and sometimes only kept:
    #   $CODEX_HOME/tmp/codex_thinking_sidecar.config.json.lastgood
    # (plus optional .bak-* files). Prefer the newest by mtime.
    try:
        wh = Path(default_watch_codex_home())
        legacy = legacy_config_path(wh)
        candidates = []
        if legacy.exists():
            candidates.append(legacy)
        lg = legacy.with_name(legacy.name + ".lastgood")
        if lg.exists():
            candidates.append(lg)
        try:
            backups = sorted(
                legacy.parent.glob(legacy.name + ".bak-*"),
                key=lambda x: x.stat().st_mtime,
                reverse=True,
            )
            candidates.extend(backups)
        except Exception:
            pass

        # If multiple candidates exist, pick the newest file.
        if len(candidates) > 1:
            try:
                candidates = sorted(candidates, key=lambda x: x.stat().st_mtime, reverse=True)
            except Exception:
                pass

        for cand in candidates:
            try:
                raw = cand.read_text(encoding="utf-8")
                obj = json.loads(raw)
                if not isinstance(obj, dict):
                    continue
                cfg = from_dict(obj)
                ensure_cfg_invariants(cfg, config_home, default_watch_codex_home=default_watch_codex_home)
                try:
                    save_config(config_home, cfg)
                except Exception:
                    pass
                return cfg
            except Exception:
                continue
    except Exception:
        pass
    return None

