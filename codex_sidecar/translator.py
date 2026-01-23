"""
Translator facade（向后兼容的薄封装）。

实现位于 `codex_sidecar.translators.*`。
"""

from .translators import (
    HttpTranslator,
    NvidiaChatTranslator,
    OpenAIResponsesTranslator,
    Translator,
)

__all__ = [
    "Translator",
    "HttpTranslator",
    "OpenAIResponsesTranslator",
    "NvidiaChatTranslator",
]
