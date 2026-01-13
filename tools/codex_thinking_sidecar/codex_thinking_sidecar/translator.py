import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Protocol


class Translator(Protocol):
    def translate(self, text: str) -> str:
        ...


class StubTranslator:
    """
    占位翻译器：不调用任何外部 API。

    目的：先把“监听 → 提取 → 推送/展示”的链路跑通，后续再替换为真实翻译实现。
    """

    def translate(self, text: str) -> str:
        if not text:
            return ""
        # 这里用可辨识的占位，便于你确认链路是否工作。
        return "【中文占位】\n" + text


class NoneTranslator:
    def translate(self, text: str) -> str:
        return ""


@dataclass
class HttpTranslator:
    url: str
    timeout_s: float = 3.0
    auth_env: str = ""
    auth_header: str = "Authorization"
    auth_prefix: str = "Bearer "

    def translate(self, text: str) -> str:
        if not text or not self.url:
            return ""
        payload = {"text": text, "source": "en", "target": "zh"}
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(self.url, data=data, method="POST")
        req.add_header("Content-Type", "application/json; charset=utf-8")
        if self.auth_env:
            token = os.environ.get(self.auth_env)
            if token:
                req.add_header(self.auth_header, f"{self.auth_prefix}{token}")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout_s) as resp:
                raw = resp.read()
            obj = json.loads(raw.decode("utf-8", errors="replace"))
            if isinstance(obj, dict) and isinstance(obj.get("text"), str):
                return obj["text"]
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError):
            return ""
        except Exception:
            return ""
        return ""
