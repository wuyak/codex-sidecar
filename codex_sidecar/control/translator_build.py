from typing import Any, Dict

from ..config import SidecarConfig
from ..translator import HttpTranslator, NvidiaChatTranslator, OpenAIResponsesTranslator, Translator


def build_translator(cfg: SidecarConfig) -> Translator:
    provider = (cfg.translator_provider or "openai").strip().lower()
    if provider not in ("openai", "nvidia", "http"):
        provider = "openai"
    if provider == "openai":
        tc = cfg.translator_config or {}
        tc = tc if isinstance(tc, dict) else {}
        if isinstance(tc.get("openai"), dict):
            tc = tc.get("openai") or {}
        base_url = str(tc.get("base_url") or "").strip()
        model = str(tc.get("model") or "").strip()
        api_key = str(tc.get("api_key") or "").strip()
        timeout_raw = tc.get("timeout_s")
        timeout_s = float(timeout_raw) if timeout_raw not in (None, "") else 12.0
        auth_header = str(tc.get("auth_header") or "Authorization").strip() or "Authorization"
        auth_prefix = str(tc.get("auth_prefix") or "Bearer ").strip()
        reasoning_effort = str(tc.get("reasoning_effort") or "").strip()
        return OpenAIResponsesTranslator(
            base_url=base_url,
            model=model,
            api_key=api_key,
            timeout_s=timeout_s,
            auth_header=auth_header,
            auth_prefix=auth_prefix,
            reasoning_effort=reasoning_effort,
        )
    if provider == "nvidia":
        tc = cfg.translator_config or {}
        tc = tc if isinstance(tc, dict) else {}
        if isinstance(tc.get("nvidia"), dict):
            tc = tc.get("nvidia") or {}
        base_url = str(tc.get("base_url") or "").strip()
        model = str(tc.get("model") or "").strip()
        api_key = str(tc.get("api_key") or "").strip()
        timeout_raw = tc.get("timeout_s")
        timeout_s = float(timeout_raw) if timeout_raw not in (None, "") else 60.0
        try:
            rpm_raw = tc.get("rpm")
            rpm = int(rpm_raw) if rpm_raw not in (None, "") else 0
        except Exception:
            rpm = 0
        try:
            mt_raw = tc.get("max_tokens")
            max_tokens = int(mt_raw) if mt_raw not in (None, "") else 8192
        except Exception:
            max_tokens = 8192
        max_tokens = max(0, max_tokens)
        try:
            mr_raw = tc.get("max_retries")
            max_retries = int(mr_raw) if mr_raw not in (None, "") else 3
        except Exception:
            max_retries = 3
        return NvidiaChatTranslator(
            base_url=base_url,
            model=model or "moonshotai/kimi-k2-instruct",
            api_key=api_key,
            timeout_s=timeout_s,
            rpm=rpm,
            max_tokens=max_tokens,
            max_retries=max_retries,
        )
    if provider == "http":
        tc = cfg.translator_config or {}
        selected = select_http_profile(tc if isinstance(tc, dict) else {})
        url = str(selected.get("url") or "").strip()
        timeout_s = float(selected.get("timeout_s") or 3.0)
        auth_token = str(selected.get("token") or "").strip()
        auth_header = str(selected.get("auth_header") or "Authorization").strip() or "Authorization"
        auth_prefix = str(selected.get("auth_prefix") or "Bearer ").strip()
        return HttpTranslator(
            url=url,
            timeout_s=timeout_s,
            auth_token=auth_token,
            auth_header=auth_header,
            auth_prefix=auth_prefix,
        )
    # Fallback is already normalized above.
    return OpenAIResponsesTranslator(base_url="", model="", api_key="", timeout_s=12.0)


def select_http_profile(tc: Dict[str, Any]) -> Dict[str, Any]:
    """
    兼容两种结构：

    1) 旧版：translator_config = {url, timeout_s, auth_env, ...}
    2) 多 profile：translator_config = {profiles:[{name,url,...},...], selected:"name"}
    """
    if isinstance(tc.get("http"), dict):
        tc = tc.get("http") or {}
    try:
        profiles = tc.get("profiles")
        selected = str(tc.get("selected") or "").strip()
        if isinstance(profiles, list) and profiles:
            chosen = None
            if selected:
                for p in profiles:
                    if isinstance(p, dict) and str(p.get("name") or "").strip() == selected:
                        chosen = p
                        break
            if chosen is None:
                for p in profiles:
                    if isinstance(p, dict):
                        chosen = p
                        break
            if isinstance(chosen, dict):
                return chosen
    except Exception:
        pass
    return tc if isinstance(tc, dict) else {}


def count_valid_http_profiles(tc: Any) -> int:
    if not isinstance(tc, dict):
        return 0
    # New format: translator_config = {http:{profiles:[...], selected:"..."}, openai:{...}}
    if isinstance(tc.get("http"), dict):
        tc = tc.get("http") or {}
    profiles = tc.get("profiles")
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
    # Legacy single-url format
    url = str(tc.get("url") or "").strip()
    if url.startswith("http://") or url.startswith("https://"):
        return 1
    return 0
