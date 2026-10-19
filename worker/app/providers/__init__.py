"""模型提供方（目前只有 OpenRouter；切换模型必须新建 embedding profile）。"""

from . import openrouter

__all__ = ["openrouter"]
