import json
import os
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Optional


@dataclass
class SidecarConfig:
    # Where config is stored (usually ~/.codex). Not necessarily the watched codex home.
    config_home: str
    # Which CODEX_HOME to watch for sessions/rollout jsonl.
    watch_codex_home: str

    replay_last_lines: int = 0
    poll_interval: float = 0.5
    file_scan_interval: float = 2.0
    include_agent_reasoning: bool = False
    max_messages: int = 1000

    translator_provider: str = "stub"  # stub | none | http
    translator_config: Dict[str, Any] = None  # provider-specific

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        if d.get("translator_config") is None:
            d["translator_config"] = {}
        return d

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "SidecarConfig":
        cfg_home = str(d.get("config_home") or "")
        watch_home = str(d.get("watch_codex_home") or cfg_home)
        translator_config = d.get("translator_config")
        if not isinstance(translator_config, dict):
            translator_config = {}
        return SidecarConfig(
            config_home=cfg_home,
            watch_codex_home=watch_home,
            replay_last_lines=int(d.get("replay_last_lines") or 0),
            poll_interval=float(d.get("poll_interval") or 0.5),
            file_scan_interval=float(d.get("file_scan_interval") or 2.0),
            include_agent_reasoning=bool(d.get("include_agent_reasoning") or False),
            max_messages=int(d.get("max_messages") or 1000),
            translator_provider=str(d.get("translator_provider") or "stub"),
            translator_config=translator_config,
        )


def config_path(config_home: Path) -> Path:
    return config_home / "tmp" / "codex_thinking_sidecar.config.json"


def default_config(config_home: Path) -> SidecarConfig:
    cfg_home = str(config_home)
    return SidecarConfig(
        config_home=cfg_home,
        watch_codex_home=cfg_home,
        replay_last_lines=0,
        poll_interval=0.5,
        file_scan_interval=2.0,
        include_agent_reasoning=False,
        max_messages=1000,
        translator_provider="stub",
        translator_config={},
    )


def load_config(config_home: Path) -> SidecarConfig:
    p = config_path(config_home)
    try:
        raw = p.read_text(encoding="utf-8")
        obj = json.loads(raw)
        if isinstance(obj, dict):
            cfg = SidecarConfig.from_dict(obj)
            if not cfg.config_home:
                cfg.config_home = str(config_home)
            if not cfg.watch_codex_home:
                cfg.watch_codex_home = cfg.config_home
            return cfg
    except Exception:
        pass
    return default_config(config_home)


def save_config(config_home: Path, cfg: SidecarConfig) -> None:
    p = config_path(config_home)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
    except Exception:
        return
    data = json.dumps(cfg.to_dict(), ensure_ascii=False, indent=2) + "\n"
    tmp_dir = p.parent if p.parent.exists() else Path(tempfile.gettempdir())
    try:
        fd, tmp_path = tempfile.mkstemp(prefix="codex_thinking_sidecar.", suffix=".tmp", dir=str(tmp_dir))
        os.close(fd)
        Path(tmp_path).write_text(data, encoding="utf-8")
        Path(tmp_path).replace(p)
    except Exception:
        try:
            p.write_text(data, encoding="utf-8")
        except Exception:
            return

