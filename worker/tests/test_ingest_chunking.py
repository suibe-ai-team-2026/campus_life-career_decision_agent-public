"""切块测试：token 估算、overlap、标题边界、表格保表头、search_terms、locator。"""

from __future__ import annotations

from app.config import IngestConfig
from app.ingest.chunking import (
    build_search_terms,
    chunk_sections,
    estimate_tokens,
    text_sha256,
)
from app.ingest.parsers import ParsedSection

INGEST = IngestConfig()


def _section(text: str, *, page: int | None = 1, heading: str = "", block_type: str = "paragraph") -> ParsedSection:
    locator = {"kind": "page", "page": page} if page is not None else {"kind": "line", "line": 1}
    return ParsedSection(text=text, locator=locator, heading_path=heading, block_type=block_type)


def _paragraphs(count: int, size: int = 60, prefix: str = "段") -> list[str]:
    return [f"{prefix}{index:02d}" + "贸" * size for index in range(count)]


def test_estimator_is_deterministic_and_handles_chinese():
    assert estimate_tokens("") == 0
    assert estimate_tokens("国") == 1
    assert estimate_tokens("国际贸易") == 4
    assert estimate_tokens("国际经济与贸易实务") == 9
    assert estimate_tokens("hello world") >= 2
    assert estimate_tokens("国际贸易实务") == estimate_tokens("国际贸易实务")


def test_chunks_respect_target_and_overlap():
    paragraphs = _paragraphs(20)
    chunks = chunk_sections([_section(text) for text in paragraphs], config=INGEST)
    assert len(chunks) >= 2
    # 每块不因普通段落显著超过目标（允许一个单元的自然超出）
    assert all(chunk.token_estimate <= INGEST.target_tokens + 120 for chunk in chunks)
    # 相邻块共享前一块末尾段落（overlap ≤ 80 tokens）
    first, second = chunks[0], chunks[1]
    overlap_unit = first.text.split("\n\n")[-1]
    assert overlap_unit != ""
    assert second.text.startswith(overlap_unit)
    assert first.ordinal == 0 and second.ordinal == 1
    # ordinal 连续、sha256 与文本一致
    assert [chunk.ordinal for chunk in chunks] == list(range(len(chunks)))
    assert chunks[0].text_sha256 == text_sha256(chunks[0].text)


def test_chunk_contains_no_duplicate_when_section_changes():
    sections = [
        _section("第一章 总则", heading="", block_type="heading"),
        _section("第一章下的正文段落。" * 12, heading="第一章 总则"),
        _section("第二章 课程", heading="第一章 总则", block_type="heading"),
        _section("第二章下的正文段落。" * 12, heading="第一章 总则 / 第二章 课程"),
    ]
    chunks = chunk_sections(sections, config=INGEST)
    assert len(chunks) == 2
    assert chunks[0].heading_path.startswith("第一章 总则")
    assert chunks[1].heading_path == "第一章 总则 / 第二章 课程"
    # 不同章节不继承 overlap，正文不重复
    assert chunks[1].text.startswith("第二章下的正文段落。")


def test_small_table_is_atomic_and_kept_with_header():
    table = "\n".join(
        [
            "| 课程 | 学分 |",
            "| --- | --- |",
            "| 国际贸易实务 | 3 |",
            "| 国际市场营销 | 2.5 |",
        ]
    )
    chunks = chunk_sections([_section(table, block_type="table")], config=INGEST)
    assert len(chunks) == 1
    assert "| 课程 | 学分 |" in chunks[0].text
    assert "国际市场营销" in chunks[0].text
    assert chunks[0].locator["block_types"] == ["table"]


def test_large_table_splits_but_repeats_header_row():
    rows = ["| 课程 | 学分 |", "| --- | --- |"]
    rows.extend(f"| 课程{index} | {index} |" for index in range(400))
    chunk_config = IngestConfig(max_table_tokens=200)
    chunks = chunk_sections([_section("\n".join(rows), block_type="table")], config=chunk_config)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.text.startswith("| 课程 | 学分 |")
        assert "| --- | --- |" in chunk.text.splitlines()[1]


def test_search_terms_include_jieba_bigram_and_lowercased_text():
    terms = build_search_terms("毕业生就业质量 Course XYZ")
    assert "国际" not in terms  # 不相关
    assert "毕业" in terms  # 中文二元字
    assert "course xyz" in terms  # 原文小写
    assert "毕业生" in terms  # jieba 词


def test_locator_preserves_real_page_range():
    sections = [
        _section("第一页内容。" * 8, page=3),
        _section("第二页内容。" * 8, page=4),
    ]
    chunks = chunk_sections(sections, config=INGEST)
    assert len(chunks) == 1
    locator = chunks[0].locator
    assert locator["kind"] == "page_range"
    assert locator["page_start"] == 3 and locator["page_end"] == 4
    assert locator["token_estimator_version"] == "career-cjk-estimator-v1"
