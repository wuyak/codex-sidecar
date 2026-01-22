"""
OpenAI Responses translator facade（向后兼容）。

实现迁移到 `codex_sidecar.translators.openai_responses_core`，该文件仅保留旧导入路径：

  - from codex_sidecar.translators.openai_responses import OpenAIResponsesTranslator
"""

from .openai_responses_core import OpenAIResponsesTranslator

__all__ = [
    "OpenAIResponsesTranslator",
]

