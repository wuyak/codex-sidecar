import json
import os
import re
import tempfile
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Dict, Optional

from .config_migrations import apply_inplace_migrations, ensure_cfg_invariants


_SFX_BUILTIN_RE = re.compile(r"^builtin:([a-z0-9][a-z0-9_-]{0,63})$")
_SFX_FILE_RE = re.compile(r"^file:([A-Za-z0-9][A-Za-z0-9._-]{0,119})$")
_SFX_FILE_ALLOWED_EXTS = (".ogg", ".mp3", ".wav")


def _sanitize_sfx_id(v: Any) -> str:
    s = str(v or "").strip()
    if not s or s.lower() == "none":
        return "none"
    m = _SFX_BUILTIN_RE.fullmatch(s.lower())
    if m:
        return f"builtin:{m.group(1)}"
    m2 = _SFX_FILE_RE.fullmatch(s)
    if m2:
        name = m2.group(1)
        ext = Path(name).suffix.lower()
        if ext in _SFX_FILE_ALLOWED_EXTS:
            return f"file:{name}"
    return "none"


@dataclass
class SidecarConfig:
    # Where sidecar config is stored (NOT the watched Codex home).
    config_home: str
    # Which CODEX_HOME to watch for sessions/rollout jsonl.
    watch_codex_home: str

    replay_last_lines: int = 200
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

    # 提示音（UI）：none（无）或音效 id（builtin:* / file:*）。
    # - notify_sound_assistant: 回答输出（assistant_message）
    # - notify_sound_tool_gate: 终端确认等待（tool_gate）
    notify_sound_assistant: str = "none"
    notify_sound_tool_gate: str = "none"

    translator_provider: str = "http"  # http | openai | nvidia
    translator_config: Dict[str, Any] = field(default_factory=dict)  # provider-specific

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

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
        ns_assistant = _sanitize_sfx_id(d.get("notify_sound_assistant"))
        ns_tool_gate = _sanitize_sfx_id(d.get("notify_sound_tool_gate"))
        return SidecarConfig(
            config_home=cfg_home,
            watch_codex_home=watch_home,
            replay_last_lines=_to_int(d.get("replay_last_lines"), 200),
            watch_max_sessions=_to_int(d.get("watch_max_sessions") or d.get("max_sessions"), 3),
            poll_interval=_to_float(d.get("poll_interval"), 0.5),
            file_scan_interval=_to_float(d.get("file_scan_interval"), 2.0),
            max_messages=_to_int(d.get("max_messages"), 1000),
            auto_start=bool(d.get("auto_start") or False),
            follow_codex_process=bool(d.get("follow_codex_process") or False),
            codex_process_regex=str(d.get("codex_process_regex") or "codex"),
            only_follow_when_process=bool(only_follow_when_process),
            translate_mode=tm,
            notify_sound_assistant=ns_assistant,
            notify_sound_tool_gate=ns_tool_gate,
            translator_provider=str(d.get("translator_provider") or "http"),
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
        replay_last_lines=200,
        watch_max_sessions=3,
        poll_interval=0.5,
        file_scan_interval=2.0,
        max_messages=1000,
        auto_start=False,
        follow_codex_process=False,
        codex_process_regex="codex",
        only_follow_when_process=True,
        translate_mode="auto",
        notify_sound_assistant="none",
        notify_sound_tool_gate="none",
        translator_provider="http",
        translator_config={
            "openai": {
                "base_url": "",
                "model": "gpt-5.1",
                "api_key": "",
                "auth_header": "Authorization",
                "auth_prefix": "Bearer ",
                "timeout_s": 12,
                "reasoning_effort": "",
            },
            "nvidia": {
                "base_url": "https://integrate.api.nvidia.com/v1",
                "model": "moonshotai/kimi-k2-instruct",
                "api_key": "",
                "max_tokens": 8192,
                "rpm": 0,
                "timeout_s": 60,
                "max_retries": 3,
            },
            "http": {
                "selected": "siliconflowfree",
                "profiles": [
                    {
                        "name": "siliconflowfree",
                        "url": "https://siliconflow.zvo.cn/translate.json?to=chinese_simplified",
                        "token": "",
                        "timeout_s": 12,
                    }
                ],
            },
        },
    )


def _try_load_current_config(config_home: Path) -> Optional[SidecarConfig]:
    p = config_path(config_home)
    try:
        raw = p.read_text(encoding="utf-8")
        obj = json.loads(raw)
        if not isinstance(obj, dict):
            return None
        cfg = SidecarConfig.from_dict(obj)
        ensure_cfg_invariants(cfg, config_home, default_watch_codex_home=_default_watch_codex_home)
        apply_inplace_migrations(cfg, config_home, save_config=save_config)
        return cfg
    except Exception:
        return None


def load_config(config_home: Path) -> SidecarConfig:
    cfg = _try_load_current_config(config_home)
    if cfg is not None:
        return cfg
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
