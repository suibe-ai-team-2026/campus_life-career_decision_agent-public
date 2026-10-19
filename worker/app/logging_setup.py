"""结构化日志 + 脱敏。

日志只允许出现 run_id / job_id / kind / model / duration_ms / tokens / error_code /
status / progress 这类字段；不允许打印请求体、响应体、密钥、文件正文或学生资料。
"""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import datetime, timezone

from .errors import redact

# 允许作为日志附加值出现的安全字段（其余字段直接丢弃并记一条告警）。
SAFE_FIELDS = frozenset(
    {
        "run_id",
        "job_id",
        "kind",
        "worker_id",
        "attempt",
        "max_attempts",
        "lease_epoch",
        "model",
        "operation",
        "duration_ms",
        "latency_ms",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "error_code",
        "retryable",
        "status",
        "progress",
        "chunks",
        "documents",
        "evidence",
        "candidates",
        "gate_version",
        "rules_version",
        "profile_id",
        "embedding_profile_id",
        "source_version_id",
        "source_id",
        "artifact_id",
        "bytes",
        "parser_version",
        "extraction_status",
        "retry",
        "counts",
        "budget_state",
    }
)

_TOKEN_LIKE = re.compile(r"[A-Za-z0-9_\-]{32,}")


class SafeFormatter(logging.Formatter):
    """把 record.safe_fields 序列化进单行 JSON，其余消息统一脱敏。"""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        fields = getattr(record, "safe_fields", None)
        if isinstance(fields, dict):
            for key, value in fields.items():
                if key not in SAFE_FIELDS:
                    continue
                if isinstance(value, str):
                    value = redact(value, limit=200)
                payload[key] = value
        if record.exc_info and record.levelno >= logging.ERROR:
            exc = record.exc_info[1]
            payload["error_type"] = type(exc).__name__
            payload["error_message"] = redact(exc, limit=200)
        line = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        return _TOKEN_LIKE.sub("[redacted]", line)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if root.handlers:
        # 重复调用时只更新级别，不重复挂 handler。
        root.setLevel(level.upper())
        return
    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(SafeFormatter())
    root.addHandler(handler)
    root.setLevel(level.upper())
    # 第三方库的 INFO 噪音太多，只保留 WARNING。
    for noisy in ("httpx", "httpcore", "jieba", "urllib3", "langgraph"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log_event(logger: logging.Logger, event: str, level: int = logging.INFO, **safe_fields: object) -> None:
    """带安全字段的单行日志入口。"""

    logger.log(level, event, extra={"safe_fields": safe_fields})
