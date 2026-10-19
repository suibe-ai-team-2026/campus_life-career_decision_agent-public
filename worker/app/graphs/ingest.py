"""ingest 图：validate → 解析/切块/embedding/落库 → finalize。

payload 严格符合 lead 补充契约：
``{ source_id, source_version_id, chunks, documents, parser_version, extraction_status }``
"""

from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..errors import BadRequest
from ..ingest.pipeline import IngestPipeline
from ..models import IngestInput
from .common import JobContext


class IngestState(TypedDict, total=False):
    source_version_ids: list[str]
    result: dict[str, Any]


def build_ingest_graph(ctx: JobContext):
    graph = StateGraph(IngestState)

    def validate_node(state: IngestState) -> IngestState:
        ctx.check_cancel()
        ctx.emit("parsing", 8)
        try:
            run_input = IngestInput.model_validate(ctx.job.input)
        except Exception as exc:  # noqa: BLE001
            raise BadRequest("ingest 输入结构不合法") from exc
        version_ids = run_input.version_ids()
        if not version_ids:
            raise BadRequest("ingest 需要 source_version_id")
        return {"source_version_ids": version_ids}

    def ingest_node(state: IngestState) -> IngestState:
        ctx.check_cancel()
        ctx.emit("parsing", 12)
        pipeline = IngestPipeline(
            config=ctx.config,
            db=ctx.db,
            provider=ctx.provider,
            on_usage=ctx.record_usage,
        )
        result = pipeline.run(
            list(state["source_version_ids"]),
            owner_id=ctx.job.owner_id,
            run_id=ctx.job.run_id,
            emit=lambda status, progress: ctx.emit(status, progress),
        )
        return {"result": result.model_dump(mode="json")}

    def finalize_node(state: IngestState) -> IngestState:
        ctx.check_cancel()
        ctx.emit("validating", 92)
        return {}

    graph.add_node("validate", validate_node)
    graph.add_node("ingest", ingest_node)
    graph.add_node("finalize", finalize_node)
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "ingest")
    graph.add_edge("ingest", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile()


def run_ingest(ctx: JobContext) -> dict[str, Any]:
    final_state = build_ingest_graph(ctx).invoke({})
    payload = final_state.get("result")
    if not isinstance(payload, dict):
        raise BadRequest("ingest 图没有产出结果")
    return payload
