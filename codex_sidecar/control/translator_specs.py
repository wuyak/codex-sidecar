from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class TranslatorSpec:
    id: str
    label: str
    fields: Dict[str, Dict[str, Any]]


TRANSLATORS: List[TranslatorSpec] = [
    TranslatorSpec(
        id="nvidia",
        label="NVIDIA（NIM Chat Completions）",
        fields={
            "base_url": {"type": "string", "label": "Base URL", "placeholder": "https://integrate.api.nvidia.com/v1"},
            "model": {"type": "string", "label": "Model", "placeholder": "moonshotai/kimi-k2-instruct"},
            "api_key": {"type": "string", "label": "API Key", "placeholder": "nvapi-..."},
            "timeout_s": {"type": "number", "label": "超时（秒）", "default": 60},
            "rpm": {"type": "number", "label": "RPM（节流，0=关闭）", "default": 0},
            "max_tokens": {"type": "number", "label": "Max Tokens（输出上限）", "default": 8192},
            "max_retries": {"type": "number", "label": "429 重试次数", "default": 3},
        },
    ),
    TranslatorSpec(
        id="openai",
        label="GPT（Responses API 兼容）",
        fields={
            "base_url": {"type": "string", "label": "Base URL", "placeholder": "https://www.right.codes/codex/v1"},
            "model": {"type": "string", "label": "Model", "placeholder": "gpt-5.1"},
            "api_key": {"type": "string", "label": "API Key", "placeholder": "sk-..."},
            "timeout_s": {"type": "number", "label": "超时（秒）", "default": 12},
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
            "auth_header": {"type": "string", "label": "认证 Header（可选）", "default": "Authorization"},
            "auth_prefix": {"type": "string", "label": "认证前缀（可选）", "default": "Bearer "},
        },
    ),
]
