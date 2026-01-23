import os
import sys
from pathlib import Path
from typing import Optional
from urllib.parse import unquote


_REPO_ROOT = (Path(__file__).resolve().parent.parent.parent).resolve()
_UI_DIR = (_REPO_ROOT / "ui").resolve()


def ui_dir() -> Path:
    """Resolve the on-disk UI root directory (served at /ui)."""
    env = os.environ.get("CODEX_SIDECAR_UI_DIR")
    if env:
        try:
            return Path(env).expanduser().resolve()
        except Exception:
            return Path(env).expanduser()
    # PyInstaller onefile/onedir: bundle data files under sys._MEIPASS
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        try:
            cand = (Path(str(meipass)) / "ui").resolve()
        except Exception:
            cand = Path(str(meipass)) / "ui"
        try:
            if cand.exists() and cand.is_dir():
                return cand
        except Exception:
            pass
    return _UI_DIR


def resolve_ui_path(rel: str, root_dir: Optional[Path] = None) -> Optional[Path]:
    rel_norm = unquote(rel or "").lstrip("/")
    try:
        root = (root_dir or ui_dir()).resolve()
        cand = (root / rel_norm).resolve()
        if root not in cand.parents and cand != root:
            return None
        return cand
    except Exception:
        return None


def ui_content_type(path: Path) -> str:
    ext = (path.suffix or "").lower()
    if ext in (".html", ".htm"):
        return "text/html; charset=utf-8"
    if ext == ".css":
        return "text/css; charset=utf-8"
    if ext == ".js":
        return "application/javascript; charset=utf-8"
    if ext in (".json", ".map"):
        return "application/json; charset=utf-8"
    if ext == ".woff2":
        return "font/woff2"
    if ext == ".woff":
        return "font/woff"
    if ext == ".ttf":
        return "font/ttf"
    if ext == ".otf":
        return "font/otf"
    if ext == ".ogg":
        return "audio/ogg"
    if ext == ".mp3":
        return "audio/mpeg"
    if ext == ".wav":
        return "audio/wav"
    return "text/plain; charset=utf-8"


def load_ui_text(path: Path, fallback: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return fallback
