from pathlib import Path
from typing import Any, Dict, Optional

from ..security import redact_sidecar_config


def project_rel_path(p: str, *, cwd: Optional[Path] = None) -> str:
    """
    Best-effort: display a project-relative path (avoid leaking /home/<user>/... in UI).
    """
    s = str(p or "").strip()
    if not s:
        return ""
    try:
        cand = Path(s).expanduser()
        cwdp = cwd if cwd is not None else Path.cwd()
        try:
            cand_r = cand.resolve()
        except Exception:
            cand_r = cand
        try:
            cwd_r = cwdp.resolve()
        except Exception:
            cwd_r = cwdp
        try:
            rel = cand_r.relative_to(cwd_r)
            return str(rel) if str(rel) != "." else "."
        except Exception:
            return s
    except Exception:
        return s


def apply_config_display_fields(cfg: Dict[str, Any], *, cwd: Optional[Path] = None) -> None:
    # Display-only helpers (do not persist).
    try:
        cfg_home = str(cfg.get("config_home") or "")
        cfg["config_home_display"] = project_rel_path(cfg_home, cwd=cwd)
        if cfg.get("config_home_display"):
            cfg["config_file_display"] = str(Path(str(cfg["config_home_display"])) / "config.json")
    except Exception:
        return


def build_config_payload(raw_cfg: Any, *, cwd: Optional[Path] = None) -> Dict[str, Any]:
    cfg = redact_sidecar_config(raw_cfg) if isinstance(raw_cfg, dict) else raw_cfg
    if isinstance(cfg, dict):
        apply_config_display_fields(cfg, cwd=cwd)
    payload: Dict[str, Any] = {"ok": True, "config": cfg}
    if isinstance(cfg, dict):
        payload.update(cfg)
    return payload


def decorate_status_payload(st: Any, *, cwd: Optional[Path] = None) -> Any:
    try:
        if isinstance(st, dict) and isinstance(st.get("config"), dict):
            st["config"] = redact_sidecar_config(st["config"])
            apply_config_display_fields(st["config"], cwd=cwd)
    except Exception:
        pass
    return st

