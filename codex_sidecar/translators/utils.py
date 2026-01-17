import re
import sys
import time
import urllib.parse


_URL_RE = re.compile(r"https?://", re.IGNORECASE)
_LAST_WARN_TS_BY_KIND = {}


def normalize_url(url: str) -> str:
    """
    容错：用户可能从文档/聊天复制带前缀标点（例如 `：https://...` / `URL：https://...`）。
    这里截取第一个 http(s):// 之后的部分，避免 urllib 报 `unknown url type`。
    """
    u = (url or "").strip()
    m = _URL_RE.search(u)
    if m and m.start() > 0:
        u = u[m.start() :]
    return u


def sanitize_url(url: str, auth_token: str) -> str:
    try:
        u = urllib.parse.urlsplit(normalize_url(url))
        path = u.path or ""
        if auth_token and auth_token in path:
            path = path.replace(auth_token, "<token>")
        # also redact long path segments that look like tokens
        parts = path.split("/")
        redacted = []
        for p in parts:
            if len(p) >= 24 and all(c.isalnum() or c in "-_." for c in p):
                redacted.append("<seg>")
            else:
                redacted.append(p)
        path = "/".join(redacted)
        return urllib.parse.urlunsplit((u.scheme, u.netloc, path, "", ""))
    except Exception:
        return "<url>"


def log_warn(kind: str, msg: str, min_interval_s: float = 5.0) -> str:
    """
    Rate-limited stderr log to avoid spamming when an endpoint is failing.
    """
    now = time.time()
    k = (kind or "warn").strip() or "warn"
    last = float(_LAST_WARN_TS_BY_KIND.get(k, 0.0) or 0.0)
    if now - last < float(min_interval_s or 0.0):
        return msg
    _LAST_WARN_TS_BY_KIND[k] = now
    try:
        print(f"[sidecar] {msg}", file=sys.stderr)
    except Exception:
        pass
    return msg


def compose_auth_value(prefix: str, token: str) -> str:
    """
    Compose an auth header value.

    Many servers expect "Bearer <token>" with a space. Users may configure prefix as
    "Bearer" or "Bearer " (with a trailing space). This helper normalizes both.
    """
    p = str(prefix or "")
    t = str(token or "")
    if not p:
        return t
    if not t:
        return p
    if p.endswith((" ", "\t")):
        return p + t
    return p + " " + t
