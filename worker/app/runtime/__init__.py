"""常驻运行层：claim 队列、心跳续租、固定图分派、优雅退出。"""

from .lease import LeaseGuard

# Worker/main 延迟导入，避免 ``python -m app.runtime.worker`` 时 runpy 重复导入告警。
_LAZY_EXPORTS = {"Worker", "WorkerDeps", "build_deps", "main"}


def __getattr__(name: str):
    if name in _LAZY_EXPORTS:
        from . import worker as _worker

        return getattr(_worker, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["LeaseGuard", "Worker", "WorkerDeps", "build_deps", "main"]
