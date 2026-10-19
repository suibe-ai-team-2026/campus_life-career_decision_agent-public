"""export 图：读 app_plan_versions.result → 中文 PDF → Storage → worker_register_artifact。

payload 严格符合 lead 补充契约：
``{ artifact_id, plan_id, plan_version_id, artifact: { artifact_id, bytes, sha256, expires_at? } }``
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..errors import BadRequest, ResourceNotFound, WorkerError
from ..export.pdf import render_plan_pdf
from ..models import DIRECTION_IDS, ExportInput, PlanResult
from .common import JobContext, direction_title


class ExportState(TypedDict, total=False):
    run_input: dict[str, Any]
    plan: dict[str, Any]
    plan_version: dict[str, Any]
    profile: dict[str, Any] | None
    result_payload: dict[str, Any]


def build_export_graph(ctx: JobContext):
    graph = StateGraph(ExportState)

    def validate_node(state: ExportState) -> ExportState:
        ctx.check_cancel()
        ctx.emit("rendering", 15)
        try:
            run_input = ExportInput.model_validate(ctx.job.input)
        except Exception as exc:  # noqa: BLE001
            raise BadRequest("export 输入结构不合法") from exc
        if not run_input.plan_id:
            raise BadRequest("export 需要 plan_id")
        plan = ctx.db.get_plan(ctx.job.owner_id, run_input.plan_id)
        version_id = run_input.plan_version_id or plan.get("current_version_id")
        if not version_id:
            raise ResourceNotFound("方案没有可导出的版本")
        plan, plan_version = ctx.db.get_plan_version(ctx.job.owner_id, str(version_id))
        if run_input.plan_id and str(plan_version.get("plan_id")) != str(run_input.plan_id):
            raise ResourceNotFound("plan_version 不属于该 plan")
        if not isinstance(plan_version.get("result"), dict):
            raise WorkerError("方案版本缺少 result，无法导出", detail="plan_version_missing_result")
        profile = ctx.db.get_profile(ctx.job.owner_id, str(plan.get("profile_id")))
        return {
            "run_input": run_input.model_dump(),
            "plan": plan,
            "plan_version": plan_version,
            "profile": profile,
        }

    def render_node(state: ExportState) -> ExportState:
        ctx.check_cancel()
        ctx.emit("rendering", 30)
        plan = state["plan"]
        plan_version = state["plan_version"]
        result_payload = dict(plan_version["result"])
        try:
            PlanResult.model_validate(result_payload)
        except Exception as exc:  # noqa: BLE001
            raise WorkerError("方案结果不符合 PlanResult 契约，拒绝导出") from exc
        direction_id = str(result_payload.get("direction_id") or plan.get("direction_id") or "")
        direction_row = ctx.db.get_direction(direction_id) if direction_id in DIRECTION_IDS else None
        pdf_bytes = render_plan_pdf(
            plan_result=result_payload,
            plan_version=plan_version,
            profile=state.get("profile"),
            direction_title=direction_title(direction_id, direction_row),
        )
        ctx.emit("rendering", 60)
        artifact_id = str(uuid.uuid4())
        storage_path = f"{ctx.job.owner_id}/{ctx.job.run_id}/{artifact_id}.pdf"
        sha256 = hashlib.sha256(pdf_bytes).hexdigest()
        ctx.db.storage_upload(
            ctx.config.artifacts_bucket,
            storage_path,
            pdf_bytes,
            content_type="application/pdf",
        )
        ctx.emit("rendering", 74)
        registered = ctx.db.register_artifact(
            job_id=ctx.job.job_id,
            worker_id=ctx.worker_id,
            lease_epoch=ctx.job.lease_epoch,
            artifact_id=artifact_id,
            kind="plan_pdf",
            storage_path=storage_path,
            sha256=sha256,
            byte_size=len(pdf_bytes),
            plan_version_id=str(plan_version["version_id"]),
        )
        expires_at: str | None = None
        try:
            artifact_row = ctx.db.get_artifact(ctx.job.owner_id, registered)
            expires_at = None if artifact_row.get("expires_at") is None else str(artifact_row["expires_at"])
        except ResourceNotFound:
            expires_at = None
        ctx.emit("validating", 88)
        payload: dict[str, Any] = {
            "artifact_id": registered,
            "plan_id": str(plan["plan_id"]),
            "plan_version_id": str(plan_version["version_id"]),
            "artifact": {
                "artifact_id": registered,
                "bytes": len(pdf_bytes),
                "sha256": sha256,
            },
        }
        if expires_at:
            payload["artifact"]["expires_at"] = expires_at
        return {"result_payload": payload}

    graph.add_node("validate", validate_node)
    graph.add_node("render", render_node)
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "render")
    graph.add_edge("render", END)
    return graph.compile()


def run_export(ctx: JobContext) -> dict[str, Any]:
    final_state = build_export_graph(ctx).invoke({})
    payload = final_state.get("result_payload")
    if not isinstance(payload, dict):
        raise BadRequest("export 图没有产出结果")
    return payload
