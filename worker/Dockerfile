# syntax=docker/dockerfile:1
# 知途（Campus Pathway）Python worker 镜像
# - Python 3.12（本机默认 3.14 不用于本项目）
# - 安装 Docling 及 OCR 所需系统库（libgl / poppler / CJK 字体）
# - 非 root 运行；不暴露任何端口，只主动 claim Supabase 队列
#
# Docling/OCR 模型缓存策略见 README「Docling / OCR 缓存」。
# 预下载模型（可选，镜像会变大）：
#   docker build --build-arg PREWARM_DOCLING=1 -t campus-pathway-worker .

FROM python:3.12-slim AS runtime

ARG PREWARM_DOCLING=0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_CACHE_DIR=/opt/uv-cache \
    PATH="/app/.venv/bin:${PATH}" \
    HF_HOME=/home/worker/.cache/huggingface \
    DOCLING_CACHE_DIR=/home/worker/.cache/docling \
    TMPDIR=/tmp

# Docling / OCR / PDF 所需系统依赖；fonts-noto-cjk 用于中文字体兜底（PDF 导出用
# reportlab 内置 STSong-Light CID 字体，不依赖系统字体，但 OCR/渲染链路需要 CJK 字体）。
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-noto-cjk \
        fontconfig \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        poppler-utils \
        libxml2 \
        libxslt1.1 \
        libjpeg62-turbo \
        zlib1g \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 worker \
    && useradd --uid 10001 --gid worker --create-home --shell /usr/sbin/nologin worker

# uv：在镜像内做可复现的 frozen 安装（uv.lock 已提交）。
COPY --from=ghcr.io/astral-sh/uv:0.11.23 /uv /uvx /usr/local/bin/

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
# 基础依赖 + Docling extra；dev 依赖（pytest）不装进运行镜像。
RUN uv sync --frozen --no-dev --extra docling

COPY app ./app
COPY scripts ./scripts
COPY worker.env.example ./worker.env.example

# 预下载 Docling/OCR 模型（可选；默认关闭，保持镜像体积可控）。
RUN if [ "$PREWARM_DOCLING" = "1" ]; then \
        python scripts/prewarm_docling.py; \
    fi \
    && mkdir -p /home/worker/.cache \
    && chown -R worker:worker /app /home/worker

USER worker

# 无公网端口：worker 通过 Supabase PostgREST 主动 claim/续租/发布。
HEALTHCHECK --interval=60s --timeout=20s --start-period=30s --retries=3 \
    CMD ["python", "-m", "app.runtime.worker", "--check"]

CMD ["python", "-m", "app.runtime.worker"]
