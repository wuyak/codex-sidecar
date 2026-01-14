import json
import os
import urllib.parse
import urllib.error
import urllib.request
from dataclasses import dataclass
from socket import timeout as _SocketTimeout

from .utils import log_warn, normalize_url, sanitize_url


def _format_http_translate_error(url: str, auth_token: str, detail: str = "") -> str:
    safe = sanitize_url(url, auth_token)
    suffix = f" ({detail})" if detail else ""
    return f"WARN: HTTP 翻译失败（返回空译文）：{safe}{suffix}"


def _log_http_translate_error(url: str, auth_token: str, detail: str = "") -> str:
    msg = _format_http_translate_error(url, auth_token, detail=detail)
    return log_warn("http_translate", msg, min_interval_s=5.0)


@dataclass
class HttpTranslator:
    url: str
    timeout_s: float = 3.0
    auth_env: str = ""
    auth_token: str = ""
    auth_header: str = "Authorization"
    auth_prefix: str = "Bearer "
    last_error: str = ""

    def translate(self, text: str) -> str:
        if not text or not self.url:
            return ""
        url = normalize_url(self.url)
        if self.auth_token and "{token}" in url:
            url = url.replace("{token}", self.auth_token)
        url = normalize_url(url)

        parsed = urllib.parse.urlsplit(url)
        base_url = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
        qs = urllib.parse.parse_qs(parsed.query or "")
        is_translate_json = parsed.path.endswith("/translate.json") or parsed.path.endswith("translate.json")

        if is_translate_json:
            # SiliconFlow translate.js compatible endpoint:
            # - POST application/x-www-form-urlencoded
            # - text is a JSON array string: text=["..."]
            # - returns: {"text":["..."], ...}
            to_lang = (qs.get("to") or ["chinese_simplified"])[0] or "chinese_simplified"
            from_lang = (qs.get("from") or ["auto"])[0] or "auto"
            form = {
                "to": to_lang,
                "text": json.dumps([text], ensure_ascii=False),
            }
            if from_lang:
                form["from"] = from_lang
            data = urllib.parse.urlencode(form).encode("utf-8")
            req = urllib.request.Request(base_url, data=data, method="POST")
            req.add_header("Content-Type", "application/x-www-form-urlencoded; charset=utf-8")
        else:
            # Many community translation endpoints (e.g., DeepLX) use different field names.
            # Send both variants for broader compatibility; servers can ignore unknown keys.
            payload = {
                "text": text,
                "source": "en",
                "target": "zh",
                "source_lang": "EN",
                "target_lang": "ZH",
            }
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            req = urllib.request.Request(base_url, data=data, method="POST")
            req.add_header("Content-Type", "application/json; charset=utf-8")

        token = (self.auth_token or "").strip()
        if not token and self.auth_env:
            token = (os.environ.get(self.auth_env) or "").strip()
        if token:
            req.add_header(self.auth_header, f"{self.auth_prefix}{token}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                raw = resp.read()
                ctype = str(resp.headers.get("Content-Type") or "")
            try:
                obj = json.loads(raw.decode("utf-8", errors="replace"))
            except ValueError:
                # If server returns plain text (non-JSON), try to use it.
                try:
                    if "application/json" not in (ctype or "").lower():
                        txt = raw.decode("utf-8", errors="replace").strip()
                        if txt and not txt.lstrip().startswith("<"):
                            return txt
                except Exception:
                    pass
                self.last_error = _log_http_translate_error(url=url, auth_token=self.auth_token)
                return ""

            # Best-effort extraction across common shapes.
            if isinstance(obj, dict):
                # translate.json: {"text":["..."]}
                tlist = obj.get("text")
                if isinstance(tlist, list) and tlist:
                    first = tlist[0]
                    if isinstance(first, str) and first.strip():
                        return first
                for k in ("text", "data", "result", "translation", "translated_text"):
                    v = obj.get(k)
                    if isinstance(v, str) and v.strip():
                        return v
                    if isinstance(v, dict):
                        for kk in ("text", "data", "result", "translation", "translated_text"):
                            vv = v.get(kk)
                            if isinstance(vv, str) and vv.strip():
                                return vv
                # DeepL-like shape: {"translations":[{"text":"..."}]}
                tr = obj.get("translations")
                if isinstance(tr, list) and tr:
                    first = tr[0]
                    if isinstance(first, dict):
                        t = first.get("text")
                        if isinstance(t, str) and t.strip():
                            return t
            # Provide best-effort error hints without leaking secrets.
            detail = ""
            try:
                if isinstance(obj, dict):
                    if isinstance(obj.get("message"), str) and obj.get("message"):
                        detail = str(obj.get("message"))[:160]
                    elif isinstance(obj.get("info"), str) and obj.get("info"):
                        detail = str(obj.get("info"))[:160]
                    elif isinstance(obj.get("error"), str) and obj.get("error"):
                        detail = str(obj.get("error"))[:160]
                    elif isinstance(obj.get("code"), int):
                        detail = f"code={obj.get('code')}"
            except Exception:
                detail = ""
            self.last_error = _log_http_translate_error(url=url, auth_token=self.auth_token, detail=detail)
            return ""
        except urllib.error.HTTPError as e:
            detail = f"http_status={getattr(e, 'code', '')}"
            try:
                body = (e.read() or b"")[:200]
                # avoid printing html pages
                if body and not body.lstrip().startswith(b"<"):
                    detail += f" body={body.decode('utf-8', errors='replace')}"
            except Exception:
                pass
            self.last_error = _log_http_translate_error(url=url, auth_token=self.auth_token, detail=detail)
            return ""
        except (TimeoutError, _SocketTimeout):
            self.last_error = _log_http_translate_error(
                url=url,
                auth_token=self.auth_token,
                detail=f"timeout_s={self.timeout_s}",
            )
            return ""
        except urllib.error.URLError as e:
            reason = getattr(e, "reason", None)
            rname = type(reason).__name__ if reason is not None else "URLError"
            self.last_error = _log_http_translate_error(
                url=url,
                auth_token=self.auth_token,
                detail=f"url_error={rname}",
            )
            return ""
        except Exception as e:
            self.last_error = _log_http_translate_error(
                url=url,
                auth_token=self.auth_token,
                detail=f"error={type(e).__name__}",
            )
            return ""

