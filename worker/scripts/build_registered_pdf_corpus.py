#!/usr/bin/env python3
"""把已登记在 app_source_versions.metadata.document.repo_path 的 PDF 抽成检索语料段。

用途：研究快照里有 33 份官方 PDF（培养方案 / 本科教学质量报告）只登记了元数据，
没有进入 embedding corpus，导致问答只能回答"正文未收录"。本脚本用 `pdftotext -layout`
逐页提取文本，按章节对齐切块（每块 ≤1200 字符），输出可直接并入 corpus 的 JSONL。

只读：仅通过 Supabase REST 读取 source/version 元数据，不写数据库；不调用模型。
用法：
    cd worker
    SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
      uv run --python 3.12 python scripts/build_registered_pdf_corpus.py \
        --snapshot-root ../smart-campus-career/data/research \
        --out-dir ../data/import/out

输出：
    <out-dir>/registered-pdf-chunks.jsonl
    <out-dir>/registered-pdf-manifest.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

SPLITTER_VERSION = "career-splitter-2026-10-19.1"
TARGET_CHARS = 950
MAX_CHARS = 1200
MIN_CHARS = 40
SECTION_RE = re.compile(r"^\s*([一二三四五六七八九十百]+、|第[一二三四五六七八九十]+[章节]|（[一二三四五六七八九十]+）)")


def supabase_get(path: str) -> list[dict]:
    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SECRET_KEY"]
    request = urllib.request.Request(
        f"{base}/rest/v1/{path}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read())


def load_registered_pdf_versions() -> list[tuple[dict, dict, str]]:
    sources = {row["source_id"]: row for row in supabase_get(
        "app_sources?select=source_id,title,source_scope,verification_status&limit=2000"
    )}
    versions = supabase_get(
        "app_source_versions?select=source_version_id,source_id,extraction_status,metadata&limit=2000"
    )
    items: list[tuple[dict, dict, str]] = []
    for version in versions:
        documents = (version.get("metadata") or {}).get("document") or []
        if isinstance(documents, dict):
            documents = [documents]
        for document in documents:
            repo_path = str((document or {}).get("repo_path") or "")
            if repo_path.lower().endswith(".pdf"):
                items.append((sources.get(version["source_id"], {}), version, repo_path))
                break
    return items


def pdf_pages(pdf_path: Path) -> list[str]:
    raw = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8", errors="replace")
    return raw.split("\f")


def paragraphs(page_text: str) -> list[str]:
    paragraphs_out: list[str] = []
    buffer: list[str] = []
    for line in (line.rstrip() for line in page_text.splitlines()):
        if not line.strip():
            if buffer:
                paragraphs_out.append("\n".join(buffer))
                buffer = []
            continue
        buffer.append(line)
    if buffer:
        paragraphs_out.append("\n".join(buffer))
    return [item.strip() for item in paragraphs_out if item.strip()]


def split_long(text: str) -> list[str]:
    if len(text) <= MAX_CHARS:
        return [text]
    parts: list[str] = []
    rest = text
    while len(rest) > MAX_CHARS:
        cut = rest.rfind("\n", 0, MAX_CHARS)
        if cut < MAX_CHARS // 2:
            cut = MAX_CHARS
        parts.append(rest[:cut].strip())
        rest = rest[cut:].strip()
    if rest:
        parts.append(rest)
    return parts


def chunk_page(page_text: str) -> list[tuple[str, str | None]]:
    """章节对齐切块：标题行开启新块，避免课程清单被毕业要求表格稀释。"""

    chunks: list[tuple[str, str | None]] = []
    current = ""
    section: str | None = None
    for paragraph in paragraphs(page_text):
        first_line = paragraph.splitlines()[0] if paragraph else ""
        header = first_line.strip() if SECTION_RE.match(first_line) else None
        if header:
            if current:
                for piece in split_long(current):
                    chunks.append((piece, section))
                current = ""
            section = header[:80]
        if not current:
            current = paragraph
        elif len(current) + 2 + len(paragraph) <= TARGET_CHARS:
            current = f"{current}\n{paragraph}"
        else:
            for piece in split_long(current):
                chunks.append((piece, section))
            current = paragraph
    if current:
        for piece in split_long(current):
            chunks.append((piece, section))
    merged: list[tuple[str, str | None]] = []
    for text, section in chunks:
        if merged and len(text) < MIN_CHARS and len(merged[-1][0]) + len(text) <= MAX_CHARS:
            previous_text, previous_section = merged[-1]
            merged[-1] = (f"{previous_text}\n{text}", previous_section or section)
        else:
            merged.append((text, section))
    return [(text, section) for text, section in merged if len(text) >= MIN_CHARS]


def search_terms(*, title: str, scope: str, section: str | None, text: str) -> str:
    # 词法分支依赖空格分隔的检索词；这里保留标题/口径/章节 + 中文二元字，避免长句单一 lexeme。
    terms = [title, scope] + ([section] if section else [])
    seen: set[str] = set()
    for run in re.findall(r"[\u4e00-\u9fff]{2,}", text):
        for index in range(len(run) - 1):
            bigram = run[index : index + 2]
            if bigram not in seen:
                seen.add(bigram)
                terms.append(bigram)
    for token in re.findall(r"[A-Za-z]{2,}", text):
        if token.lower() not in seen:
            seen.add(token.lower())
            terms.append(token.lower())
    return " ".join(term for term in terms if term)[:4000]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot-root", required=True, help="研究快照仓库 data/research 目录")
    parser.add_argument("--out-dir", default="../data/import/out")
    parser.add_argument("--limit", type=int, default=0, help="仅处理前 N 份 PDF（调试用）")
    args = parser.parse_args()

    snapshot_root = Path(args.snapshot_root).resolve()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    items = load_registered_pdf_versions()
    if args.limit:
        items = items[: args.limit]
    print(f"registered PDF sources: {len(items)}")

    lines: list[dict] = []
    manifest_sources: list[dict] = []
    for source, version, repo_path in items:
        relative = repo_path.split("data/research/", 1)[-1] if "data/research/" in repo_path else repo_path
        pdf_path = snapshot_root / relative
        if not pdf_path.exists():
            print(f"SKIP missing {repo_path}")
            continue
        title = str(source.get("title") or "")
        scope = str(source.get("source_scope") or "")
        verification = str(version.get("extraction_status") or "partial")
        pdf_sha = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
        ordinal = 0
        for page_number, page_text in enumerate(pdf_pages(pdf_path), start=1):
            for chunk_text, section in chunk_page(page_text):
                lines.append(
                    {
                        "source_id": version["source_id"],
                        "source_version_id": version["source_version_id"],
                        "source_title": title,
                        "source_scope": scope,
                        "verification_status": verification,
                        "splitter_version": SPLITTER_VERSION,
                        "ordinal": ordinal,
                        "chunk_text": chunk_text,
                        "chars": len(chunk_text),
                        "sha256": hashlib.sha256(chunk_text.encode("utf-8")).hexdigest(),
                        "heading_path": title if not section else f"{title} > {section}",
                        "search_terms": search_terms(title=title, scope=scope, section=section, text=chunk_text),
                        "locator": {
                            "kind": "pdf_text_extraction",
                            "file": repo_path,
                            "source_pdf": repo_path,
                            "source_pdf_sha256": pdf_sha,
                            "page": page_number,
                            "page_note": "pdftotext -layout 逐页提取；page 为 PDF 物理页码",
                        },
                    }
                )
                ordinal += 1
        if ordinal:
            manifest_sources.append(
                {
                    "source_id": version["source_id"],
                    "source_version_id": version["source_version_id"],
                    "title": title,
                    "chunks": ordinal,
                }
            )
            print(f"{ordinal:3d} chunks  {title[:50]}")

    corpus = "".join(json.dumps(line, ensure_ascii=False) + "\n" for line in lines)
    chunk_path = out_dir / "registered-pdf-chunks.jsonl"
    chunk_path.write_text(corpus, encoding="utf-8")
    manifest = {
        "splitter_version": SPLITTER_VERSION,
        "chunks": len(lines),
        "chars": sum(len(line["chunk_text"]) for line in lines),
        "sha256": hashlib.sha256(corpus.encode("utf-8")).hexdigest(),
        "sources": manifest_sources,
        "notes": [
            "本文件只是 PDF 抽出的额外语料段，不单独构成完整 corpus；需并入现有 corpus 后走 worker seed。",
            "不改变 app_courses / 学分 / 先修等结构化结论；verification_status 沿用来源版本状态。",
        ],
    }
    (out_dir / "registered-pdf-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nchunks={len(lines)} chars={manifest['chars']} sha256={manifest['sha256']}")
    print(f"output: {chunk_path}")


if __name__ == "__main__":
    main()
