# 研究快照导入管线 · data/import

状态：**dry-run 已真实跑通（2026-10-19）**；`--apply` **未执行**，等待 Supabase 凭据。
本目录保存导入管线的说明、可审计 manifest 与（gitignored 的）生成物；产品种子 `seed/` 保持原样。

- 导入器：`scripts/import-research.ts`
- 语料构建器：`scripts/build-corpus.ts`
- 共享模块：`scripts/import/*.ts`（自实现 RFC4180 CSV 解析，不新增依赖）
- 数据字典：`docs/data-dictionary.md`
- 执行记录：`docs/import-record.md`

## 1. 数据源与边界

| 项目 | 值 |
|---|---|
| 快照根目录（默认） | `../smart-campus-career/data/research`（可用 `--source-root` 覆盖） |
| 统一快照 | `unified-2026-10-19`：319 来源 / 243 证据记录 / 115 招聘要求 / 250 别名 / 34 文档 |
| 试导入快照 | `supabase-pilot-2026-10-19`：C17/C18 两个来源 + M001–M007 七个指标（只复用，不重复计数） |
| SUIBE 快照 | `suibe-2026-10-18`：2015–2022 届 PDF 的机器提取文本（`extracted/pdf-text/*.txt`），仅用于 corpus |
| 源仓库记录 commit | `ba2794b`（本地解析为 `ba2794b3a0e54711d0457298254fc1baaad2eb2b`） |
| 源仓库实测 HEAD | `a5a5eec…`（`feat/rag-demo` 分支，快照提交后又有提交） |
| validation.json 基线 | commit `82ea5c3…`，分支 `feat/shanghai-graduate-outcomes` |
| 产品仓库记录 commit | `8c72ad4`；实测 HEAD `67adddf…`（工作区有其他并行改动） |
| 统一快照校验 | `validation.json` sha256 `8c3c4903…`；53 个纳入审计的文件清单哈希 `53ccc4e7…`（见 `manifest.json`） |

管线**只读**本地快照：不联网、不执行旧 `01-import.sql`、不读取账号/密钥/Cookie/浏览器目录。
快照内部口径一律保留原文：`included`、`verification_status`、`locator.pdf_page`、`cutoff` 等缺失不补算。

## 2. 运行方式

```bash
# 默认 dry-run：只读、不联网、不写数据库，生成 data/import/out/import-report.json
npx tsx scripts/import-research.ts --dry-run

# 同时生成可提交的审计 manifest（data/import/manifest.json）
npx tsx scripts/import-research.ts --dry-run --emit-manifest

# 覆盖快照目录 / 记录 commit
npx tsx scripts/import-research.ts --dry-run \
  --source-root ../smart-campus-career/data/research --source-commit ba2794b

# 真正写库：需要环境变量 SUPABASE_URL + SUPABASE_SECRET_KEY（只从环境读取）
npx tsx scripts/import-research.ts --apply

# 生成 worker 用的语料清单（gitignored）
npx tsx scripts/build-corpus.ts
```

退出码：`0` 成功；`1` 致命校验失败（拒绝 apply / dry-run 失败）；`2` 用法、配置或 IO 错误。
`--apply` 缺少凭据时**在读取数据库之前**退出（退出码 2），不产生任何写操作。

## 3. 产物

| 文件 | 是否提交 | 内容 |
|---|---|---|
| `data/import/out/import-report.json` | 否（gitignored） | dry-run 报告：计数、73 项校验、缺口、不导入清单、manifest 哈希 |
| `data/import/out/apply-report.json` | 否 | `--apply` 的报告（执行后生成；当前不存在） |
| `data/import/out/corpus.jsonl` | 否 | 764 条 embedding chunk（每行一个 JSON 对象） |
| `data/import/out/corpus-meta.json` | 否 | corpus 统计、排除清单、corpus-only 来源登记、sha256 |
| `data/import/manifest.json` | 是（小文件） | 可审计 manifest：快照文件哈希、实体 ID 集合哈希、种子哈希、pilot 别名、排除项、安全声明 |
| `data/import/seed/directions.json`、`assessment.json` | 是（原有） | 产品种子，本管线只读导入，不修改 |

## 4. 导入顺序、幂等键

| 顺序 | 目标表 | 行数 | upsert 冲突键 |
|---|---|---|---|
| 1 | `app_directions` | 6 | `direction_id` |
| 2 | `app_assessments` | 1 | `version` |
| 3 | `app_sources` | 319 | `source_id` |
| 4 | `app_source_versions` | 319 | `source_version_id`（UUIDv5，由 source_id+content_sha256 推导） |
| 5 | `app_evidence_records` | 243 | `record_id` |
| 6 | `app_direction_requirements` | 115 | `requirement_id` |
| 7 | `app_source_aliases` | 250 | `(batch_id, legacy_id, entity_type)` |
| 8 | `app_import_batches` | 1 | `batch_id`（批次状态 running→succeeded/failed/rolled_back） |

- 顺序 2/3 之前的“pilot 2 来源 + 7 指标”是**解析与校验步骤**，不是额外插入：C17/C18 映射到统一 `src_*`，M001–M007 通过 7 条已有 alias 映射到统一 `rec_*`，不重复计数。
- 34 份文档元数据不是独立表：每份文档的 `document_id`/`repo_path`/`sha256` 写进对应来源的 `app_source_versions.metadata.document`，不解析 PDF 正文。
- 稳定 ID 原样保留：`src_`、`rec_`、`req_`、`doc_`。版本与批次 ID 由内容确定性推导，**重复运行不增行**（同键 upsert；当前快照 plan hash `c11625d6fa97…`，批次 ID `career-cloud-import-20261019-c11625d6fa97`）。
- `--apply` 失败时：先按导入前主键快照删除“仅本次新增”的行（子表先删），批次标记 `rolled_back`；schema 无 batch 列，被更新的既有行不还原、复合键表按行精确删除，无法回滚的部分报告为 `failed` 并写明原因。

## 5. 本次 dry-run 计数（详见 `docs/import-record.md`）

```
app_directions 6 · app_assessments 1 · app_sources 319
app_source_versions 319（原件哈希 47 / 快照引用哈希 272）
app_evidence_records 243（official 57 / municipal 17 / graduate 15 / destination 15 / job 28 / social 85 / claim 26）
app_direction_requirements 115（finance 27 / data 22 / public 36 / trade 30；required 57 / mentioned 54 / preferred 4；全部 unverified）
app_source_aliases 250 · documents 34 · pilot 2+7（不重复计数）
校验 73/73 通过 · corpus 764 chunks / 408,104 字符 / 270 文档（32 份有正文）
```

## 6. 安全红线

- 不把任何密钥写入文件或日志；`--apply` 只从环境变量读取，错误信息中的密钥值会被替换为 `***`。
- 不导入真实学生个人信息：快照是招聘/官方汇总/研究摘要，不包含学生个体记录。
- 不执行旧的 `supabase-pilot-2026-10-19/01-import.sql`（旧项目 `career_sources`/`career_employment_metrics` 建表语句）。
- 不把私有 GitHub raw URL 当公开引用；`storage_path` 全部为 `NULL`，canonical URL 指向官方原始地址。
- 所有路径以相对仓库路径记录（`../smart-campus-career/...`、`data/research/...`），不写作者本机绝对路径。
- `product-v2.md`、未核社交备用、OCR 错位提取稿不进入事实库语料，不升级 `verified`。

## 7. 代码结构

| 文件 | 职责 |
|---|---|
| `scripts/import-research.ts` | CLI：dry-run / apply、报告与 manifest 输出、退出码 |
| `scripts/build-corpus.ts` | CLI：生成 corpus.jsonl + corpus-meta.json |
| `scripts/import/csv.ts` | RFC4180 CSV 解析（BOM/CRLF/引号） |
| `scripts/import/hash.ts` | sha256、稳定 JSON、UUIDv5、ID 集合哈希 |
| `scripts/import/snapshot.ts` | 快照读取/校验、URL 规范化、日期与核验分级、git commit 记录 |
| `scripts/import/plan.ts` | 全量导入计划（6 类行 + 抽样校验 + 不导入清单 + manifest） |
| `scripts/import/report.ts` | 报告结构、控制台摘要、manifest 哈希 |
| `scripts/import/apply.ts` | Supabase service client upsert、批次状态、失败回滚 |
| `scripts/import/corpus.ts` | 语料准入、切块、locator、统计 |

## 8. 已知缺口与后续

1. **`--apply` 未执行**：需要 `SUPABASE_URL` + `SUPABASE_SECRET_KEY`；执行前建议先在目标项目跑迁移 `supabase/migrations/20261019000100_*.sql` 等。
2. **34 份原件未上传 Supabase Storage**：只登记哈希与相对仓库路径，`storage_path=NULL`。
3. **SUIBE 2023/2024 届**只有 OCR 提取稿（标签-数值配对错位），未进入 corpus；2025 届报告在快照中缺失。
4. **32 个 corpus-only 来源**（9 份 SUIBE 报告 + 3 份研究归纳 + 20 份方向方案）不在 319 来源清单内，worker 入库 embed 前需按 `corpus-meta.json.source_registry_extra` 登记。
5. **课程/学分/先修行不导入**：培养方案 PDF 未解析，`app_courses` 等保持空表。
