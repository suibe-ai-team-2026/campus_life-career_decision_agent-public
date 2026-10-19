#!/usr/bin/env python3
"""预下载 Docling / OCR 模型到 DOCLING_CACHE_DIR / HF_HOME。

默认不放进镜像构建（镜像会变大），由部署者选择：
- 构建期：docker build --build-arg PREWARM_DOCLING=1 ...
- 运行期：docker compose exec worker python scripts/prewarm_docling.py
- 裸机：sudo -u campus-pathway /opt/campus-pathway/worker/.venv/bin/python scripts/prewarm_docling.py

脚本只做「下载 + 转换一份自造的小 PDF」，不读取任何用户资料、不联网到 Supabase/OpenRouter。
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path


def main() -> int:
    try:
        from docling.document_converter import DocumentConverter  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        print(f"docling 未安装，无需预热：{type(exc).__name__}", file=sys.stderr)
        return 0
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption
    except Exception as exc:  # noqa: BLE001
        print(f"预热依赖不可用：{type(exc).__name__}", file=sys.stderr)
        return 1

    pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
    with tempfile.TemporaryDirectory(prefix="campus-pathway-prewarm-") as tmpdir:
        sample = Path(tmpdir) / "prewarm.pdf"
        pdf = canvas.Canvas(str(sample), pagesize=A4)
        pdf.setFont("STSong-Light", 14)
        pdf.drawString(72, 760, "知途 Campus Pathway 模型预热样例")
        pdf.drawString(72, 736, "This page is only used to download Docling layout/OCR models.")
        pdf.save()

        options = PdfPipelineOptions()
        options.do_ocr = True
        options.do_table_structure = True
        converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
        )
        result = converter.convert(str(sample))
        text = result.document.export_to_markdown()
        print(f"docling prewarm ok: model_cache={options.model_cache_dir if hasattr(options, 'model_cache_dir') else 'default'} chars={len(text)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
