#!/usr/bin/env python3
"""OpenRouter 探针：部署前确认真实账号权限、embedding 维度/归一化、instruction 行为、
JSON 输出支持与 token 用量。

运行（需要真实 OPENROUTER_API_KEY / MODEL_MONTHLY_BUDGET_USD）：
    cd worker
    UV_CACHE_DIR=/tmp/uv-cache uv run --python 3.12 python scripts/probe_openrouter.py

只读探针：不写 Supabase、不写文件、不打印密钥；输出是安全 JSON。
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.budget import BudgetGuard  # noqa: E402
from app.config import Config  # noqa: E402
from app.errors import ConfigError, WorkerError  # noqa: E402
from app.providers.openrouter import (  # noqa: E402
    OpenRouterClient,
    build_document_embedding_input,
    build_query_embedding_input,
)


def _cosine(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    return dot / (math.sqrt(sum(a * a for a in left)) * math.sqrt(sum(b * b for b in right)))


def _norm(vector: list[float]) -> float:
    return math.sqrt(sum(value * value for value in vector))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OpenRouter embedding/chat 探针")
    parser.add_argument(
        "--question",
        default="上海对外经贸大学2024届毕业生主要去向是哪里？",
        help="探针使用的查询问题",
    )
    parser.add_argument("--json", action="store_true", help="只输出 JSON（默认已尽量只输出 JSON）")
    args = parser.parse_args(argv)

    try:
        config = Config.from_env()
    except ConfigError as exc:
        print(json.dumps({"ok": False, "error": exc.safe_message}, ensure_ascii=False, indent=2))
        return 2
    if config.model_monthly_budget_usd is None:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "MODEL_MONTHLY_BUDGET_USD 未设置：探针会消耗真实额度，必须显式设置预算。",
                    "config": config.safe_summary(),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 2

    budget = BudgetGuard(
        config.model_monthly_budget_usd,
        unknown_usage_reserve_usd=config.unknown_usage_reserve_usd,
    )
    client = OpenRouterClient(config, budget=budget)
    report: dict[str, object] = {
        "ok": False,
        "config": config.safe_summary(),
        "embedding": {},
        "chat": {},
        "budget": {},
    }
    try:
        # 1) 原始问题 vs 版本化 instruction 模板（确认提供方是否额外加 instruction）
        raw = client.embed_texts([args.question], operation="probe_embedding_raw")
        templated_input = build_query_embedding_input(config, args.question)
        templated = client.embed_texts([templated_input], operation="probe_embedding_query")
        for response in (raw, templated):
            if response.usage is not None:
                budget.commit(response.usage.estimated_cost)
        raw_vector = raw.vectors[0]
        query_vector = templated.vectors[0]
        similarity = _cosine(raw_vector, query_vector)
        report["embedding"] = {
            "model": raw.model,
            "dimensions": len(raw_vector),
            "expected_dimensions": config.embedding_dimensions,
            "l2_norm_raw": round(_norm(raw_vector), 9),
            "l2_norm_query_template": round(_norm(query_vector), 9),
            "cosine_raw_vs_template": round(similarity, 6),
            "instruction_mode": config.embedding_instruction_mode,
            "query_template_version": config.embedding_query_template_version,
            "latency_ms": raw.latency_ms + templated.latency_ms,
            "input_tokens_raw": raw.usage.input_tokens if raw.usage else None,
            "input_tokens_template": templated.usage.input_tokens if templated.usage else None,
        }

        # 2) 批量形状校验（16 条一批；这里只测 3 条，验证条数/index/维度）
        docs = [
            build_document_embedding_input("第一段文档：国际贸易实务课程介绍。"),
            build_document_embedding_input("第二段文档：跨境电商运营岗位要求。"),
            build_document_embedding_input("第三段文档：就业质量报告统计口径说明。"),
        ]
        batch = client.embed_texts(docs, operation="probe_embedding_batch")
        if batch.usage is not None:
            budget.commit(batch.usage.estimated_cost)
        report["embedding"]["batch"] = {
            "requested": len(docs),
            "returned": len(batch.vectors),
            "batch_requests": batch.request_count,
            "all_normalized": all(abs(_norm(vector) - 1.0) < 1e-6 for vector in batch.vectors),
        }

        # 3) Chat JSON 输出支持
        chat = client.chat(
            [
                {"role": "system", "content": "只输出 JSON 对象，不要输出其他文字。"},
                {"role": "user", "content": '返回 {"ok": true, "probe": "campus-pathway"} 这个 JSON。'},
            ],
            operation="probe_chat_json",
            max_tokens=80,
        )
        if chat.usage is not None:
            budget.commit(chat.usage.estimated_cost)
        parsed_ok = False
        try:
            payload = json.loads(chat.content)
            parsed_ok = isinstance(payload, dict)
        except json.JSONDecodeError:
            parsed_ok = False
        report["chat"] = {
            "model": chat.model,
            "json_mode_used": chat.json_mode_used,
            "json_parse_ok": parsed_ok,
            "latency_ms": chat.latency_ms,
            "input_tokens": chat.usage.input_tokens if chat.usage else None,
            "output_tokens": chat.usage.output_tokens if chat.usage else None,
            "finish_reason": chat.finish_reason,
        }
        report["budget"] = {
            "configured_usd": str(budget.budget_usd),
            "spent_usd_local": str(budget.spent_usd),
            "unknown_cost_usage_count": budget.unknown_cost_usage_count,
        }
        report["ok"] = (
            report["embedding"]["dimensions"] == config.embedding_dimensions
            and report["embedding"]["batch"]["all_normalized"] is True
            and report["embedding"]["batch"]["returned"] == len(docs)
            and report["chat"]["json_parse_ok"] is True
        )
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["ok"] else 1
    except WorkerError as exc:
        report["error"] = {"code": exc.code, "message": exc.safe_message, "retryable": exc.retryable}
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
