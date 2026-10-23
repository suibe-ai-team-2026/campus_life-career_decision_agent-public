"""plan 图（固定流程）：validate → retrieve → rules → explain → publish。

规则引擎先冻结事实（actions/courses/competitions/credits/gaps），AI 只解释；
发布走 ``worker_save_plan``（lease fencing），然后把 plan_id/version_id/version
放进 ``worker_complete_job`` 的 payload。
"""

from __future__ import annotations

import json
from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph

from ..errors import (
    BadRequest,
    InvalidProfile,
    OutputValidationError,
    ResourceNotFound,
    UnsupportedDirection,
    WorkerError,
    redact,
)
from ..models import DIRECTION_IDS, PlanInput, PlanResult, citation_payload, plan_result_payload
from ..prompts import career as prompts
from ..prompts import validate as prompt_validate
from ..retrieval.service import merge_user_evidence
from .common import (
    JobContext,
    direction_title,
    generate_validated_json,
    profile_summary,
    require_no_validation_reasons,
)


class PlanState(TypedDict, total=False):
    run_input: dict[str, Any]
    profile: dict[str, Any]
    rule_result: PlanResult
    rule_payload: dict[str, Any]
    retrieval: Any
    explanation: str | None
    warnings: list[str]
    payload: dict[str, Any]


def _parse_input(ctx: JobContext) -> PlanInput:
    try:
        parsed = PlanInput.model_validate(ctx.job.input)
    except Exception as exc:  # noqa: BLE001 - pydantic 错误信息不应外泄
        raise BadRequest("plan 输入结构不合法") from exc
    if not parsed.profile_id or not parsed.direction_id:
        raise BadRequest("plan 需要 profile_id 与 direction_id")
    if parsed.direction_id not in DIRECTION_IDS:
        raise UnsupportedDirection(f"未知方向：{parsed.direction_id}")
    return parsed


def build_plan_graph(ctx: JobContext):
    graph = StateGraph(PlanState)

    def validate_node(state: PlanState) -> PlanState:
        ctx.check_cancel()
        ctx.emit("retrieving", 15)
        run_input = _parse_input(ctx)
        profile = ctx.db.get_profile(ctx.job.owner_id, str(run_input.profile_id))
        if ctx.job.profile_version is not None and int(profile.get("version") or 0) != int(ctx.job.profile_version):
            raise WorkerError("画像版本与 run.profile_version 不一致", detail="version_conflict")
        return {"run_input": run_input.model_dump(), "profile": profile, "warnings": []}

    def retrieve_node(state: PlanState) -> PlanState:
        ctx.check_cancel()
        ctx.emit("retrieving", 28)
        run_input = state["run_input"]
        profile = state["profile"]
        direction_id = str(run_input["direction_id"])
        question = " ".join(
            part
            for part in (
                str(profile.get("major") or ""),
                direction_title(direction_id, ctx.db.get_direction(direction_id)),
                "能力要求 课程 学分 竞赛 就业方向",
            )
            if part
        )
        outcome = ctx.retrieval.search(
            owner_id=ctx.job.owner_id,
            run_id=ctx.job.run_id,
            question=question,
        )
        # 用户自己上传的资料（私有、未核验）不能进规则库，但要参与检索与解释：
        # 单独召回本人上传的来源版本并并入证据，排在前面便于引用。
        try:
            owner_versions = ctx.db.list_owner_upload_versions(str(ctx.job.owner_id))
        except Exception:  # noqa: BLE001 - 私有资料并入失败不应中断方案生成
            ctx.logger.exception("owner_upload_versions_failed")
            owner_versions = []
        if owner_versions:
            extra = ctx.retrieval.search(
                owner_id=ctx.job.owner_id,
                run_id=ctx.job.run_id,
                question=question,
                source_version_ids=[str(row["source_version_id"]) for row in owner_versions],
            )
            if extra.evidence:
                outcome = merge_user_evidence(
                    outcome,
                    extra,
                    max_evidence=ctx.config.retrieval.max_evidence + len(extra.evidence),
                )
                ctx.logger.info("user_sources_included count=%s", len(extra.evidence))
        ctx.emit("retrieving", 38)
        return {"retrieval": outcome}

    def rules_node(state: PlanState) -> PlanState:
        ctx.check_cancel()
        ctx.emit("planning", 45)
        run_input = state["run_input"]
        profile = state["profile"]
        result = ctx.rules_engine.query(
            str(run_input["direction_id"]),
            profile,
            rules_version=ctx.config.rules_version,
        )
        if result.status == "invalid_profile":
            raise InvalidProfile("画像字段不完整，规则引擎拒绝计算")
        if result.status == "unsupported_direction":
            raise UnsupportedDirection("规则引擎不支持该方向")
        payload = plan_result_payload(result)
        ctx.emit("planning", 52)
        return {"rule_result": result, "rule_payload": payload}

    def explain_node(state: PlanState) -> PlanState:
        ctx.check_cancel()
        ctx.emit("planning", 58)
        run_input = state["run_input"]
        profile = state["profile"]
        rule_payload = dict(state["rule_payload"])
        retrieval = state["retrieval"]
        warnings: list[str] = list(state.get("warnings") or [])
        explanation: str | None = None
        fallback_reason: str | None = None
        messages = prompts.build_plan_messages(
            direction_id=str(run_input["direction_id"]),
            profile_summary=profile_summary(profile),
            rule_facts=rule_payload,
            evidence=retrieval.evidence,
        )
        allowed_texts = [str(item.get("text") or "") for item in retrieval.evidence] + [
            json.dumps(rule_payload, ensure_ascii=False, sort_keys=True)
        ]
        allowed_urls = [str(item.get("canonical_url") or "") for item in retrieval.evidence if item.get("canonical_url")]

        def validator(raw: str):
            parsed = prompt_validate.parse_plan_explanation(
                raw,
                valid_citations={item["citation_no"] for item in retrieval.evidence},
                action_ids={action["action_id"] for action in rule_payload["actions"]},
                allowed_texts=allowed_texts,
                allowed_urls=allowed_urls,
                allowed_entity_titles=[
                    *[str(course.get("title") or "") for course in rule_payload.get("courses", [])],
                    *[str(competition.get("title") or "") for competition in rule_payload.get("competitions", [])],
                    *[str(action.get("title") or "") for action in rule_payload.get("actions", [])],
                    # 解释里引用证据来源的名称是正常的；此前只放课程/竞赛/行动标题，
                    # 模型一提来源名就被判 unknown_entities 并整段丢弃。
                    *[str(item.get("title") or "") for item in retrieval.evidence],
                ],
            )
            require_no_validation_reasons(parsed.validation_reasons, what="方案解释")
            return parsed

        try:
            parsed = generate_validated_json(ctx, messages, operation="chat_plan_explain", validator=validator)
            explanation = parsed.explanation
            if parsed.boundary_note:
                note_offenders = prompt_validate.validate_numbers(parsed.boundary_note, allowed_texts)
                if not note_offenders:
                    explanation = f"{explanation}\n资料边界：{parsed.boundary_note}"
                else:
                    warnings.append("boundary_note_dropped_number_mismatch")
        except WorkerError as exc:
            # 解释失败不阻塞确定性方案发布：回退为规则事实说明，并记录安全错误码。
            # 校验类失败必须与基础设施失败分开：OutputValidationError 的 code 是
            # internal_error，直接取 code 会把"模型输出越界"误报成"服务内部错误"，
            # 让用户和日志都无法定位原因。这里按类型分支并记录越界原因。
            if isinstance(exc, OutputValidationError):
                fallback_reason = "validation"
                reasons = [
                    redact(reason)
                    for reason in getattr(exc, "reasons", [])
                    if str(reason).strip()
                ][:3]
                ctx.logger.error(
                    "plan_explanation_invalid reasons=%s", "；".join(reasons) or "unknown"
                )
            else:
                fallback_reason = getattr(exc, "code", "model_unavailable")
                # 只记 error_code 定位不到来源：DatabaseError / RetrievalError /
                # ConfigError 的 code 都是 internal_error。补上异常类型与脱敏后的 detail。
                ctx.logger.error(
                    "plan_explanation_failed code=%s type=%s detail=%s",
                    fallback_reason,
                    type(exc).__name__,
                    redact(getattr(exc, "detail", "") or ""),
                )
            warnings.append(f"plan_explanation_fallback:{fallback_reason}")
        except Exception as exc:  # noqa: BLE001 - 输出校验失败/异常 JSON 都走兜底
            fallback_reason = type(exc).__name__
            warnings.append("plan_explanation_fallback:validation")
            ctx.logger.error("plan_explanation_invalid type=%s", fallback_reason)

        if explanation is None:
            explanation = prompt_validate.deterministic_plan_explanation(
                status=rule_payload["status"],
                gap_codes=[str(gap.get("code")) for gap in rule_payload.get("gaps", [])],
                reason=fallback_reason or "",
            )
        ctx.emit("planning", 76)
        return {"explanation": explanation, "warnings": warnings}

    def publish_node(state: PlanState) -> PlanState:
        ctx.check_cancel()
        ctx.emit("validating", 84)
        run_input = state["run_input"]
        retrieval = state["retrieval"]
        rule_payload = dict(state["rule_payload"])
        warnings: list[str] = list(state.get("warnings") or []) + list(getattr(retrieval, "warnings", []) or [])
        # 证据由检索层分配 citation_no；模型不能新增。
        rule_payload["evidence"] = [citation_payload(citation) for citation in retrieval.citations]
        rule_payload["explanation"] = state.get("explanation")
        rule_payload["warnings"] = warnings
        final_result = PlanResult.model_validate(rule_payload)
        final_payload = plan_result_payload(final_result)
        def save(target_plan_id: str | None):
            return ctx.db.save_plan(
                job_id=ctx.job.job_id,
                worker_id=ctx.worker_id,
                lease_epoch=ctx.job.lease_epoch,
                plan_id=target_plan_id,
                profile_id=str(run_input["profile_id"]),
                direction_id=str(run_input["direction_id"]),
                rules_version=final_result.rules_version,
                corpus_version=retrieval.corpus_version,
                embedding_profile_id=retrieval.embedding_profile.profile_id,
                actions=final_payload["actions"],
                result=final_payload,
                warnings=list(final_result.warnings),
            )

        requested_plan_id = run_input.get("plan_id") or None
        try:
            plan_id, version_id, version = save(requested_plan_id)
        except ResourceNotFound:
            if not requested_plan_id:
                raise
            # 客户端传来的 plan_id 已不属于当前匿名会话（本地缓存跨会话残留、
            # 或云端方案被清理）。不把用户卡死：改为新建方案并说明原因。
            ctx.logger.error("plan_id_not_found creating_new_plan requested=%s", redact(requested_plan_id))
            warnings.append("plan_id_not_found_created_new")
            rule_payload["warnings"] = warnings
            final_result = PlanResult.model_validate(rule_payload)
            final_payload = plan_result_payload(final_result)
            plan_id, version_id, version = save(None)
        payload = {
            "plan_id": plan_id,
            "version_id": version_id,
            "version": version,
            "result": final_payload,
        }
        ctx.emit("validating", 92)
        return {"payload": payload}

    graph.add_node("validate", validate_node)
    graph.add_node("retrieve", retrieve_node)
    graph.add_node("rules", rules_node)
    graph.add_node("explain", explain_node)
    graph.add_node("publish", publish_node)
    graph.add_edge(START, "validate")
    graph.add_edge("validate", "retrieve")
    graph.add_edge("retrieve", "rules")
    graph.add_edge("rules", "explain")
    graph.add_edge("explain", "publish")
    graph.add_edge("publish", END)
    return graph.compile()


def run_plan(ctx: JobContext) -> dict[str, Any]:
    graph = build_plan_graph(ctx)
    final_state = graph.invoke({})
    payload = final_state.get("payload")
    if not isinstance(payload, dict):
        raise WorkerError("plan 图没有产出 payload")
    return payload
