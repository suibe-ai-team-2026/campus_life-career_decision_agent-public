"""模型输出校验测试：JSON 提取、引用编号、数字/百分比一致性、越界丢弃、拒答文案。"""

from __future__ import annotations

import pytest

from app.errors import ModelOutputInvalid, OutputValidationError
from app.prompts import validate


def test_extract_json_object_handles_fences_and_prose():
    assert validate.extract_json_object('{"a":1}') == {"a": 1}
    assert validate.extract_json_object('```json\n{"a":1}\n```') == {"a": 1}
    assert validate.extract_json_object('说明文字 {"a": 2} 结束') == {"a": 2}
    with pytest.raises(ModelOutputInvalid):
        validate.extract_json_object("不是 JSON")
    with pytest.raises(ModelOutputInvalid):
        validate.extract_json_object('["数组不是对象"]')


def test_number_tokens_skip_citation_markers_and_identifiers():
    tokens = validate.number_tokens("见[1][2]，2024届落实率95.0%，规则版本 career-rules-2026-10-19.1")
    assert tokens == ["2024", "95%"]  # 95.0% 归一化为 95%（两侧一致）


def test_validate_numbers_requires_exact_evidence_match():
    evidence = ["2024届毕业生去向落实率为95.0%，数据来自报告原文。"]
    assert validate.validate_numbers("落实率为95.0%[1]。", evidence) == []
    assert validate.validate_numbers("落实率为96.0%[1]。", evidence) == ["96%"]
    # 证据中没有出现的年份同样算越界
    assert validate.validate_numbers("2023届显示同样结论[1]。", evidence) == ["2023"]


def test_numeric_sentences_must_have_citations():
    missing = validate.sentences_without_citation("就业率为95.0%。这一句没有数字。")
    assert len(missing) == 1 and "95.0%" in missing[0]
    assert validate.sentences_without_citation("就业率为95.0%[1]。") == []


def test_citation_numbers_validation():
    assert validate.validate_citation_numbers([1, 2], {1, 2}) == []
    assert validate.validate_citation_numbers([1, 9], {1}) == [9]


def test_parse_ask_output_valid_and_invalid():
    evidence = ["某报告：2024届毕业生去向落实率为95.0%。"]
    valid = validate.parse_ask_output(
        '{"answer":"2024届毕业生去向落实率为95.0%[1]","citation_numbers":[1],"no_evidence":false,"boundary_note":"仅覆盖2024届"}',
        valid_citations={1},
        evidence_texts=evidence,
    )
    assert valid.validation_reasons == []
    assert valid.citation_numbers == [1]
    assert valid.boundary_note == "仅覆盖2024届"

    invalid = validate.parse_ask_output(
        '{"answer":"就业率为99.9%[9]","citation_numbers":[9],"no_evidence":false,"boundary_note":""}',
        valid_citations={1},
        evidence_texts=evidence,
    )
    assert any("invalid_citation_numbers" in reason for reason in invalid.validation_reasons)
    assert any("numbers_not_in_evidence" in reason for reason in invalid.validation_reasons)

    with pytest.raises(OutputValidationError):
        validate.parse_ask_output(
            '{"answer":"x","citation_numbers":"not-a-list","no_evidence":false}',
            valid_citations={1},
            evidence_texts=evidence,
        )


def test_url_outside_evidence_is_rejected():
    assert validate.validate_urls("见 https://evil.example/doc", []) == ["https://evil.example/doc"]
    assert validate.validate_urls("见 https://official.example/doc", ["https://official.example/doc"]) == []


def test_parse_plan_explanation_reports_unknown_entities_and_numbers():
    raw = (
        '{"explanation":"新增课程《量化交易》并预计获得 9 学分[1]","cited_action_ids":["act-not-exist"],'
        '"citation_numbers":[1],"boundary_note":""}'
    )
    parsed = validate.parse_plan_explanation(
        raw,
        valid_citations={1},
        action_ids={"req-REQ001"},
        allowed_texts=["规则事实：国际贸易实务 3.0 学分"],
    )
    assert any("unknown_action_ids" in reason for reason in parsed.validation_reasons)
    assert any("numbers_not_in_facts" in reason for reason in parsed.validation_reasons)


def test_refusal_text_mentions_missing_topic_and_cohort():
    text = validate.build_refusal_text("2024届毕业生的就业率是多少？", evidence=[], reason="gate_failed")
    assert "2024" in text
    assert "官方统计" in text
    assert "不会用模型知识补全" in text


def test_deterministic_fallbacks_do_not_invent_numbers():
    explanation = validate.deterministic_plan_explanation(status="data_unavailable", gap_codes=["curriculum_unavailable"])
    assert "9" not in explanation
    assert "规则引擎" in explanation
    compare = validate.deterministic_compare_text([{"direction_id": "trade_supply_chain", "title": "国际贸易与供应链"}])
    assert "国际贸易与供应链" in compare
    assert "不做排名" in compare

def test_plan_explanation_cannot_add_quoted_entities():
    raw = '{"explanation":"新增课程《量化交易》[1]","cited_action_ids":[],"citation_numbers":[1],"boundary_note":""}'
    parsed = validate.parse_plan_explanation(
        raw,
        valid_citations={1},
        action_ids=set(),
        allowed_texts=["已有课程：《国际贸易实务》"],
        allowed_entity_titles=["国际贸易实务"],
    )
    assert any("unknown_entities" in reason for reason in parsed.validation_reasons)
    assert validate.quoted_entities("见《国际贸易实务》与「量化交易」") == ["国际贸易实务", "量化交易"]
    allowed = validate.parse_plan_explanation(
        '{"explanation":"课程《国际贸易实务》是已核验内容[1]","cited_action_ids":[],"citation_numbers":[1],"boundary_note":""}',
        valid_citations={1},
        action_ids=set(),
        allowed_texts=["已有课程：《国际贸易实务》"],
        allowed_entity_titles=["国际贸易实务"],
    )
    assert allowed.validation_reasons == []

def test_validate_numbers_tolerates_numeric_notation_variants():
    # 千分位与末尾零在数值上等价，不应把合法引用判成越界。
    assert validate.validate_numbers("2024届规模为3,928人[1]。", ["2024届规模为3928人。"]) == []
    assert validate.validate_numbers("落实率为95.60%[1]。", ["落实率为95.6%。"]) == []
    assert validate.validate_numbers("落实率为95.7%[1]。", ["落实率为95.6%。"]) == ["95.7%"]
