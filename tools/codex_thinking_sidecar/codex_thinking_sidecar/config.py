import json
import os
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


@dataclass
class SidecarConfig:
    # Where sidecar config is stored (NOT the watched Codex home).
    config_home: str
    # Which CODEX_HOME to watch for sessions/rollout jsonl.
    watch_codex_home: str

    replay_last_lines: int = 0
    # 同时 tail 的会话文件数量（用于多会话并行，不依赖“锁定跟随”切换）。
    watch_max_sessions: int = 3
    poll_interval: float = 0.5
    file_scan_interval: float = 2.0
    include_agent_reasoning: bool = False
    max_messages: int = 1000

    # UI 友好：自动开始监听（通常用于 /ui 模式）。
    auto_start: bool = False

    # 是否优先基于 Codex 进程定位“正在写入的 rollout 文件”。
    # 兼容旧行为：默认关闭，仍按 sessions mtime 选择最新文件。
    follow_codex_process: bool = False

    # Codex 进程匹配规则（正则），在 WSL2/Linux 下用于扫描 /proc。
    codex_process_regex: str = "codex"

    # 当启用 follow_codex_process 时，是否仅在检测到 Codex 进程后才允许切换/选择文件。
    # 默认开启以避免 Codex 未运行时误切到历史会话文件。
    only_follow_when_process: bool = True

    translator_provider: str = "stub"  # stub | none | http | openai
    translator_config: Dict[str, Any] = None  # provider-specific

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        if d.get("translator_config") is None:
            d["translator_config"] = {}
        return d

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "SidecarConfig":
        cfg_home = str(d.get("config_home") or "")
        watch_home = str(d.get("watch_codex_home") or _default_watch_codex_home())
        translator_config = d.get("translator_config")
        if not isinstance(translator_config, dict):
            translator_config = {}

        only_follow_when_process = d.get("only_follow_when_process")
        if only_follow_when_process is None:
            only_follow_when_process = True
        return SidecarConfig(
            config_home=cfg_home,
            watch_codex_home=watch_home,
            replay_last_lines=int(d.get("replay_last_lines") or 0),
            watch_max_sessions=int(d.get("watch_max_sessions") or d.get("max_sessions") or 3),
            poll_interval=float(d.get("poll_interval") or 0.5),
            file_scan_interval=float(d.get("file_scan_interval") or 2.0),
            include_agent_reasoning=bool(d.get("include_agent_reasoning") or False),
            max_messages=int(d.get("max_messages") or 1000),
            auto_start=bool(d.get("auto_start") or False),
            follow_codex_process=bool(d.get("follow_codex_process") or False),
            codex_process_regex=str(d.get("codex_process_regex") or "codex"),
            only_follow_when_process=bool(only_follow_when_process),
            translator_provider=str(d.get("translator_provider") or "stub"),
            translator_config=translator_config,
        )


def _default_watch_codex_home() -> str:
    env = os.environ.get("CODEX_HOME")
    if env:
        return str(Path(env).expanduser())
    return str(Path.home() / ".codex")


def default_config_home() -> Path:
    """
    Where sidecar stores user-level config by default (XDG).
    """
    base = os.environ.get("XDG_CONFIG_HOME")
    root = Path(base).expanduser() if base else (Path.home() / ".config")
    return root / "codex-thinking-sidecar"


def config_path(config_home: Path) -> Path:
    return config_home / "config.json"


def backup_path(config_home: Path) -> Path:
    p = config_path(config_home)
    return p.with_name(p.name + ".bak")


def _legacy_config_path(watch_codex_home: Path) -> Path:
    return watch_codex_home / "tmp" / "codex_thinking_sidecar.config.json"


def lastgood_path(config_home: Path) -> Path:
    """
    Legacy path kept for backward compatibility (no longer written by default).
    """
    # When config lived under CODEX_HOME/tmp:
    #   codex_thinking_sidecar.config.json.lastgood
    return config_path(config_home).with_name("codex_thinking_sidecar.config.json.lastgood")


def _score_http_profiles(translator_config: Dict[str, Any]) -> int:
    """
    Score translator_config for recovery purposes.

    - New format: {profiles:[{name,url,...},...], selected:"..."} => count valid profiles
    - Old format: {url:"http(s)://..."} => 1
    """
    if isinstance(translator_config.get("http"), dict):
        translator_config = translator_config.get("http") or {}
    try:
        profiles = translator_config.get("profiles")
        if isinstance(profiles, list):
            score = 0
            for p in profiles:
                if not isinstance(p, dict):
                    continue
                name = str(p.get("name") or "").strip()
                url = str(p.get("url") or "").strip()
                if not name or not url:
                    continue
                if not (url.startswith("http://") or url.startswith("https://")):
                    continue
                score += 1
            return score
    except Exception:
        return 0

    # Legacy single-url format
    try:
        url = str(translator_config.get("url") or "").strip()
        if url.startswith("http://") or url.startswith("https://"):
            return 1
    except Exception:
        pass
    return 0


def _safe_write_text(path: Path, text: str) -> None:
    try:
        path.write_text(text, encoding="utf-8")
    except Exception:
        return


def _backup_existing_config_file(config_home: Path) -> None:
    """
    Simple backup mechanism: keep 1 backup file next to config.json.
    """
    p = config_path(config_home)
    b = backup_path(config_home)
    try:
        if not p.exists():
            return
        raw = p.read_text(encoding="utf-8")
        if not raw.strip():
            return
        _safe_write_text(b, raw)
    except Exception:
        return


def find_recoverable_translator_snapshot(
    config_home: Path, watch_codex_home: Optional[Path] = None
) -> Tuple[Optional[Dict[str, Any]], str]:
    """
    Find the best translator snapshot from:
    - current config
    - config backup (single file)
    - legacy lastgood / backups / legacy config under CODEX_HOME/tmp

    Returns: (snapshot, source_path_str)
    snapshot = {"translator_provider": "...", "translator_config": {...}}
    """
    candidates = []
    p = config_path(config_home)
    b = backup_path(config_home)
    if p.exists():
        candidates.append(p)
    if b.exists():
        candidates.append(b)

    # Legacy sources (older versions stored config in CODEX_HOME/tmp)
    try:
        wh = watch_codex_home or Path(_default_watch_codex_home())
        legacy = _legacy_config_path(wh)
        lg = legacy.with_name(legacy.name + ".lastgood")
        if lg.exists():
            candidates.append(lg)
        try:
            backups = sorted(legacy.parent.glob(legacy.name + ".bak-*"), key=lambda x: x.stat().st_mtime, reverse=True)
            candidates.extend(backups)
        except Exception:
            pass
        if legacy.exists():
            candidates.append(legacy)
    except Exception:
        pass

    best = None
    best_score = -1
    best_path = ""
    for path in candidates:
        try:
            raw = path.read_text(encoding="utf-8")
            obj = json.loads(raw)
            if not isinstance(obj, dict):
                continue
            tc = obj.get("translator_config")
            if not isinstance(tc, dict):
                continue
            score = _score_http_profiles(tc)
            if score <= 0:
                continue
            if score > best_score:
                best_score = score
                http_tc = tc.get("http") if isinstance(tc.get("http"), dict) else tc
                best = {
                    "translator_provider": "http",
                    "translator_config": http_tc if isinstance(http_tc, dict) else {},
                }
                best_path = str(path)
        except Exception:
            continue
    return best, best_path


def default_config(config_home: Path) -> SidecarConfig:
    cfg_home = str(config_home)
    return SidecarConfig(
        config_home=cfg_home,
        watch_codex_home=_default_watch_codex_home(),
        replay_last_lines=0,
        watch_max_sessions=3,
        poll_interval=0.5,
        file_scan_interval=2.0,
        include_agent_reasoning=False,
        max_messages=1000,
        auto_start=False,
        follow_codex_process=False,
        codex_process_regex="codex",
        only_follow_when_process=True,
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
            # config_home is immutable (controls where the config is stored)
            cfg.config_home = str(config_home)
            if not cfg.watch_codex_home:
                cfg.watch_codex_home = _default_watch_codex_home()
            return cfg
    except Exception:
        pass

    # First-run migration: try legacy snapshots in CODEX_HOME/tmp if present.
    #
    # Older versions stored config in:
    #   $CODEX_HOME/tmp/codex_thinking_sidecar.config.json
    # and sometimes only kept:
    #   $CODEX_HOME/tmp/codex_thinking_sidecar.config.json.lastgood
    # (plus optional .bak-* files). Prefer the newest by mtime.
    try:
        wh = Path(_default_watch_codex_home())
        legacy = _legacy_config_path(wh)
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
                cfg = SidecarConfig.from_dict(obj)
                cfg.config_home = str(config_home)
                if not cfg.watch_codex_home:
                    cfg.watch_codex_home = _default_watch_codex_home()
                try:
                    save_config(config_home, cfg)
                except Exception:
                    pass
                return cfg
            except Exception:
                continue
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
    _backup_existing_config_file(config_home)
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
