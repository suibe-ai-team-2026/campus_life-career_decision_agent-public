"""固定 LangGraph 流程（不使用自由工具循环）。

每个 run kind 一张固定图：
- plan: validate → retrieve → rules → explain → publish
- ask: validate → retrieve → 闸门/生成 → finalize
- export: validate → render → register artifact
- assessment_explain: validate → explain
- compare: validate → retrieve → explain
- ingest: validate → parse/chunk/embed/persist → finalize
"""

from __future__ import annotations

from typing import Any, Callable

from ..errors import BadRequest
from .ask import run_ask
from .assessment import run_assessment
from .common import JobContext
from .compare import run_compare
from .export import run_export
from .ingest import run_ingest
from .plan import run_plan

RUNNERS: dict[str, Callable[[JobContext], dict[str, Any]]] = {
    "plan": run_plan,
    "ask": run_ask,
    "export": run_export,
    "assessment_explain": run_assessment,
    "compare": run_compare,
    "ingest": run_ingest,
}


def dispatch(ctx: JobContext) -> dict[str, Any]:
    runner = RUNNERS.get(ctx.job.kind)
    if runner is None:
        # run.kind 在 DB 有 check 约束；未知 kind 说明数据/部署不一致，不重试。
        raise BadRequest(f"不支持的 run kind：{ctx.job.kind}")
    return runner(ctx)


__all__ = ["RUNNERS", "dispatch", "run_ask", "run_assessment", "run_compare", "run_export", "run_ingest", "run_plan"]
