"""知途（Campus Pathway）Python worker.

该包只做三件事：消费 Supabase 队列里的 run、执行固定的 LangGraph 流程、
把可核验的结果写回 Supabase。它不向公网开放端口，不持有浏览器可用的密钥。
"""

__all__ = ["__version__"]

__version__ = "0.1.0"
