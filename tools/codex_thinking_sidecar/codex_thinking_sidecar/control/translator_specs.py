from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class TranslatorSpec:
    id: str
    label: str
    fields: Dict[str, Dict[str, Any]]


TRANSLATORS: List[TranslatorSpec] = [
    TranslatorSpec(id="stub", label="Stub（占位）", fields={}),
    TranslatorSpec(id="none", label="None（不翻译）", fields={}),
    TranslatorSpec(
        id="openai",
        label="GPT（Responses API 兼容）",
        fields={
            "base_url": {"type": "string", "label": "Base URL", "placeholder": "https://www.right.codes/codex/v1"},
            "model": {"type": "string", "label": "Model", "placeholder": "gpt-4.1-mini"},
            "api_key": {"type": "string", "label": "API Key", "placeholder": "可留空并改用 Auth ENV"},
            "timeout_s": {"type": "number", "label": "超时（秒）", "default": 12},
            "auth_env": {"type": "string", "label": "认证环境变量名（可选）", "placeholder": "CODEX_TRANSLATE_TOKEN"},
            "auth_header": {"type": "string", "label": "认证 Header", "default": "Authorization"},
            "auth_prefix": {"type": "string", "label": "认证前缀", "default": "Bearer "},
            "reasoning_effort": {"type": "string", "label": "Reasoning effort（可选）", "default": "minimal"},
        },
    ),
    TranslatorSpec(
        id="http",
        label="HTTP（通用适配器）",
        fields={
            "url": {"type": "string", "label": "翻译服务 URL", "placeholder": "http://127.0.0.1:9000/translate"},
            "token": {"type": "string", "label": "Token（可选）", "placeholder": "用于 Authorization Header 或 URL 中 {token} 替换"},
            "timeout_s": {"type": "number", "label": "超时（秒）", "default": 3},
            "auth_env": {"type": "string", "label": "认证环境变量名（可选）", "placeholder": "CODEX_TRANSLATE_TOKEN"},
            "auth_header": {"type": "string", "label": "认证 Header（可选）", "default": "Authorization"},
            "auth_prefix": {"type": "string", "label": "认证前缀（可选）", "default": "Bearer "},
        },
    ),
]

