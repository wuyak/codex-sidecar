import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import unquote

from .ui_assets import ui_dir, ui_content_type


_FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
_ALLOWED_EXTS = (".ogg", ".mp3", ".wav")

# Safety: avoid reading arbitrarily large files into memory.
MAX_CUSTOM_SFX_BYTES = 1024 * 1024  # 1 MiB


@dataclass(frozen=True)
class SfxItem:
    id: str
    label: str
    url: str
    source: str  # builtin|custom
    volume: float = 1.0
    rate: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "url": self.url,
            "source": self.source,
            "volume": float(self.volume),
            "rate": float(self.rate),
        }


def _sfx_manifest_path() -> Path:
    return ui_dir() / "sfx" / "manifest.json"


def _custom_sfx_dir(config_home: Path) -> Path:
    return config_home / "sounds"


def _safe_filename(name: str) -> str:
    s = unquote(str(name or "")).strip()
    if not s:
        return ""
    if "/" in s or "\\" in s or ".." in s:
        return ""
    if not _FILENAME_RE.fullmatch(s):
        return ""
    ext = Path(s).suffix.lower()
    if ext not in _ALLOWED_EXTS:
        return ""
    return s


def load_builtin_sfx() -> List[SfxItem]:
    """
    Load builtin SFX options from `ui/sfx/manifest.json`.

    Manifest format (v1):
    {
      "version": 1,
      "builtin": [
        {"id": "bell", "label": "…", "file": "bell.ogg", "volume": 0.9, "rate": 1.0}
      ]
    }
    """
    p = _sfx_manifest_path()
    try:
        raw = p.read_text(encoding="utf-8")
        obj = json.loads(raw)
    except Exception:
        return []
    if not isinstance(obj, dict):
        return []
    items = obj.get("builtin")
    if not isinstance(items, list):
        return []

    out: List[SfxItem] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        sid = str(it.get("id") or "").strip().lower()
        label = str(it.get("label") or "").strip()
        file = str(it.get("file") or "").strip()
        if not sid or not label or not file:
            continue
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", sid):
            continue
        if "/" in file or "\\" in file or ".." in file:
            continue
        if Path(file).suffix.lower() not in _ALLOWED_EXTS:
            continue
        vol = float(it.get("volume") or 1.0)
        rate = float(it.get("rate") or 1.0)
        if not (0.0 <= vol <= 2.0):
            vol = 1.0
        if not (0.5 <= rate <= 2.0):
            rate = 1.0
        out.append(
            SfxItem(
                id=f"builtin:{sid}",
                label=label,
                url=f"/ui/sfx/builtin/{file}",
                source="builtin",
                volume=vol,
                rate=rate,
            )
        )
    return out


def list_custom_sfx(config_home: Path) -> List[SfxItem]:
    root = _custom_sfx_dir(config_home)
    try:
        root_r = root.resolve()
    except Exception:
        root_r = root
    try:
        if not root_r.exists() or not root_r.is_dir():
            return []
    except Exception:
        return []

    out: List[SfxItem] = []
    try:
        for p in sorted(root_r.iterdir(), key=lambda x: x.name.lower()):
            try:
                if not p.is_file():
                    continue
            except Exception:
                continue
            name = _safe_filename(p.name)
            if not name:
                continue
            # Reject symlinks or odd paths that resolve outside the custom SFX root.
            try:
                p_r = p.resolve()
            except Exception:
                p_r = p
            try:
                if p_r.parent != root_r:
                    continue
            except Exception:
                continue
            try:
                size = int(p_r.stat().st_size)
                if size <= 0 or size > MAX_CUSTOM_SFX_BYTES:
                    continue
            except Exception:
                continue
            out.append(
                SfxItem(
                    id=f"file:{name}",
                    label=f"自定义：{name}",
                    url=f"/api/sfx/file/{name}",
                    source="custom",
                )
            )
    except Exception:
        return []
    return out


def list_sfx(config_home: Path) -> Dict[str, Any]:
    builtin = load_builtin_sfx()
    custom = list_custom_sfx(config_home)
    return {
        "ok": True,
        "builtin": [x.to_dict() for x in builtin],
        "custom": [x.to_dict() for x in custom],
        "max_custom_bytes": int(MAX_CUSTOM_SFX_BYTES),
        "custom_dir": "sounds",
    }


def read_custom_sfx_bytes(config_home: Path, name: str) -> Tuple[Optional[bytes], str]:
    safe = _safe_filename(name)
    if not safe:
        return None, ""
    root = _custom_sfx_dir(config_home)
    try:
        root_r = root.resolve()
    except Exception:
        root_r = root
    try:
        p = (root_r / safe).resolve()
    except Exception:
        p = root_r / safe
    try:
        if p.parent != root_r:
            return None, ""
    except Exception:
        return None, ""

    try:
        if not p.exists() or not p.is_file():
            return None, ""
        size = int(p.stat().st_size)
        if size <= 0 or size > MAX_CUSTOM_SFX_BYTES:
            return None, ""
        data = p.read_bytes()
        if not data or len(data) > MAX_CUSTOM_SFX_BYTES:
            return None, ""
        return data, ui_content_type(p)
    except Exception:
        return None, ""
