"""配置测试：必填项、维度约束、预算 fail closed、密钥不打印。"""

from __future__ import annotations

import pytest

from app.budget import BudgetGuard
from app.config import Config, GATE_VERSION
from app.errors import BudgetExceeded, ConfigError
from tests.fakes import BASE_ENV, make_config


def test_defaults_are_frozen_and_correct():
    config = make_config()
    assert config.embedding_model == "qwen/qwen3-embedding-8b"
    assert config.embedding_dimensions == 4096
    assert config.embedding_normalization == "l2"
    assert config.embedding_query_template_version == "career-qwen-v1"
    assert config.embedding_batch_size == 16
    assert config.chat_provider == "deepseek"
    assert config.chat_base_url == "https://api.deepseek.com"
    assert config.chat_model == "deepseek-flash"
    assert config.plan_reasoning_model == "deepseek-v4-pro"
    assert config.plan_reasoning_effort == "high"
    assert config.worker_concurrency == 1
    assert config.retrieval.rrf_k == 60
    assert config.retrieval.evidence_char_budget == 7000
    assert config.retrieval.gate_version == GATE_VERSION
    assert config.ingest.target_tokens == 600
    assert config.ingest.overlap_tokens == 80


def test_query_template_contains_instruction_and_question():
    config = make_config()
    rendered = config.query_template().format(question="国贸专业要学什么？")
    assert rendered.startswith("Instruct: Given a campus career planning question")
    assert rendered.endswith("Query: 国贸专业要学什么？")


def test_missing_required_env_fails_fast():
    env = dict(BASE_ENV)
    env.pop("OPENROUTER_API_KEY")
    with pytest.raises(ConfigError):
        Config.from_env(env)
    env = dict(BASE_ENV)
    env.pop("SUPABASE_SECRET_KEY")
    with pytest.raises(ConfigError):
        Config.from_env(env)


def test_embedding_dimensions_must_be_4096():
    with pytest.raises(ConfigError):
        make_config(EMBEDDING_DIMENSIONS="512")


def test_secrets_never_appear_in_repr_or_summary():
    config = make_config()
    dump = repr(config) + str(config.safe_summary())
    assert BASE_ENV["SUPABASE_SECRET_KEY"] not in dump
    assert BASE_ENV["OPENROUTER_API_KEY"] not in dump
    assert config.safe_summary()["has_openrouter_api_key"] is True


def test_worker_concurrency_above_one_rejected():
    with pytest.raises(ConfigError):
        make_config(WORKER_CONCURRENCY="2")


def test_unset_budget_is_not_infinite():
    config = make_config(MODEL_MONTHLY_BUDGET_USD="")
    assert config.model_monthly_budget_usd is None
    guard = BudgetGuard(config.model_monthly_budget_usd)
    with pytest.raises(BudgetExceeded):
        guard.assert_can_spend(None, operation="test")

def test_cli_check_fails_closed_without_budget(monkeypatch, capsys):
    from app.runtime.worker import main

    for key, value in BASE_ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("MODEL_MONTHLY_BUDGET_USD", "2.50")
    assert main(["--check"]) == 0
    output = capsys.readouterr().out
    assert BASE_ENV["OPENROUTER_API_KEY"] not in output
    assert BASE_ENV["SUPABASE_SECRET_KEY"] not in output

    monkeypatch.delenv("MODEL_MONTHLY_BUDGET_USD")
    assert main(["--check"]) == 2

def test_default_embedding_profile_id_is_stable_and_matches_env_example():
    assert make_config().embedding_profile_id == "career-qwen3-embedding-8b-4096-career-qwen-v1"
