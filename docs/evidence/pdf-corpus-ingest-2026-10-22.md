# 已登记 PDF 全文入库（corpus v2 · 2026-10-22）

## 1. 背景

用户反馈「主产品 agent 回答不出来完整的信息」。实测（2026-10-22）：

- 问「本专业的培养方案里有哪些与国际贸易相关的课程？」→ 拒答「当前语料缺少：培养方案/课程目录类可核验内容」。
- 问「学校公开的就业质量报告里如何描述毕业生去向？」→ 只能给出报告目录与后记，正文缺失。

根因在语料层：`app_source_versions` 里 **33 份 PDF**（32 份专业人才培养方案 + 1 份本科教学质量报告）此前只登记了标题、URL、哈希与核验状态，`extraction_status=partial`，**没有进入 embedding corpus**；检索只能命中「【来源登记】…本卡片不包含网页正文」的来源卡，模型无法回答课程、学分、正文类问题。

## 2. 数据范围与边界的保持

- 只使用研究快照仓库 `smart-campus-career/data/research` 中**已登记、已核验哈希**的原件；不联网抓取新资料。
- 原始 `source_id` / `source_version_id` 不变，覆盖其 `metadata.document.repo_path` 指向的 33 份 PDF。
- 每段 locator 记录 `source_pdf`、`source_pdf_sha256`、PDF 物理页码与提取方式；`verification_status` 沿用来源版本状态（`partial`）。
- **不声称**这是结构化课程表：不写 `app_courses`、不补学分/先修/开课学期，规则引擎行为不变；回答仍受「不编造 / 不替用户算数」约束。
- 未授权、未载入的资料不会因为本批次进入问答。

## 3. 执行步骤（实际执行）

1. 从 Supabase 只读导出既有 corpus 行（764 段 / 270 个来源）与 351 个 source_version 元数据。
2. 新增 `worker/scripts/build_registered_pdf_corpus.py`：用 `pdftotext -layout` 逐页提取，**按章节标题对齐切块**（避免课程清单与毕业要求表格混在同一块导致检索被稀释），每块 ≤1200 字符，生成额外 974 段。
3. 组装 corpus v2：既有 764 段（顺序、`ordinal`、`text_sha256` 与 DB 完全一致）+ 974 个 PDF 段 = **1738 段**；`corpus_sha256=4cd037ada3ea2a4b7664a2c3881cf9d2fb541d178dff8de98bb0e33d3a4cd18a`（v2.1 章节对齐版本）、源文件 `data/import/out/corpus-v2.jsonl`（未入库，本地生成）。
4. 用官方 `worker/scripts/seed_corpus.py --apply` 建新 embedding profile：
   - profile：`career-qwen3-embedding-8b-4096-career-qwen-v2`（同一模型 qwen/qwen3-embedding-8b、4096 维、L2、同一 splitter）；
   - 旧 profile `…-career-qwen-v1` 置为 `retired`（保留 764 条旧向量，可回滚）；
   - 嵌入 1738 段，usage 447,148 input tokens，按 `EMBEDDING_PRICE_USD_PER_MTOK=0.01` 计约 **$0.0045**；
   - seed 校验：`chunks=1738 / embeddings=1738` 通过，profile 原子置 `active`。
   - 注：seed 首次运行遇到两次瞬时「数据库网络错误」，按脚本设计可续跑；补齐向量后再次 `--apply` 完成校验与激活。
5. Worker 环境（VM `/etc/campus-pathway/worker.env`）：
   - `EMBEDDING_PROFILE_ID=career-qwen3-embedding-8b-4096-career-qwen-v2`
   - 证据预算：`RETRIEVAL_CANDIDATE_LIMIT=96`、`RETRIEVAL_MAX_EVIDENCE=16`、`RETRIEVAL_MAX_PER_DOCUMENT=5`、`RETRIEVAL_MAX_PER_SOURCE=6`、`RETRIEVAL_CHAR_BUDGET=16000`、`CHAT_MAX_TOKENS=3200`
   - 配置模型价格（此前未配置导致 usage.estimated_cost 全为 NULL，预算闸门按每条 $0.02 预留，月度 $5 预算被误判耗尽）：`MODEL_INPUT_PRICE_USD_PER_MTOK=0.27`、`MODEL_OUTPUT_PRICE_USD_PER_MTOK=1.10`、`EMBEDDING_PRICE_USD_PER_MTOK=0.01`。

## 4. 验证

- DB：`app_chunks=1738`；`app_chunk_embeddings(profile=v2)=1738`；profile v2 `active`；33 个 PDF 版本 `extraction_status=parsed`、`metadata.corpus_seed.chunk_count` 与语料一致。
- 线上问答（https://zhitu.quest/library）复测记录见第 5 节。
- worker 单测：`cd worker && uv run --python 3.12 pytest -q` → 131 passed。

## 5. 线上复测（2026-10-22，https://zhitu.quest/library）

| 问题 | 修复前 | 修复后 |
|---|---|---|
| 国际经济与贸易专业培养方案里有哪些核心课程？ | 拒答「语料缺少培养方案类可核验内容」 | 按 2024/2025/全英语/双学位四个版本逐条列出核心课程，13 条引用，并注明学分/学时/开课学期为资料缺口 |
| 本专业培养方案里有哪些与国际贸易相关的课程？ | 拒答 | 按版本列出国际经济学、国际贸易实务、国际商法等课程，14 条引用，明确「国际贸易相关」为归纳并标注资料缺口 |
| 学校公开的就业质量报告里如何描述毕业生去向？ | 只能给目录/后记 | 给出 2021 届去向落实率 91.29%、本科 90.66%、硕士 92.74% 及就业口径/人数结构，4 条引用，并标注 2019/2020 届只有目录 |
| 2026 届上海高校毕业生平均起薪是多少？（应拒题） | 无数据 | 明确拒绝给出数字，逐条说明现有证据只有 2016 届单校薪酬、2017/2018 直接用工率等，8 条引用，未编造 |

代价：证据从「中位数 4 段」提高到最多 16 段，单次问答延迟约 20–58 秒（此前约 14–27 秒），后续可再调预算/截断策略。

## 5.1 配套 worker 代码修复（同批上线）

数据补齐只解决「没有正文」；实测还发现三类机制把本可回答的问题变成拒答，一并修复（`fix/ask-answer-completeness`）：

1. **校验瑕疵降级**（`worker/app/graphs/ask.py`）：只有「引用编号不存在」（编造来源）才硬拒；数字格式/漏标引用等问题降级为回答 + `boundary_note` 校验提示，不再整段丢弃。
2. **数字白名单补 context**（`ask.py`）：prompt 注入的是「正文 + 邻近块」，白名单也改用同一份文本，避免合法使用相邻段落数字被判越界。
3. **带反馈的重试**（`worker/app/graphs/common.py`）：校验失败时把原因回传模型修正再试一次；硬失败（编造引用）不重试。
4. **数字写法归一**（`worker/app/prompts/validate.py`）：`3,928` vs `3928`、`95.60%` vs `95.6%` 等按数值比较，减少误判。
5. **完整作答提示**（`worker/app/prompts/career.py`）：删除「最多 6 个要点」，要求逐个子问题回答、证据覆盖到的信息列全、缺失部分单列资料缺口，而不是整题拒答。
6. `RETRIEVAL_*` 预算放宽（见第 3 节），证据段数上限 12→16。

验证：`cd worker && uv run --python 3.12 pytest -q` → **131 passed**（新增 2 个用例覆盖软校验降级与数字写法归一）。

## 6. 回滚

1. `worker.env` 把 `EMBEDDING_PROFILE_ID` 改回 `career-qwen3-embedding-8b-4096-career-qwen-v1`，`docker compose up -d --force-recreate`。
2. 逻辑回滚：`update app_embedding_profiles set status='retired' where profile_id='…-v2'; update app_embedding_profiles set status='active' where profile_id='…-v1';`
3. 数据回滚（按需）：删除本批次 chunk 会级联删除 v2 embedding；批次边界 = `source_version_id in (33 个 PDF version id)`，清单见 `registered-pdf-manifest.json`。
4. corpus v1 的 764 条向量与 source_version 元数据未被修改，回滚不影响既有回答。

## 7. 未做的事

- 未做课程/学分结构化，未修改规则引擎与 `app_courses`。
- 未把 33 份 PDF 上传 Supabase Storage；原件仍在研究快照仓库，locator 用相对路径 + sha256。
- 未重新跑 38 题全量 RAG 回归（本轮只做线上抽样复测与 worker 单测）。
