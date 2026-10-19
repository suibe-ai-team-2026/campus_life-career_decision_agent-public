"""worker 的错误分类与脱敏。

错误码必须与 ``src/lib/contracts/common.ts`` 的 ``ERROR_CODES`` 保持一致；
``app_run_events`` / ``app_runs.error_code`` 只保存这里的短码，不保存上游原文。
"""

from __future__ import annotations

import re
from typing import Iterable

# 与 src/lib/contracts/common.ts ERROR_CODES 对齐（worker 只会产生其中一部分）。
ERROR_CODES = frozenset(
    {
        "authentication_required",
        "resource_not_found",
        "version_conflict",
        "idempotency_conflict",
        "upload_too_large",
        "invalid_profile",
        "unsupported_direction",
        "rate_limited",
        "budget_exceeded",
        "model_auth_failed",
        "model_quota_exceeded",
        "model_timeout",
        "model_unavailable",
        "bad_request",
        "internal_error",
    }
)

_SECRET_PATTERNS = (
    re.compile(r"(?:sk|pk|sb)_[A-Za-z0-9_\-]{12,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9._\-]{8,}", re.IGNORECASE),
    re.compile(r"(?i)(api[_-]?key|apikey|authorization|token|secret)(\s*[=:]\s*)[\"']?[^\"'\s,;]{6,}"),
    re.compile(r"(?i)([?&](?:apikey|key|token|access_token|api_key)=)[^&\s]+"),
)


def redact(text: object, secrets: Iterable[str] | None = None, *, limit: int = 400) -> str:
    """把可能含密钥的文本压成可以安全写日志/错误字段的短字符串。"""

    value = "" if text is None else str(text)
    for secret in secrets or ():
        if secret and len(secret) >= 6:
            value = value.replace(secret, "[redacted]")
    # 逐模式替换为占位符，保留键名但丢弃值，避免把密钥写进日志。
    value = _SECRET_PATTERNS[0].sub("[redacted-token]", value)
    value = _SECRET_PATTERNS[1].sub("Bearer [redacted]", value)
    value = _SECRET_PATTERNS[2].sub(lambda m: f"{m.group(1)}{m.group(2)}[redacted]", value)
    value = _SECRET_PATTERNS[3].sub(lambda m: f"{m.group(1)}[redacted]", value)
    value = " ".join(value.split())
    if len(value) > limit:
        value = value[: limit - 1] + "…"
    return value


class WorkerError(Exception):
    """worker 可映射到 run.error_code 的异常基类。"""

    code: str = "internal_error"
    retryable: bool = True

    def __init__(self, message: str = "", *, detail: str | None = None) -> None:
        super().__init__(message or self.code)
        self.safe_message = redact(message or self.code)
        self.detail = redact(detail) if detail else None

    def as_safe_dict(self) -> dict[str, str | bool]:
        return {"code": self.code, "message": self.safe_message, "retryable": self.retryable}


class ConfigError(WorkerError):
    """部署配置错误：重试不会自愈，必须人工修改环境变量。"""

    code = "internal_error"
    retryable = False


class BudgetExceeded(WorkerError):
    code = "budget_exceeded"
    retryable = False


class ModelAuthFailed(WorkerError):
    code = "model_auth_failed"
    retryable = False


class ModelQuotaExceeded(WorkerError):
    code = "model_quota_exceeded"
    retryable = False


class ModelTimeout(WorkerError):
    code = "model_timeout"
    retryable = True


class ModelUnavailable(WorkerError):
    code = "model_unavailable"
    retryable = True


class ModelOutputInvalid(WorkerError):
    """模型返回内容不是约定的 JSON / 结构，重试一次后由调用方决定是否降级。"""

    code = "model_unavailable"
    retryable = True


class OutputValidationError(WorkerError):
    """模型文本里的引用/数字/实体越界；调用方必须丢弃该解释，而不是重试。"""

    code = "internal_error"
    retryable = False

    def __init__(self, message: str, *, reasons: list[str] | None = None) -> None:
        super().__init__(message)
        self.reasons = list(reasons or [])


class RetrievalError(WorkerError):
    code = "internal_error"
    retryable = True


class IngestError(WorkerError):
    code = "bad_request"
    retryable = False


class DatabaseError(WorkerError):
    code = "internal_error"
    retryable = True


class ResourceNotFound(DatabaseError):
    code = "resource_not_found"
    retryable = False


class BadRequest(WorkerError):
    code = "bad_request"
    retryable = False


class InvalidProfile(WorkerError):
    code = "invalid_profile"
    retryable = False


class UnsupportedDirection(WorkerError):
    code = "unsupported_direction"
    retryable = False


class StaleLeaseError(WorkerError):
    """job 的 (worker_id, lease_epoch) 已失效；此时禁止再发布任何结果。"""

    code = "internal_error"
    retryable = False


class LeaseLostError(StaleLeaseError):
    """心跳发现租约被别的 worker 拿走。"""


class RunCancelledError(Exception):
    """run.cancel_requested 为 true；运行时应当以 cancelled 结束，而不是 failed。"""


def classify(exc: BaseException) -> tuple[str, bool]:
    """把任意异常映射为 (error_code, retryable)。

    未知异常一律 internal_error + 可重试，由 DB 的 attempts/max_attempts 兜底；
    ``RunCancelledError``/``LeaseLostError`` 不在这里处理，运行时单独分支。
    """

    if isinstance(exc, WorkerError):
        return exc.code, exc.retryable
    return "internal_error", True
