#!/usr/bin/env python3
"""知途（Campus Pathway）· corpus seed CLI。

把 data-dev 生成的 ``data/import/out/corpus.jsonl`` 写入 Supabase：
- 默认 ``--dry-run``：只读本地 corpus/meta、校验完整性并打印计划计数，不联网、不写库；
- ``--apply``：需要 Supabase / OpenRouter 环境变量与月度预算；幂等写入 sources / source_versions /
  chunks / embeddings，全部校验通过后才把 embedding profile 置为 active。

示例（在仓库根目录执行）：
    cd worker
    uv run --python 3.12 python scripts/seed_corpus.py --dry-run
    uv run --python 3.12 python scripts/seed_corpus.py --apply
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

WORKER_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = WORKER_DIR.parent
if str(WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(WORKER_DIR))

from app.budget import BudgetGuard  # noqa: E402
from app.config import Config  # noqa: E402
from app.corpus.seed import (  # noqa: E402
    DEFAULT_BATCH_SIZE,
    DEFAULT_PROFILE_ID,
    DEFAULT_PROGRESS_EVERY,
    CorpusSeedService,
    apply_command_hint,
    build_dry_run_plan,
    load_seed_package,
)
from app.db import SupabaseDb  # noqa: E402
from app.errors import WorkerError, redact  # noqa: E402
from app.logging_setup import configure_logging, get_logger  # noqa: E402
from app.providers.openrouter import OpenRouterClient  # noqa: E402

logger = get_logger("worker.corpus.cli")

DEFAULT_CORPUS = "data/import/out/corpus.jsonl"
DEFAULT_META = "data/import/out/corpus-meta.json"


def _resolve_path(value: str) -> Path:
    """相对路径先按当前目录找，再退回仓库根目录（默认参数可直接从 worker/ 运行）。"""

    path = Path(value)
    if path.is_absolute():
        return path
    if path.exists():
        return path
    repo_relative = REPO_ROOT / path
    if repo_relative.exists():
        return repo_relative
    return path


def _print_json(payload: dict) -> None:
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _error_payload(mode: str, exc: BaseException) -> dict:
    # apply 失败时可能已写入部分 chunk/embedding；如实标 unknown，重复 --apply 可续跑。
    wrote: bool | None = False if mode == "dry-run" else None
    if isinstance(exc, WorkerError):
        return {
            "ok": False,
            "mode": mode,
            "wrote_database": wrote,
            "error": {
                "code": exc.code,
                "message": exc.safe_message,
                "retryable": exc.retryable,
            },
        }
    return {
        "ok": False,
        "mode": mode,
        "wrote_database": wrote,
        "error": {"code": "internal_error", "message": redact(type(exc).__name__, limit=160), "retryable": True},
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="知途（Campus Pathway）corpus seed（默认 dry-run）")
    parser.add_argument("--corpus", default=DEFAULT_CORPUS, help=f"corpus.jsonl 路径（默认 {DEFAULT_CORPUS}）")
    parser.add_argument("--meta", default=DEFAULT_META, help=f"corpus-meta.json 路径（默认 {DEFAULT_META}）")
    parser.add_argument("--profile-id", default=DEFAULT_PROFILE_ID, help=f"embedding profile id（默认 {DEFAULT_PROFILE_ID}）")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help=f"每批 embedding 条数（默认 {DEFAULT_BATCH_SIZE}，上限 16）",
    )
    parser.add_argument(
        "--progress-every",
        type=int,
        default=DEFAULT_PROGRESS_EVERY,
        help=f"每 N 批打印一次安全进度（默认 {DEFAULT_PROGRESS_EVERY}）",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--dry-run", action="store_true", help="只校验与打印计划（默认）")
    group.add_argument("--apply", action="store_true", help="真正写库并建立 embedding profile")
    args = parser.parse_args(argv)
    apply_mode = bool(args.apply)
    mode = "apply" if apply_mode else "dry-run"

    corpus_path = _resolve_path(args.corpus)
    meta_path = _resolve_path(args.meta)
    try:
        package = load_seed_package(corpus_path, meta_path)
    except WorkerError as exc:
        _print_json(_error_payload(mode, exc))
        return 1
    except Exception as exc:  # noqa: BLE001 - 本地文件错误只返回安全短消息
        _print_json(_error_payload(mode, exc))
        return 1

    if not apply_mode:
        try:
            plan = build_dry_run_plan(
                package,
                profile_id=args.profile_id,
                batch_size=args.batch_size,
                apply_command=apply_command_hint(
                    corpus=corpus_path,
                    meta=meta_path,
                    profile_id=args.profile_id,
                    batch_size=args.batch_size,
                ),
            )
        except WorkerError as exc:
            _print_json(_error_payload(mode, exc))
            return 1
        _print_json(plan)
        return 0 if plan["ok"] else 1

    # ---------- apply ----------
    try:
        config = Config.from_env()
    except WorkerError as exc:
        _print_json(_error_payload(mode, exc))
        return 2
    configure_logging(config.log_level)
    if config.model_monthly_budget_usd is None:
        payload = _error_payload(
            mode,
            WorkerError("MODEL_MONTHLY_BUDGET_USD 未设置：seed apply 会调用真实 embedding，必须显式配置月度预算"),
        )
        payload["error"]["code"] = "budget_exceeded"
        payload["error"]["retryable"] = False
        _print_json(payload)
        return 2

    budget = BudgetGuard(
        config.model_monthly_budget_usd,
        unknown_usage_reserve_usd=config.unknown_usage_reserve_usd,
        logger=logger,
    )
    db = SupabaseDb(config)
    provider = OpenRouterClient(config, budget=budget)
    try:
        service = CorpusSeedService(
            config=config,
            db=db,
            provider=provider,
            budget=budget,
            package=package,
            profile_id=args.profile_id,
            batch_size=args.batch_size,
            progress_every=args.progress_every,
        )
        result = service.apply()
        result["wrote_database"] = True
        _print_json(result)
        return 0
    except WorkerError as exc:
        _print_json(_error_payload(mode, exc))
        return 2
    except Exception as exc:  # noqa: BLE001 - 兜底：不打印 traceback/密钥
        _print_json(_error_payload(mode, exc))
        return 2
    finally:
        try:
            provider.close()
        finally:
            db.close()


if __name__ == "__main__":
    raise SystemExit(main())
