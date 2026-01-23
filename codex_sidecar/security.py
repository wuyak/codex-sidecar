from __future__ import annotations

from typing import Any, Dict


MASK = "********"


def is_masked(v: Any) -> bool:
    try:
        return isinstance(v, str) and v.strip() == MASK
    except Exception:
        return False


def mask_if_set(v: Any) -> str:
    try:
        s = str(v or "")
    except Exception:
        s = ""
    return MASK if s.strip() else ""


def _looks_like_nvidia_legacy(tc: Dict[str, Any]) -> bool:
    try:
        for k in ("max_tokens", "rpm", "max_retries"):
            if k in tc:
                return True
        bu = str(tc.get("base_url") or "")
        if "nvidia" in bu.lower():
            return True
    except Exception:
        return False
    return False


def redact_sidecar_config(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """
    Return a copy of config dict safe for UI display / publishing.

    Policy:
    - openai: redact base_url + api_key
    - nvidia: redact api_key (base_url is non-sensitive)
    - http  : redact token (url may still include {token}; keep as-is)
    """
    out = dict(cfg or {})
    tc = out.get("translator_config")
    if not isinstance(tc, dict):
        return out

    tc_out: Dict[str, Any] = dict(tc)

    # Provider blocks (new structure).
    try:
        o = tc_out.get("openai")
        if isinstance(o, dict):
            oo = dict(o)
            if "base_url" in oo:
                oo["base_url"] = mask_if_set(oo.get("base_url"))
            if "api_key" in oo:
                oo["api_key"] = mask_if_set(oo.get("api_key"))
            tc_out["openai"] = oo
    except Exception:
        pass

    try:
        n = tc_out.get("nvidia")
        if isinstance(n, dict):
            nn = dict(n)
            if "api_key" in nn:
                nn["api_key"] = mask_if_set(nn.get("api_key"))
            tc_out["nvidia"] = nn
    except Exception:
        pass

    try:
        h = tc_out.get("http")
        if isinstance(h, dict):
            hh = dict(h)
            profiles = hh.get("profiles")
            if isinstance(profiles, list):
                new_profiles = []
                for p in profiles:
                    if not isinstance(p, dict):
                        new_profiles.append(p)
                        continue
                    pp = dict(p)
                    if "token" in pp:
                        pp["token"] = mask_if_set(pp.get("token"))
                    new_profiles.append(pp)
                hh["profiles"] = new_profiles
            else:
                # legacy: {url, token, timeout_s}
                if "token" in hh:
                    hh["token"] = mask_if_set(hh.get("token"))
            tc_out["http"] = hh
    except Exception:
        pass

    # Legacy structure (translator_config stored provider fields at top-level).
    try:
        if ("openai" not in tc_out) and ("nvidia" not in tc_out) and ("http" not in tc_out):
            # Heuristic: if looks like NVIDIA, only mask api_key; otherwise mask base_url + api_key.
            if _looks_like_nvidia_legacy(tc_out):
                if "api_key" in tc_out:
                    tc_out["api_key"] = mask_if_set(tc_out.get("api_key"))
            else:
                if "base_url" in tc_out:
                    tc_out["base_url"] = mask_if_set(tc_out.get("base_url"))
                if "api_key" in tc_out:
                    tc_out["api_key"] = mask_if_set(tc_out.get("api_key"))
                if "token" in tc_out:
                    tc_out["token"] = mask_if_set(tc_out.get("token"))
    except Exception:
        pass

    out["translator_config"] = tc_out
    return out


def restore_masked_secrets_in_patch(patch: Dict[str, Any], *, current_cfg: Dict[str, Any]) -> Dict[str, Any]:
    """
    When UI sends MASK placeholders back, keep existing secrets instead of persisting MASK.
    """
    if not isinstance(patch, dict):
        return patch
    tc_patch = patch.get("translator_config")
    if not isinstance(tc_patch, dict):
        return patch

    tc_cur = {}
    try:
        cur_tc = current_cfg.get("translator_config")
        if isinstance(cur_tc, dict):
            tc_cur = cur_tc
    except Exception:
        tc_cur = {}

    tc_out: Dict[str, Any] = dict(tc_patch)

    # openai
    try:
        o = tc_out.get("openai")
        if isinstance(o, dict):
            oo = dict(o)
            cur_o = tc_cur.get("openai") if isinstance(tc_cur.get("openai"), dict) else {}
            if is_masked(oo.get("api_key")):
                oo["api_key"] = (cur_o.get("api_key") or "")
            if is_masked(oo.get("base_url")):
                oo["base_url"] = (cur_o.get("base_url") or "")
            tc_out["openai"] = oo
    except Exception:
        pass

    # nvidia
    try:
        n = tc_out.get("nvidia")
        if isinstance(n, dict):
            nn = dict(n)
            cur_n = tc_cur.get("nvidia") if isinstance(tc_cur.get("nvidia"), dict) else {}
            if is_masked(nn.get("api_key")):
                nn["api_key"] = (cur_n.get("api_key") or "")
            tc_out["nvidia"] = nn
    except Exception:
        pass

    # http profiles token
    try:
        h = tc_out.get("http")
        if isinstance(h, dict):
            hh = dict(h)
            cur_h = tc_cur.get("http") if isinstance(tc_cur.get("http"), dict) else {}
            cur_profiles = cur_h.get("profiles") if isinstance(cur_h.get("profiles"), list) else []
            cur_tok_by_name = {}
            for p in cur_profiles:
                if not isinstance(p, dict):
                    continue
                nm = str(p.get("name") or "").strip()
                if nm:
                    cur_tok_by_name[nm] = str(p.get("token") or "")
            profiles = hh.get("profiles")
            if isinstance(profiles, list):
                new_profiles = []
                for p in profiles:
                    if not isinstance(p, dict):
                        new_profiles.append(p)
                        continue
                    pp = dict(p)
                    if is_masked(pp.get("token")):
                        nm = str(pp.get("name") or "").strip()
                        pp["token"] = cur_tok_by_name.get(nm, "")
                    new_profiles.append(pp)
                hh["profiles"] = new_profiles
            else:
                if is_masked(hh.get("token")):
                    hh["token"] = str(cur_h.get("token") or "")
            tc_out["http"] = hh
    except Exception:
        pass

    out = dict(patch)
    out["translator_config"] = tc_out
    return out

