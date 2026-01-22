from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

from ..config import SidecarConfig
from ..security import restore_masked_secrets_in_patch
from .translator_build import count_valid_http_profiles


@dataclass
class ConfigPatchResult:
    cfg: SidecarConfig
    out: Dict[str, Any]
    prev_translate_mode: str
    prev_provider: str
    touched_translator: bool


def apply_config_patch(
    *,
    current_cfg: SidecarConfig,
    config_home: Path,
    patch: Dict[str, Any],
    allow_empty_translator_config: bool,
) -> ConfigPatchResult:
    """
    Apply a UI config patch to the current SidecarConfig (pure logic; no IO).

    Semantics mirror the previous controller_core._patch_config implementation:
    - UI may send masked placeholders back; restore existing secrets to avoid persisting "********".
    - translator_config is merged one level deep to preserve other provider configs.
    - config_home is immutable and always overwritten with the controller's config_home.
    - When provider==http: reject empty profiles unless allow_empty_translator_config=True.
    """
    raw_patch = patch if isinstance(patch, dict) else {}
    patch_dict: Dict[str, Any] = dict(raw_patch)

    cur = current_cfg.to_dict()
    patch_dict = restore_masked_secrets_in_patch(patch_dict, current_cfg=cur)

    prev_tm = str(cur.get("translate_mode") or "auto").strip().lower()
    prev_provider = str(cur.get("translator_provider") or "openai").strip().lower()
    touched_translator = ("translator_provider" in patch_dict) or ("translator_config" in patch_dict)

    # Merge shallow; translator_config is one-level merged.
    for k, v in patch_dict.items():
        if k == "translator_config":
            if isinstance(v, dict):
                prev = cur.get(k)
                if isinstance(prev, dict):
                    merged = dict(prev)
                    merged.update(v)
                    cur[k] = merged
                else:
                    cur[k] = v
            continue
        cur[k] = v

    # config_home is immutable (controls where the config is stored)
    cur["config_home"] = str(config_home)

    # Guard: avoid accidentally clearing HTTP profiles (user can recover or switch provider).
    try:
        provider = str(cur.get("translator_provider") or "openai").strip().lower()
        if provider == "http":
            tc = cur.get("translator_config") or {}
            if count_valid_http_profiles(tc) <= 0 and not allow_empty_translator_config:
                raise ValueError("empty_http_profiles")
    except ValueError:
        raise
    except Exception:
        # On unexpected validation errors, do not block saving.
        pass

    cfg = SidecarConfig.from_dict(cur)
    out = cfg.to_dict()
    return ConfigPatchResult(
        cfg=cfg,
        out=out,
        prev_translate_mode=prev_tm,
        prev_provider=prev_provider,
        touched_translator=bool(touched_translator),
    )

