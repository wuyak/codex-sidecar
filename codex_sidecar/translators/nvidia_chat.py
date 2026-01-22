"""
NVIDIA Chat translator facade（向后兼容）。

实现迁移到 `codex_sidecar.translators.nvidia_chat_core`，该文件仅保留旧导入路径：

  - from codex_sidecar.translators.nvidia_chat import NvidiaChatTranslator
"""

from .nvidia_chat_core import NvidiaChatTranslator

__all__ = [
    "NvidiaChatTranslator",
]

