"""切块：标题/段落优先，目标约 600 tokens，overlap 80 tokens，表格不拆表头。

token 估算说明（版本化 ``career-cjk-estimator-v1``）：
Qwen 系列中文分词大约 1 个汉字≈1 token，英文/数字约 4 字符≈1 token，标点约 2 个≈1 token。
这里用纯整数、可复现的估算，只用于切块与预算，不参与任何对用户展示的数字；
estimator 版本写入 locator，方便换模型后回归。真实 token 数由模型 usage 记录。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Any, Iterable

import jieba

from ..config import IngestConfig
from ..logging_setup import get_logger
from .parsers import ParsedSection

logger = get_logger("worker.ingest.chunking")

jieba.setLogLevel(40)  # WARNING，避免启动刷屏

CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
LATIN_RE = re.compile(r"[A-Za-z]")
DIGIT_RE = re.compile(r"[0-9]")
PUNCT_RE = re.compile(r"[\u3000-\u303f\uff00-\uffef!-/:-@\[-`{-~]")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[。！？；;!?])\s*")
TABLE_SEPARATOR_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$")


def estimate_tokens(text: str) -> int:
    """确定性 token 估算：CJK 1/字，拉丁 1/4 字符，数字 1/3 字符，标点 1/2。"""

    if not text:
        return 0
    cjk = len(CJK_RE.findall(text))
    latin = len(LATIN_RE.findall(text))
    digits = len(DIGIT_RE.findall(text))
    punct = len(PUNCT_RE.findall(text))
    return cjk + (latin + 3) // 4 + (digits + 2) // 3 + (punct + 1) // 2


def text_sha256(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()


@dataclass
class _Unit:
    text: str
    locator: dict[str, Any]
    heading_path: str
    block_type: str

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.text)


@dataclass
class ChunkDraft:
    ordinal: int
    text: str
    text_sha256: str
    locator: dict[str, Any]
    heading_path: str
    search_terms: str
    token_estimate: int
    block_type: str

    def to_row(
        self,
        *,
        source_version_id: str,
        owner_id: str | None,
        visibility: str,
        splitter_version: str,
    ) -> dict[str, Any]:
        return {
            "source_version_id": source_version_id,
            "owner_id": owner_id,
            "splitter_version": splitter_version,
            "ordinal": self.ordinal,
            "text": self.text,
            "text_sha256": self.text_sha256,
            "locator": self.locator,
            "heading_path": self.heading_path or None,
            "search_terms": self.search_terms,
            "visibility": visibility,
        }


def _split_oversized_unit(unit: _Unit, target_tokens: int) -> list[_Unit]:
    """超长段落按句子/字符硬切；只是切分原文，不改写内容。"""

    if unit.tokens <= target_tokens:
        return [unit]
    pieces: list[str] = []
    for sentence in SENTENCE_SPLIT_RE.split(unit.text) or [unit.text]:
        sentence = sentence.strip()
        if not sentence:
            continue
        if estimate_tokens(sentence) <= target_tokens:
            pieces.append(sentence)
            continue
        # 单句仍然超长：按字符累积到 target tokens 再切，不改写任何字符。
        current: list[str] = []
        for index, char in enumerate(sentence):
            current.append(char)
            if index % 16 == 15 or index == len(sentence) - 1:
                if estimate_tokens("".join(current)) >= target_tokens:
                    pieces.append("".join(current))
                    current = []
        if current:
            pieces.append("".join(current))
    return [
        _Unit(text=piece.strip(), locator=dict(unit.locator), heading_path=unit.heading_path, block_type=unit.block_type)
        for piece in pieces
        if piece.strip()
    ]


def _split_table(text: str, *, max_tokens: int) -> list[str]:
    """大表按行切，但每一段都重复表头行；小表保持整块。"""

    if estimate_tokens(text) <= max_tokens:
        return [text]
    lines = [line.rstrip() for line in text.splitlines() if line.strip()]
    if not lines:
        return []
    header: list[str] = [lines[0]]
    rows = lines[1:]
    if len(lines) >= 2 and TABLE_SEPARATOR_RE.match(lines[1]):
        header = [lines[0], lines[1]]
        rows = lines[2:]
    parts: list[str] = []
    current = list(header)
    for row in rows:
        candidate = "\n".join(current + [row])
        if len(current) > len(header) and estimate_tokens(candidate) > max_tokens:
            parts.append("\n".join(current))
            current = list(header) + [row]
        else:
            current.append(row)
    if len(current) > len(header):
        parts.append("\n".join(current))
    return parts or [text]


def _locator_for_units(units: list[_Unit], config: IngestConfig) -> dict[str, Any]:
    """合并 locator：页码范围 / 行号范围 / docx block 范围，绝不编造不存在的定位。"""

    locator: dict[str, Any] = {
        "token_estimator_version": config.token_estimator_version,
        "token_estimate": sum(unit.tokens for unit in units),
        "block_types": sorted({unit.block_type for unit in units}),
    }
    pages = [int(unit.locator["page"]) for unit in units if isinstance(unit.locator.get("page"), int)]
    if pages:
        locator.update({"kind": "page_range", "page_start": min(pages), "page_end": max(pages), "pages": sorted(set(pages))})
    line_starts = [int(unit.locator["line_start"]) for unit in units if isinstance(unit.locator.get("line_start"), int)]
    line_ends = [int(unit.locator["line_end"]) for unit in units if isinstance(unit.locator.get("line_end"), int)]
    if line_starts:
        locator.update(
            {
                "kind": "line_range",
                "line_start": min(line_starts),
                "line_end": max(line_ends) if line_ends else max(line_starts),
            }
        )
    blocks = [int(unit.locator["block"]) for unit in units if isinstance(unit.locator.get("block"), int)]
    if blocks:
        locator.update({"kind": "docx_block_range", "block_start": min(blocks), "block_end": max(blocks)})
    if "kind" not in locator:
        locator["kind"] = "document"
    return locator


def build_search_terms(text: str, *, max_chars: int = 8000) -> str:
    """search_terms = jieba 分词 + 中文二元字 + 原文小写。"""

    lowered = (text or "").lower()
    terms: list[str] = []
    seen: set[str] = set()

    def add(term: str) -> None:
        term = term.strip()
        if not term or term in seen:
            return
        seen.add(term)
        terms.append(term)

    for term in jieba.lcut(text or ""):
        if term.strip():
            add(term)
    for run in re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+", text or ""):
        if len(run) < 2:
            continue
        for index in range(len(run) - 1):
            add(run[index : index + 2])
    add(lowered)
    joined = " ".join(terms)
    return joined[:max_chars]


def chunk_sections(
    sections: Iterable[ParsedSection],
    *,
    config: IngestConfig,
    document_title: str = "",
) -> list[ChunkDraft]:
    """把解析后的 sections 切成目标 600 tokens / overlap 80 tokens 的块。"""

    units: list[_Unit] = []
    for section in sections:
        text = (section.text or "").strip()
        if not text:
            continue
        if section.block_type == "heading":
            # 标题只更新 heading_path，不单独成块。
            units.append(_Unit(text=text, locator=dict(section.locator), heading_path=section.heading_path, block_type="heading"))
            continue
        if section.block_type == "table":
            for part in _split_table(text, max_tokens=config.max_table_tokens):
                units.append(_Unit(text=part, locator=dict(section.locator), heading_path=section.heading_path, block_type="table"))
            continue
        base_unit = _Unit(text=text, locator=dict(section.locator), heading_path=section.heading_path, block_type=section.block_type)
        units.extend(_split_oversized_unit(base_unit, config.target_tokens))

    drafts: list[ChunkDraft] = []
    current: list[_Unit] = []
    current_tokens = 0
    current_heading = ""
    # 开头的 overlap 单元数量：当前块若只有 overlap 没有新内容，直接丢弃而不落库。
    overlap_prefix = 0

    def emit(carry_overlap: bool) -> None:
        nonlocal current, current_tokens, overlap_prefix
        body_units = [unit for unit in current if unit.block_type != "heading"]
        new_units = body_units[overlap_prefix:]
        if not new_units:
            current = []
            current_tokens = 0
            overlap_prefix = 0
            return
        text = "\n\n".join(unit.text for unit in body_units).strip()
        if not text:
            current = []
            current_tokens = 0
            overlap_prefix = 0
            return
        heading_path = next((unit.heading_path for unit in new_units if unit.heading_path), "")
        drafts.append(
            ChunkDraft(
                ordinal=len(drafts),
                text=text,
                text_sha256=text_sha256(text),
                locator=_locator_for_units(body_units, config),
                heading_path=heading_path,
                search_terms="",
                token_estimate=sum(unit.tokens for unit in body_units),
                block_type=new_units[0].block_type,
            )
        )
        if carry_overlap and config.overlap_tokens > 0:
            overlap: list[_Unit] = []
            tokens = 0
            for unit in reversed(new_units):
                if unit.block_type == "table":
                    break
                if tokens + unit.tokens > config.overlap_tokens:
                    break
                overlap.insert(0, unit)
                tokens += unit.tokens
            current = overlap
            current_tokens = tokens
            overlap_prefix = len(overlap)
        else:
            current = []
            current_tokens = 0
            overlap_prefix = 0

    for unit in units:
        if unit.block_type == "heading":
            if current:
                emit(carry_overlap=False)
            continue
        if unit.block_type == "table":
            if current:
                emit(carry_overlap=False)
            current = [unit]
            current_tokens = unit.tokens
            overlap_prefix = 0
            current_heading = unit.heading_path
            emit(carry_overlap=False)
            continue
        if current and current_heading and unit.heading_path != current_heading:
            emit(carry_overlap=False)
        if current and current_tokens + unit.tokens > config.target_tokens:
            emit(carry_overlap=True)
        current.append(unit)
        current_tokens += unit.tokens
        current_heading = unit.heading_path

    if current:
        emit(carry_overlap=False)

    # 过小的尾部块合并进前一块（不跨 heading），避免产生无意义碎片。
    merged: list[ChunkDraft] = []
    for draft in drafts:
        if (
            merged
            and len(draft.text) < config.min_chunk_chars
            and draft.heading_path == merged[-1].heading_path
            and estimate_tokens(merged[-1].text) + draft.token_estimate <= int(config.target_tokens * 1.2)
        ):
            previous = merged[-1]
            text = previous.text + "\n\n" + draft.text
            merged[-1] = ChunkDraft(
                ordinal=previous.ordinal,
                text=text,
                text_sha256=text_sha256(text),
                locator=previous.locator,
                heading_path=previous.heading_path,
                search_terms="",
                token_estimate=estimate_tokens(text),
                block_type=previous.block_type,
            )
        else:
            merged.append(draft)

    final: list[ChunkDraft] = []
    for index, draft in enumerate(merged):
        final.append(
            ChunkDraft(
                ordinal=index,
                text=draft.text,
                text_sha256=draft.text_sha256,
                locator=draft.locator,
                heading_path=draft.heading_path,
                search_terms=build_search_terms(draft.text),
                token_estimate=draft.token_estimate,
                block_type=draft.block_type,
            )
        )
    return final
