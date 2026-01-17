import json
import os
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


_VALID_NOTIFY_SOUNDS = (
    "none",
    "soft-1",
    "soft-1-low",
    "soft-1-high",
    "soft-2",
    "soft-2-low",
    "soft-2-high",
    "soft-3",
    "soft-3-low",
    "soft-3-high",
)


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

    # 翻译模式：
    # - auto  : 自动翻译思考内容（reasoning_summary）
    # - manual: 仅在 UI 触发（点击思考块 / 重译按钮）时翻译
    translate_mode: str = "auto"

    # 提示音（UI）：none（无）或预置音效 id（如 soft-1/soft-2/soft-3，支持 -low/-high 音量档）。
    notify_sound: str = "none"

    translator_provider: str = "openai"  # http | openai | nvidia
    translator_config: Dict[str, Any] = None  # provider-specific

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        if d.get("translator_config") is None:
            d["translator_config"] = {}
        return d

    @staticmethod
    def from_dict(d: Dict[str, Any]) -> "SidecarConfig":
        def _to_int(v: Any, default: int) -> int:
            try:
                if v is None:
                    return int(default)
                if isinstance(v, bool):
                    return int(v)
                if isinstance(v, (int, float)):
                    return int(v)
                s = str(v).strip()
                if not s:
                    return int(default)
                try:
                    return int(s)
                except Exception:
                    return int(float(s))
            except Exception:
                return int(default)

        def _to_float(v: Any, default: float) -> float:
            try:
                if v is None:
                    return float(default)
                if isinstance(v, bool):
                    return float(int(v))
                if isinstance(v, (int, float)):
                    return float(v)
                s = str(v).strip()
                if not s:
                    return float(default)
                return float(s)
            except Exception:
                return float(default)

        cfg_home = str(d.get("config_home") or "")
        watch_home = str(d.get("watch_codex_home") or _default_watch_codex_home())
        translator_config = d.get("translator_config")
        if not isinstance(translator_config, dict):
            translator_config = {}

        only_follow_when_process = d.get("only_follow_when_process")
        if only_follow_when_process is None:
            only_follow_when_process = True

        tm = str(d.get("translate_mode") or "auto").strip().lower()
        if tm not in ("auto", "manual"):
            tm = "auto"
        ns = str(d.get("notify_sound") or "none").strip().lower()
        if ns not in _VALID_NOTIFY_SOUNDS:
            ns = "none"
        return SidecarConfig(
            config_home=cfg_home,
            watch_codex_home=watch_home,
            replay_last_lines=_to_int(d.get("replay_last_lines"), 0),
            watch_max_sessions=_to_int(d.get("watch_max_sessions") or d.get("max_sessions"), 3),
            poll_interval=_to_float(d.get("poll_interval"), 0.5),
            file_scan_interval=_to_float(d.get("file_scan_interval"), 2.0),
            max_messages=_to_int(d.get("max_messages"), 1000),
            auto_start=bool(d.get("auto_start") or False),
            follow_codex_process=bool(d.get("follow_codex_process") or False),
            codex_process_regex=str(d.get("codex_process_regex") or "codex"),
            only_follow_when_process=bool(only_follow_when_process),
            translate_mode=tm,
            notify_sound=ns,
            translator_provider=str(d.get("translator_provider") or "openai"),
            translator_config=translator_config,
        )


def _default_watch_codex_home() -> str:
    env = os.environ.get("CODEX_HOME")
    if env:
        return str(Path(env).expanduser())
    return str(Path.home() / ".codex")


def default_config_home() -> Path:
    """
    Where sidecar stores user-level config by default.

    默认策略（更贴合本项目“本地工具/项目内使用”的场景）：
    - 配置落在当前项目目录下，便于一起搬运/回滚，不污染 ~/.config 或 ~/.codex。
    - 如需全局配置目录，可显式传 --config-home 覆盖。
    """
    try:
        return (Path.cwd() / "config" / "sidecar").resolve()
    except Exception:
        return Path.cwd() / "config" / "sidecar"


def config_path(config_home: Path) -> Path:
    return config_home / "config.json"


def _legacy_config_path(watch_codex_home: Path) -> Path:
    return watch_codex_home / "tmp" / "codex_thinking_sidecar.config.json"


def _safe_write_text(path: Path, text: str) -> None:
    try:
        path.write_text(text, encoding="utf-8")
    except Exception:
        return


def default_config(config_home: Path) -> SidecarConfig:
    cfg_home = str(config_home)
    return SidecarConfig(
        config_home=cfg_home,
        watch_codex_home=_default_watch_codex_home(),
        replay_last_lines=0,
        watch_max_sessions=3,
        poll_interval=0.5,
        file_scan_interval=2.0,
        max_messages=1000,
        auto_start=False,
        follow_codex_process=False,
        codex_process_regex="codex",
        only_follow_when_process=True,
        translate_mode="auto",
        notify_sound="none",
        translator_provider="openai",
        translator_config={
            "openai": {
                "base_url": "https://www.right.codes/codex/v1",
                "model": "gpt-5.1",
                "api_key": "",
                "auth_header": "Authorization",
                "auth_prefix": "Bearer ",
                "timeout_s": 12,
                "reasoning_effort": "",
            }
        },
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
            # 兼容旧配置：移除 stub/none Provider 后，自动迁移到 openai（不丢失其他 provider 配置）。
            try:
                p = str(getattr(cfg, "translator_provider", "") or "").strip().lower()
                if p in ("stub", "none"):
                    cfg.translator_provider = "openai"
                    save_config(config_home, cfg)
            except Exception:
                pass
            # NVIDIA 翻译模型：仅保留 4 个可选项；同时修正历史遗留的错误 id（直接写回配置）。
            try:
                tc = cfg.translator_config
                if isinstance(tc, dict):
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
                    if isinstance(nv, dict):
                        allowed = {
                            "moonshotai/kimi-k2-instruct",
                            "google/gemma-3-1b-it",
                            "mistralai/mistral-7b-instruct-v0.3",
                            "mistralai/ministral-14b-instruct-2512",
                        }
                        default_model = "moonshotai/kimi-k2-instruct"
                        m = str(nv.get("model") or "").strip()
                        changed = False
                        if not m or m not in allowed:
                            nv["model"] = default_model
                            changed = True
                        if changed:
                            try:
                                save_config(config_home, cfg)
                            except Exception:
                                pass
            except Exception:
                pass
            return cfg
    except Exception:
        pass

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
            codex_home = Path(_default_watch_codex_home()).expanduser()
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
    tmp_dir = p.parent if p.parent.exists() else Path(tempfile.gettempdir())
    try:
        fd, tmp_path = tempfile.mkstemp(prefix="codex_sidecar.", suffix=".tmp", dir=str(tmp_dir))
        os.close(fd)
        Path(tmp_path).write_text(data, encoding="utf-8")
        Path(tmp_path).replace(p)
    except Exception:
        try:
            p.write_text(data, encoding="utf-8")
        except Exception:
            return
