"""Freestyle VM 生命周期：worker 空闲时主动 pause，避免为闲置算力付费。

Pause 后 VM 只计存储，不计 vCPU/内存；BFF 在用户提交任务前调用
POST /v5/vms/{id}/start 唤醒。这里只做 pause，不把 Freestyle 团队 key
暴露给浏览器/日志。
"""
from __future__ import annotations

from urllib.parse import quote

import httpx

from ..config import Config
from ..logging_setup import get_logger, log_event

logger = get_logger("worker.freestyle")


def pause_vm(config: Config) -> bool:
    if not config.freestyle_api_key or not config.freestyle_vm_id:
        return False
    url = f"{config.freestyle_base_url.rstrip('/')}/v5/vms/{quote(config.freestyle_vm_id, safe='')}/pause"
    try:
        response = httpx.post(
            url,
            headers={"Authorization": f"Bearer {config.freestyle_api_key}"},
            timeout=httpx.Timeout(6.0, connect=4.0),
        )
    except (httpx.TimeoutException, httpx.RemoteProtocolError, httpx.ReadError) as exc:
        # The VM freezes while the pause request is in flight, so the connection
        # often closes before a response arrives. Treat this as "pause requested";
        # if it did not actually take effect, the worker simply resumes polling.
        log_event(logger, "freestyle_pause_connection_closed", level=20, error_code=type(exc).__name__)
        return True
    except httpx.HTTPError as exc:
        log_event(logger, "freestyle_pause_failed", level=30, error_code=type(exc).__name__)
        return False
    if response.status_code in (200, 202, 204, 409):
        return True
    log_event(logger, "freestyle_pause_rejected", level=30, status_code=response.status_code)
    return False
