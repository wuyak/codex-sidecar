from typing import Any, Dict


def reveal_secret(cfg: Dict[str, Any], provider: str, field: str, profile: str = "") -> Dict[str, Any]:
    """
    Reveal a single secret value for UI "显示/隐藏" controls.

    Notes:
    - `/api/config` always returns a redacted view, so UI must call this endpoint
      to show original values on demand.
    - This returns only the requested field (not the whole config).
    - Behavior is kept consistent with the legacy controller implementation.
    """
    p = str(provider or "").strip().lower()
    f = str(field or "").strip().lower()
    prof = str(profile or "").strip()
    base = cfg if isinstance(cfg, dict) else {}
    tc = base.get("translator_config")
    if not isinstance(tc, dict):
        tc = {}

    def _as_dict(x: Any) -> Dict[str, Any]:
        return x if isinstance(x, dict) else {}

    if p == "openai":
        o = _as_dict(tc.get("openai") if isinstance(tc.get("openai"), dict) else tc)
        if f == "api_key":
            return {"ok": True, "provider": p, "field": f, "value": str(o.get("api_key") or "")}
        if f == "base_url":
            return {"ok": True, "provider": p, "field": f, "value": str(o.get("base_url") or "")}
        return {"ok": False, "error": "unknown_field"}

    if p == "nvidia":
        n = _as_dict(tc.get("nvidia") if isinstance(tc.get("nvidia"), dict) else tc)
        if f == "api_key":
            return {"ok": True, "provider": p, "field": f, "value": str(n.get("api_key") or "")}
        return {"ok": False, "error": "unknown_field"}

    if p == "http":
        h = _as_dict(tc.get("http") if isinstance(tc.get("http"), dict) else tc)
        profiles = h.get("profiles") if isinstance(h.get("profiles"), list) else []
        if f != "token":
            return {"ok": False, "error": "unknown_field"}
        if not prof:
            # best-effort: use selected profile if not specified
            try:
                prof = str(h.get("selected") or "").strip()
            except Exception:
                prof = ""
        if profiles:
            for pr in profiles:
                if not isinstance(pr, dict):
                    continue
                if str(pr.get("name") or "").strip() == prof:
                    return {"ok": True, "provider": p, "field": f, "profile": prof, "value": str(pr.get("token") or "")}
            # Not found: return empty (do not error, UI may be on a new profile)
            return {"ok": True, "provider": p, "field": f, "profile": prof, "value": ""}
        # legacy: {token: "..."}
        return {"ok": True, "provider": p, "field": f, "profile": prof, "value": str(h.get("token") or "")}

    return {"ok": False, "error": "unknown_provider"}
