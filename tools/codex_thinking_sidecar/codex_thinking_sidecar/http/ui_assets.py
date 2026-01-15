from pathlib import Path
from typing import Optional
from urllib.parse import unquote


_UI_DIR = Path(__file__).resolve().parent.parent / "ui"


def resolve_ui_path(rel: str) -> Optional[Path]:
    rel_norm = unquote(rel or "").lstrip("/")
    try:
        cand = (_UI_DIR / rel_norm).resolve()
        root = _UI_DIR.resolve()
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
    if ext == ".json":
        return "application/json; charset=utf-8"
    return "text/plain; charset=utf-8"


def load_ui_text(path: Path, fallback: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return fallback

