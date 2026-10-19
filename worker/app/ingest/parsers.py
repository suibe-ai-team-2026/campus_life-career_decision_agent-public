"""文档解析：Docling 优先，失败时降级 pypdf / python-docx。

原则：
- 页码/章节 locator 只记录解析器真实拿到的位置；机器提取文本没有页码就不写页码。
- 扫描件 / 缺页标 ``ocr`` 或 ``partial``，不伪造页数。
- Docling 不可用时明确记录 ``-fallback`` parser_version 与警告，提示运维在镜像里安装
  ``docling`` extra 并预下载 OCR 模型（见 README「Docling 缓存」）。
"""

from __future__ import annotations

import importlib.metadata
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ..errors import IngestError
from ..logging_setup import get_logger

logger = get_logger("worker.ingest.parsers")

TEXT_PARSER_VERSION = "textparser-2026-10-19.1"

MD_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
CJK_HEADING_RE = re.compile(
    r"^(?:第[一二三四五六七八九十百]+[章节篇]|[一二三四五六七八九十]+[、.]|"
    r"\d+(?:\.\d+){1,3}[、.\s]|\d+[、.](?!\d))\s*\S"
)


@dataclass
class ParsedSection:
    text: str
    locator: dict[str, Any] = field(default_factory=dict)
    heading_path: str = ""
    block_type: str = "paragraph"  # paragraph | heading | table | list


@dataclass
class ParseResult:
    sections: list[ParsedSection]
    parser_version: str
    extraction_status: str  # parsed | partial | ocr | failed
    warnings: list[str] = field(default_factory=list)
    pages_total: int | None = None
    pages_empty: tuple[int, ...] = ()
    used_fallback: bool = False
    docling_available: bool = False

    def char_count(self) -> int:
        return sum(len(section.text) for section in self.sections)


_DOCLING_IMPORT: bool | None = None


def docling_available() -> bool:
    global _DOCLING_IMPORT
    if _DOCLING_IMPORT is None:
        try:  # pragma: no cover - 取决于运行镜像是否安装 docling
            import docling.document_converter  # noqa: F401
            import docling.datamodel.pipeline_options  # noqa: F401

            _DOCLING_IMPORT = True
        except Exception:  # noqa: BLE001 - 缺依赖是预期情况，降级即可
            _DOCLING_IMPORT = False
    return bool(_DOCLING_IMPORT)


def _package_version(name: str) -> str:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:  # pragma: no cover
        return "unknown"


def detect_heading(line: str) -> tuple[bool, int, str]:
    """识别 markdown / 中文编号标题；返回 (是否标题, 级别, 标题文本)。"""

    text = line.strip()
    if not text or len(text) > 120:
        return False, 0, ""
    match = MD_HEADING_RE.match(text)
    if match:
        return True, len(match.group(1)), match.group(2).strip()
    if CJK_HEADING_RE.match(text):
        return True, 2, text
    return False, 0, ""


def _heading_path(stack: list[tuple[int, str]]) -> str:
    return " / ".join(title for _, title in stack if title)


def _push_heading(stack: list[tuple[int, str]], level: int, title: str) -> None:
    while stack and stack[-1][0] >= max(1, level):
        stack.pop()
    stack.append((max(1, level), title.strip()))


def split_paragraphs(text: str) -> list[str]:
    return [block.strip() for block in re.split(r"\n\s*\n", text) if block and block.strip()]


def _is_markdown_table_line(line: str) -> bool:
    stripped = line.strip()
    return stripped.startswith("|") and stripped.count("|") >= 2


def _table_markdown(rows: list[list[str]]) -> str:
    def escape(cell: str) -> str:
        return cell.strip().replace("|", "\\|").replace("\n", " ")

    if not rows:
        return ""
    header = "| " + " | ".join(escape(cell) for cell in rows[0]) + " |"
    separator = "| " + " | ".join("---" for _ in rows[0]) + " |"
    body = ["| " + " | ".join(escape(cell) for cell in row) + " |" for row in rows[1:]]
    return "\n".join([header, separator, *body])


def _pdf_empty_pages(path: Path) -> tuple[int, int] | None:
    """用 pypdf 交叉检查哪些 PDF 页没有可提取文本（用于识别扫描件/OCR）。"""

    try:
        from pypdf import PdfReader
    except Exception:  # noqa: BLE001
        return None
    try:
        reader = PdfReader(str(path))
        empty: list[int] = []
        for number, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:  # noqa: BLE001 - 单页解析失败按空页处理
                text = ""
            if not text.strip():
                empty.append(number)
        return len(reader.pages), tuple(empty)  # type: ignore[return-value]
    except Exception:  # noqa: BLE001
        return None


def _docling_item_text(item: Any, document: Any) -> str:
    for export_name in ("export_to_markdown", "export_to_text"):
        export = getattr(item, export_name, None)
        if callable(export):
            try:
                value = export(document) if export_name == "export_to_markdown" else export()
                if value:
                    return str(value)
            except Exception:  # noqa: BLE001 - 不同 docling 版本签名不同
                continue
    text = getattr(item, "text", "")
    return str(text or "")


def _docling_label(item: Any) -> str:
    label = getattr(item, "label", "")
    name = getattr(label, "value", label)
    return str(name or "").lower()


def _docling_page(item: Any) -> int | None:
    prov = getattr(item, "prov", None) or []
    for prov_item in prov:
        page_no = getattr(prov_item, "page_no", None)
        if isinstance(page_no, int) and page_no > 0:
            return page_no
    return None


def _convert_with_docling(path: Path, *, is_pdf: bool) -> Any:
    """返回 docling Document 对象；调用方负责异常与降级。"""

    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    format_options = {}
    if is_pdf:
        options = PdfPipelineOptions()
        options.do_ocr = True
        options.do_table_structure = True
        format_options[InputFormat.PDF] = PdfFormatOption(pipeline_options=options)
    converter = DocumentConverter(format_options=format_options)
    result = converter.convert(str(path))
    return result.document


def _parse_with_docling(path: Path, *, is_pdf: bool) -> ParseResult:
    document = _convert_with_docling(path, is_pdf=is_pdf)
    version = f"docling-{_package_version('docling')}"
    sections: list[ParsedSection] = []
    stack: list[tuple[int, str]] = []
    horizontal_pages: set[int] = set()

    pages_attr = getattr(document, "pages", None)
    pages_total = len(pages_attr) if pages_attr is not None else None

    try:
        iterator = document.iterate_items()
    except AttributeError:  # pragma: no cover - 旧版 docling
        iterator = iter([])

    for entry in iterator:
        if isinstance(entry, tuple) and len(entry) == 2:
            item, level = entry
        else:  # pragma: no cover - 兼容不同版本
            item, level = entry, 0
        label = _docling_label(item)
        text = _docling_item_text(item, document).strip()
        if not text:
            continue
        page = _docling_page(item)
        if page is not None:
            horizontal_pages.add(page)
        if label in {"section_header", "title", "page_header"}:
            heading_level = int(getattr(item, "level", 0) or 0) or max(1, int(level or 1))
            title = text.splitlines()[0].strip()
            _push_heading(stack, heading_level, title)
            sections.append(
                ParsedSection(
                    text=title,
                    locator={"kind": "page", "page": page} if page else {"kind": "document"},
                    heading_path=_heading_path(stack[:-1]),
                    block_type="heading",
                )
            )
            continue
        block_type = "table" if "table" in label else ("list" if "list" in label else "paragraph")
        locator: dict[str, Any] = {"kind": "page", "page": page} if page else {"kind": "document"}
        sections.append(
            ParsedSection(
                text=text,
                locator=locator,
                heading_path=_heading_path(stack),
                block_type=block_type,
            )
        )

    warnings: list[str] = []
    extraction_status = "parsed"
    pages_empty: tuple[int, ...] = ()
    if is_pdf:
        cross_check = _pdf_empty_pages(path)
        if cross_check is not None:
            pages_total, pages_empty = cross_check
            if pages_empty:
                warnings.append("scanned_or_empty_pages_ocr")
                extraction_status = "ocr"
                logger.warning("docling_ocr_used pages_empty=%s pages_total=%s", len(pages_empty), pages_total)
    if not sections:
        return ParseResult(
            sections=[],
            parser_version=version,
            extraction_status="failed",
            warnings=["docling_no_text"],
            pages_total=pages_total,
            pages_empty=pages_empty,
            used_fallback=False,
            docling_available=True,
        )
    return ParseResult(
        sections=sections,
        parser_version=version,
        extraction_status=extraction_status,
        warnings=warnings,
        pages_total=pages_total,
        pages_empty=pages_empty,
        used_fallback=False,
        docling_available=True,
    )


def _parse_pdf_with_pypdf(path: Path) -> ParseResult:
    from pypdf import PdfReader

    version = f"pypdf-{_package_version('pypdf')}-fallback"
    reader = PdfReader(str(path))
    pages_total = len(reader.pages)
    sections: list[ParsedSection] = []
    empty_pages: list[int] = []
    stack: list[tuple[int, str]] = []
    for number, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:  # noqa: BLE001
            text = ""
        if not text.strip():
            empty_pages.append(number)
            continue
        for paragraph in split_paragraphs(text):
            lines = paragraph.splitlines()
            # 段落内的编号标题单独拆开，保证 heading_path 可信。
            buffer: list[str] = []
            for line in lines:
                is_heading, level, title = detect_heading(line)
                if is_heading:
                    if buffer:
                        sections.append(
                            ParsedSection(
                                text="\n".join(buffer).strip(),
                                locator={"kind": "page", "page": number},
                                heading_path=_heading_path(stack),
                                block_type="paragraph",
                            )
                        )
                        buffer = []
                    _push_heading(stack, level, title)
                    sections.append(
                        ParsedSection(
                            text=title,
                            locator={"kind": "page", "page": number},
                            heading_path=_heading_path(stack[:-1]),
                            block_type="heading",
                        )
                    )
                else:
                    buffer.append(line)
            if buffer:
                text_block = "\n".join(buffer).strip()
                if text_block:
                    sections.append(
                        ParsedSection(
                            text=text_block,
                            locator={"kind": "page", "page": number},
                            heading_path=_heading_path(stack),
                            block_type="paragraph",
                        )
                    )
    status = "parsed"
    warnings: list[str] = ["docling_unavailable_or_failed"]
    if empty_pages:
        warnings.append("scanned_or_empty_pages")
        status = "partial" if len(empty_pages) < pages_total else "ocr"
    return ParseResult(
        sections=sections,
        parser_version=version,
        extraction_status=status if sections else ("ocr" if empty_pages else "failed"),
        warnings=warnings,
        pages_total=pages_total,
        pages_empty=tuple(empty_pages),
        used_fallback=True,
        docling_available=docling_available(),
    )


def _parse_docx_with_python_docx(path: Path) -> ParseResult:
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    version = f"python-docx-{_package_version('python-docx')}-fallback"
    document = Document(str(path))
    body = document.element.body
    stack: list[tuple[int, str]] = []
    sections: list[ParsedSection] = []
    block_index = 0
    for child in body.iterchildren():
        tag = str(child.tag).rsplit("}", 1)[-1]
        if tag == "p":
            paragraph = Paragraph(child, document)
            text = (paragraph.text or "").strip()
            if not text:
                continue
            block_index += 1
            style = ""
            try:
                style = (paragraph.style.name or "") if paragraph.style is not None else ""
            except Exception:  # noqa: BLE001
                style = ""
            heading_match = re.match(r"(?i)heading\s*(\d+)|标题\s*(\d+)", style)
            if heading_match:
                level = int(heading_match.group(1) or heading_match.group(2) or 1)
                _push_heading(stack, level, text)
                sections.append(
                    ParsedSection(
                        text=text,
                        locator={"kind": "docx_block", "block": block_index},
                        heading_path=_heading_path(stack[:-1]),
                        block_type="heading",
                    )
                )
            else:
                sections.append(
                    ParsedSection(
                        text=text,
                        locator={"kind": "docx_block", "block": block_index},
                        heading_path=_heading_path(stack),
                        block_type="paragraph",
                    )
                )
        elif tag == "tbl":
            table = Table(child, document)
            rows = [[cell.text or "" for cell in row.cells] for row in table.rows]
            if not rows:
                continue
            block_index += 1
            sections.append(
                ParsedSection(
                    text=_table_markdown(rows),
                    locator={"kind": "docx_block", "block": block_index},
                    heading_path=_heading_path(stack),
                    block_type="table",
                )
            )
    if not sections:
        return ParseResult(
            sections=[],
            parser_version=version,
            extraction_status="failed",
            warnings=["docx_no_text"],
            used_fallback=True,
            docling_available=docling_available(),
        )
    return ParseResult(
        sections=sections,
        parser_version=version,
        extraction_status="partial",
        warnings=["docling_unavailable_or_failed"],
        used_fallback=True,
        docling_available=docling_available(),
    )


def parse_text_document(path: Path) -> ParseResult:
    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
        encoding = "utf-8"
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")
        encoding = "utf-8-replace"
    warnings: list[str] = []
    if "\ufffd" in text:
        warnings.append("text_decode_replaced_chars")
    if path.suffix.lower() in {".md", ".markdown"}:
        sections = _parse_markdown_text(text)
    else:
        sections = _parse_plain_text(text)
    status = "parsed" if sections and not warnings else ("partial" if sections else "failed")
    return ParseResult(
        sections=sections,
        parser_version=f"{TEXT_PARSER_VERSION}+{encoding}",
        extraction_status=status,
        warnings=warnings,
    )


def _parse_markdown_text(text: str) -> list[ParsedSection]:
    sections: list[ParsedSection] = []
    stack: list[tuple[int, str]] = []
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index]
        line_no = index + 1
        if _is_markdown_table_line(line):
            table_lines: list[str] = []
            while index < len(lines) and _is_markdown_table_line(lines[index]):
                table_lines.append(lines[index].strip())
                index += 1
            sections.append(
                ParsedSection(
                    text="\n".join(table_lines),
                    locator={"kind": "line_range", "line_start": line_no, "line_end": index},
                    heading_path=_heading_path(stack),
                    block_type="table",
                )
            )
            continue
        is_heading, level, title = detect_heading(line)
        if is_heading:
            _push_heading(stack, level, title)
            sections.append(
                ParsedSection(
                    text=title,
                    locator={"kind": "line", "line": line_no},
                    heading_path=_heading_path(stack[:-1]),
                    block_type="heading",
                )
            )
            index += 1
            continue
        # 收集到空行为止，作为一个段落。
        paragraph_lines: list[str] = []
        start_line = line_no
        while index < len(lines) and lines[index].strip() and not detect_heading(lines[index])[0] and not _is_markdown_table_line(lines[index]):
            paragraph_lines.append(lines[index])
            index += 1
        paragraph = "\n".join(paragraph_lines).strip()
        if paragraph:
            sections.append(
                ParsedSection(
                    text=paragraph,
                    locator={"kind": "line_range", "line_start": start_line, "line_end": index},
                    heading_path=_heading_path(stack),
                    block_type="paragraph",
                )
            )
        elif index < len(lines):
            index += 1
    return sections


def _parse_plain_text(text: str) -> list[ParsedSection]:
    sections: list[ParsedSection] = []
    stack: list[tuple[int, str]] = []
    line_cursor = 1
    for block in re.split(r"\n\s*\n", text):
        if not block.strip():
            line_cursor += block.count("\n") + 1
            continue
        start = line_cursor
        end = line_cursor + block.count("\n")
        first_line = block.strip().splitlines()[0]
        is_heading, level, title = detect_heading(first_line)
        if is_heading and len(block.strip().splitlines()) == 1:
            _push_heading(stack, level, title)
            sections.append(
                ParsedSection(
                    text=title,
                    locator={"kind": "line", "line": start},
                    heading_path=_heading_path(stack[:-1]),
                    block_type="heading",
                )
            )
        else:
            sections.append(
                ParsedSection(
                    text=block.strip(),
                    locator={"kind": "line_range", "line_start": start, "line_end": end},
                    heading_path=_heading_path(stack),
                    block_type="paragraph",
                )
            )
        line_cursor = end + 2
    return sections


def parse_document(path: Path, *, mime_type: str | None = None) -> ParseResult:
    """按扩展名/MIME 选择解析器；Docling 优先，失败降级并记录 fallback 版本。"""

    if not path.exists() or path.stat().st_size == 0:
        raise IngestError("源文件为空或不存在")
    suffix = path.suffix.lower()
    mime = (mime_type or "").lower()
    is_pdf = suffix == ".pdf" or mime == "application/pdf"
    is_docx = suffix == ".docx" or mime.endswith("wordprocessingml.document")
    if is_pdf:
        if docling_available():
            try:
                return _parse_with_docling(path, is_pdf=True)
            except Exception as exc:  # noqa: BLE001 - 降级是预期路径
                logger.warning("docling_pdf_failed fallback=pypdf error=%s", type(exc).__name__)
        return _parse_pdf_with_pypdf(path)
    if is_docx:
        if docling_available():
            try:
                return _parse_with_docling(path, is_pdf=False)
            except Exception as exc:  # noqa: BLE001
                logger.warning("docling_docx_failed fallback=python-docx error=%s", type(exc).__name__)
        return _parse_docx_with_python_docx(path)
    if suffix in {".md", ".markdown", ".txt"} or mime.startswith("text/"):
        return parse_text_document(path)
    raise IngestError(f"不支持的文件类型：{suffix or mime}")
