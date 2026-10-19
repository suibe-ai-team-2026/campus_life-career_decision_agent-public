# 知途（Campus Pathway）· 研究快照数据字典

状态：2026-10-19 首版（对应 `scripts/import-research.ts` dry-run 通过、`--apply` 未执行）。
本文描述**已授权研究快照 → Supabase `app_` 表**的字段来源、类型约束、缺失语义与权限，以及 worker 语料清单（corpus）的准入规则。
字段与约束的最终依据是 `supabase/migrations/20261019000100_career_cloud_tables.sql`；权限依据 `20261019000200_career_cloud_rls.sql` 与 `20261019000500_career_cloud_private_sources.sql`。
导入 manifest：`data/import/manifest.json`；执行记录：`docs/import-record.md`。

## 1. 数据源与稳定 ID

| 项目 | 说明 |
|---|---|
| 快照根目录 | `../smart-campus-career/data/research`（相对本仓库；可用 `--source-root` 覆盖） |
| 统一快照 | `unified-2026-10-19`（`research-archive-v1`，快照日 2026-10-19） |
| 稳定 ID | `src_`（来源）/`rec_`（记录）/`req_`（要求）/`doc_`（文档）**原样保留**，不重新编号 |
| 派生的确定性 ID | `source_version_id`=UUIDv5(`career-pathway/source-version/<source_id>/<content_sha256>`)；批次 ID=`career-cloud-import-20261019-<planHash 前 12 位>` |
| 哈希 | 文件用 SHA-256；`source_reference` 类 `content_sha256` 是**快照记录哈希，不是网页字节哈希**（见 §3.3） |
| 快照审计 | `validation.json` sha256 `8c3c4903…`；53 个文件清单哈希 `53ccc4e7…`；源仓库记录 commit `ba2794b`（解析 `ba2794b3a…`），validation 基线 `82ea5c3…` |

## 2. 本次导入的实体与计数

| 目标表 | 行数 | 来源 |
|---|---:|---|
| `app_directions` | 6 | `data/import/seed/directions.json`（产品种子） |
| `app_assessments` | 1 | `data/import/seed/assessment.json`（产品种子） |
| `app_sources` | 319 | `unified/sources.csv` |
| `app_source_versions` | 319 | 每来源一个当前版本（47 个原件哈希 / 272 个快照引用哈希） |
| `app_evidence_records` | 243 | `unified/records.csv`（official 57 / municipal 17 / graduate 15 / destination 15 / job 28 / social 85 / claim 26） |
| `app_direction_requirements` | 115 | `unified/requirements.csv`（finance 27 / data 22 / public 36 / trade 30） |
| `app_source_aliases` | 250 | `unified/aliases.csv`（含 pilot M001–M007 的 7 条） |
| 文档元数据 | 34 | `unified/documents.csv`，写入 `app_source_versions.metadata.document`，不解析正文 |
| 试导入复用 | 2 来源 + 7 指标 | C17/C18 → `src_*`；M001–M007 → `rec_*`，不重复计数 |

## 3. 表 → 字段映射

### 3.1 `app_directions`（6 行）

| 字段 | 类型 / 约束 | 来源字段 | 处理规则 | 缺失语义 |
|---|---|---|---|---|
| `direction_id` | text PK | 种子 `directions[].direction_id` | 六个固定 ID：`trade_supply_chain`/`cross_border_business`/`finance_accounting`/`data_business`/`public_service`/`further_study` | 不允许缺失 |
| `title` | text not null | 种子 `title` | 原样 | 不允许缺失 |
| `category_version` | text not null | 种子 `category_version` | `career-nav-2026-10-19` | 不允许缺失 |
| `description` | text not null default `''` | 种子 `summary` | 原样 | 不允许缺失 |
| `sort_order` | integer not null default 0 | 数组顺序 | 1 起 | — |
| `active` | boolean not null default true | — | `true` | — |
| `metadata` | jsonb not null default `{}` | 其余种子字段 | `short_title`/`work_content`/`verified_skills`/`preparation_cost`/`applicability`/`data_gaps`/`source_ids`/`disclaimer` | 各子字段可为 null，不补造 |

**权限**：`anon`/`authenticated` 可 SELECT（公开目录，向导前四步无需登录）；无用户写策略，写入仅 `service_role`。
**注意**：六个方向是产品导航分类，**不是**学校官方就业分类；`source_ids` 目前为空数组。

### 3.2 `app_assessments`（1 行）

| 字段 | 类型 / 约束 | 来源字段 | 处理规则 | 缺失语义 |
|---|---|---|---|---|
| `version` | text PK | 种子 `version` | `career-light-2026-10-19` | 不允许缺失 |
| `questions` | jsonb not null | 种子 `questions` | 原样（含 `reverse`/`optional`） | 不允许缺失 |
| `scoring_spec` | jsonb not null | 种子 `dimensions`+`reverse_scored` 等 | 仅登记维度、反向题、5 级量表与“计分在 worker 实现”的说明；**不在此计分** | — |
| `methodology_sources` | jsonb not null default `[]` | 种子 `methodology_sources` | 原样 | — |
| `status` | text default `active` | — | `active` | — |

**权限**：`anon`/`authenticated` 可 SELECT（公开题面）；写入仅 `service_role`。
**注意**：这是产品自编轻测，不是经过心理学验证的专业测评。

### 3.3 `app_sources`（319 行）

| 字段 | 类型 / 约束 | 来源字段 | 处理规则 | 缺失语义 |
|---|---|---|---|---|
| `source_id` | text PK | `sources.csv.source_id` | 原样保留 `src_` + 24 位 | 不允许缺失 |
| `canonical_url` | text | `sources.csv.url` | 去片段；去 `utm_*`/`gclid`/`fbclid`/`spm`/`scm`/`share_*` 等追踪参数；其余查询参数**保留并确定性排序**（`classid`/`type`/`query` 有语义） | URL 始终存在；本轮 1 个来源被规范化（参数排序） |
| `title` | text not null | `sources.csv.title` | 原样 | 不允许缺失 |
| `publisher` | text | 变体 `metadata.publisher` | 原样；取第一个非空 | 未记录则 **NULL**，不按域名猜发布方 |
| `source_scope` | text | 无（派生） | 见 §4.1 派生优先级 | 未知归类为 `unclassified_reference`（本轮为 0） |
| `visibility` | text check | — | 全部 `approved_reference` | — |
| `owner_id` | uuid FK auth.users | — | **NULL**（共享语料） | 私有来源走用户上传，不在此管线 |
| `verification_status` | text not null default `unverified` | `sources.csv.verification_status` | **保留研究快照原文**（可能为中文长句）；不归一化、不升级 | 原文为空 → `unverified` |
| `metadata` | jsonb not null | 变体元数据/文档 | `research_verification_status`、派生 `verification_class`、`batches`、`variants_count`、`scope_hint`、`legacy_ids`（如 C17/C18）、`url_recorded`、`documents[]`、`corpus_source_card_eligible`、免责声明 | 子字段可 null |

**权限**：`authenticated` 可 SELECT `visibility='approved_reference' or owner_id=auth.uid()`；**匿名不可读来源表**（目录接口只公开方向与题面）；写入仅 `service_role`（迁移 500 允许登录用户插入/更新自己的 private 来源，与本管线无关）。

**核验分级（派生，不改变原状态）**：

| `metadata.verification_class` | 判定（对原文） | 本轮来源数 |
|---|---|---:|
| `verified` | 命中 `官方PDF已下载并核对指定页` / `official_attachment_retrieved` / `本地解析及关键表格图像已核` / `official_reported_visual_checked` / `official_article_checked` / `官方正文已读` / `正文已读` / `Harness HTTP原文全文核对` | 57 |
| `partial` | 其余非空状态（目录/入口/摘录/正文已读/沿用原文等） | 155 |
| `unverified` | 命中 `unverified` / `未独立核验` / `未另核` / `待…核` / `public_self_report` / `promotional` / `媒体转引` / `反推` / 自述转述 / 广告推广 等 | 107 |

`verification_class` 只是**查询与展示辅助**，不是人工批准；`excluded`/社交备用/product-v2 永不升级。

### 3.4 `app_source_versions`（319 行）

| 字段 | 类型 / 约束 | 来源字段 | 处理规则 | 缺失语义 |
|---|---|---|---|---|
| `source_version_id` | uuid PK | 无 | UUIDv5(`career-pathway/source-version/<source_id>/<content_sha256>`)；**不用**默认 `gen_random_uuid()`，保证重复导入同一行 | — |
| `source_id` | text FK `app_sources` | — | 一对一当前版本 | — |
| `content_sha256` | text not null check `^[0-9a-f]{64}$` | 见 §3.4.1 | 文件哈希优先，否则快照引用哈希 | 不允许缺失（引用哈希总是可算） |
| `published_at` | date | 变体 `metadata.published`/`published_at` | 仅当记录为完整 `YYYY-MM-DD` 时写入；`YYYY-MM`/`YYYY` 视为不完整 → NULL（原文保留在 manifest 快照文件里） | NULL = 记录日期不完整，不按 URL 日期推断 |
| `retrieved_at` | timestamptz not null | 变体 `metadata.retrieved`/`retrieved_at` | 取最新完整日期 + UTC 零点；无记录时用快照日期 `2026-10-19T00:00:00.000Z`（确定性） | 不允许缺失 |
| `effective_from`/`effective_to` | date | — | 全部 NULL；不从届别/发布日期推断适用期 | NULL = 未核 |
| `storage_path` | text | — | **全部 NULL**：原件在源研究仓库，未上传本项目 Supabase Storage；私有 GitHub raw URL 不作为公开引用 | NULL ≠ 文件不存在，见 `metadata.document.repo_path` |
| `extraction_status` | text check | — | 有原件哈希 → `partial`（登记原件但本导入不解析正文）；无原件 → `pending` | 不声称已解析 |
| `parser_version` | text | — | NULL | — |
| `metadata` | jsonb not null | — | `content_sha256_kind`（`file`/`source_reference`）、`file_sha256_source`、`reference_hash_input`、`batches`、`document[]`（文档元数据）、`pages`、`extraction_note`、`storage_note` | 子字段可 null |
| `visibility`/`owner_id` | check/FK | — | `approved_reference` / NULL | — |

唯一约束 `(source_id, content_sha256)`。

#### 3.4.1 两类 `content_sha256`

| 类别 | 行数 | 输入 | 语义 |
|---|---:|---|---|
| `file` | 47 | `documents.csv` 的 34 个文件哈希 + 变体 `metadata.sha256` 的 13 个官方 PDF 哈希（无重叠） | 原件字节哈希 |
| `source_reference` | 272 | `stableJSON({source_id, canonical_url, title, verification_status, variants})` 的 SHA-256 | **快照记录哈希**，用于在无原件时得到稳定版本 ID；**不是网页字节哈希** |

#### 3.4.2 34 份文档元数据（不解析正文）

`documents.csv` 的 34 行（32 份 2024/2025 级培养方案 PDF + 2 份补档官方附件）不建独立表，逐份写入对应来源的版本 `metadata.document[]`：

```json
{"document_id":"doc_…","repo_path":"data/research/suibe-2026-10-17/official_documents/…pdf",
 "sha256":"…","reference_only":true,"verification_status":"分学期周课时表不是…"}
```

- `doc_` 稳定 ID 原样保留；同内容只登记一个文档 ID。
- 不解析 PDF 正文，不生成课程/学分/先修/竞赛记录。
- `repo_path` 是**相对源研究仓库**的路径；不写作者本机绝对路径。

### 3.5 `app_evidence_records`（243 行）

| 字段 | 类型 / 约束 | 来源字段 | 处理规则 | 缺失语义 |
|---|---|---|---|---|
| `record_id` | text PK | `records.csv.record_id` | 原样 `rec_*` | — |
| `source_version_id` | uuid FK | 其 `source_id` 对应版本 | 来源版本映射 | — |
| `record_type` | text not null | `record_type` | 原样，7 类：official_observation 57 / municipal_metric 17 / graduate_case_or_aggregate 15 / destination 15 / job 28 / social_case 85 / research_claim 26 | — |
| `cohort` | text | `cohort` | 原样字符串（如 `2016`） | 空 → NULL |
| `school`/`degree`/`major`/`metric`/`unit` | text | 同名列 | 原样 | 空 → NULL |
| `value` | numeric | `value` | 仅当原文本身是数字；**不补算、不跨列填值** | 空/非数字 → NULL |
| `numerator`/`denominator` | numeric | 同名列 | 同上 | 空 → NULL，**NULL ≠ 0** |
| `statistical_cutoff` | date | `cutoff` | 仅完整 ISO `YYYY-MM-DD`；2 条中文（如“2021年9月底”）→ NULL | NULL = 原文非 ISO，原文保留在 `locator.cutoff_raw` |
| `definition` | text | `payload.definition` | 仅 `municipal_metric` 有 | 无定义 → NULL（不从 `limit` 猜定义） |
| `population_scope` | text | `payload.scope`/`payload.population` | 原样 | 无 → NULL |
| `locator` | jsonb not null default `{}` | — | `record_id`、`record_type`、`cohort`、`school`、`degree`、`major`、`pdf_page`、`cutoff_raw`、`original_included`、`provenance[]`、`source_id`、`source_original_id`、`source_version_id`、`canonical_url`、`verification_class` | — |
| `verification_status` | text not null default `unverified` | `verification_status` | **原文保留**（“沿用原文状态，未新增核验”/`platform_advertised_unverified…`/“官方报告原值”等） | 原文空 → `unverified` |
| `included` | boolean not null default false | `included` | `True`→true，`False`→false；**空 104 条 → false** | 原值保留在 `locator.original_included`（null）；见 §6 |
| `payload` | jsonb not null default `{}` | `records.csv.payload` + `provenance` | 原始 payload 全部字段保留，并追加 `provenance` 与 `import_context`；未映射列不补算 | payload 内可为 null |

**权限**：`authenticated` 可 SELECT，条件是父版本 `visibility='approved_reference' or owner_id=auth.uid()`；写入仅 `service_role`。

**记录 ≠ 人数**：243 条是官方观察/市级指标/毕业去向/研究摘要/招聘快照/社交备用的**混合计数，不是 243 名毕业生**。

### 3.6 `app_direction_requirements`（115 行）

| 字段 | 类型 / 约束 | 来源字段 | 处理规则 | 缺失语义 |
|---|---|---|---|---|
| `requirement_id` | text PK | `requirements.csv.requirement_id` | 原样 `req_*` | — |
| `direction_id` | text FK `app_directions` | 父招聘记录 `payload.group_id` + 词条关键词 | **保守映射**（§4.3）：`accounting`→`finance_accounting`；`data`→`data_business`；`law`→`public_service`；`trade_language`→`trade_supply_chain`；倾向关键词只作佐证，**不跨方向重映射** | 不允许映射到六方向之外；映射方法写入 locator |
| `skill_id` | text not null | `term` | `skill_` + SHA-256(term) 前 16 位（同一术语跨方向共享） | — |
| `skill_label` | text not null | `term` | 原样中文词条 | — |
| `requirement_level` | text check | `strength` | `required`→required；`preferred`→preferred；`task_only`→**mentioned**（任务/职责不等于入职门槛） | 未知 strength 报错 |
| `source_version_id` | uuid FK | 父招聘记录来源版本 | 关联到招聘快照 | 可为 NULL 的表列此处必有值 |
| `locator` | jsonb | — | `requirement_id`、`record_id`、`category`、`strength`、`basis`、`original_id`、`direction_mapping{method,parent_group_id,keyword_hint}`、`record_verification_status`、免责说明 | — |
| `status` | text check | — | **全部 `unverified`**（招聘摘要不是官方结论，未升级） | — |

**权限**：`authenticated` 可 SELECT（规则参考数据）；写入仅 `service_role`。
**方向分布**：finance_accounting 27 / data_business 22 / public_service 36 / trade_supply_chain 30；**没有** cross_border / further_study 的要求（不补造）。
**映射方法**：`term_keyword_and_parent_group` 74 条，`parent_job_group` 41 条。

### 3.7 `app_source_aliases`（250 行）

| 字段 | 类型 / 约束 | 来源字段 | 处理规则 | 缺失语义 |
|---|---|---|---|---|
| `batch_id` | text not null（复合 PK） | `aliases.csv.batch` | 原样批次名 | — |
| `legacy_id` | text not null（复合 PK） | `original_id` | 原批次编号（如 O001、M001–M007） | — |
| `entity_type` | text not null（复合 PK） | `record_type` | 快照别名只有记录类型；本管线**不额外插入 source 别名** | — |
| `stable_id` | text not null | `record_id` | 统一 `rec_*` | — |

批次分布：`shanghai-decade` 90 / `suibe_reserve` 105 / `shanghai-official` 17 / `boss-market` 16 / `shanghai-outcomes` 15 / `supabase-pilot` 7。
**权限**：无用户策略 → 仅 `service_role`（worker/运维）。

### 3.8 `app_import_batches`（每次 apply 1 行）

| 字段 | 类型 / 约束 | 来源 | 说明 |
|---|---|---|---|
| `batch_id` | text PK | 派生 | `career-cloud-import-20261019-<planHash 前 12 位>`（确定性） |
| `source_repo` | text not null | 固定 | `suibe-ai-team-2026/smart-campus-career@<resolved commit>` |
| `source_commit` | text not null | git 解析 | `ba2794b3a…`（可用 `--source-commit` 覆盖） |
| `manifest_sha256` | text not null | `sha256(stableJSON(manifest 去掉 manifest_sha256 字段))` | 当前 `5d9bf235…` |
| `counts` | jsonb | 导入计划计数 | 与报告一致 |
| `status` | text check | — | `pending→running→succeeded`；失败 `failed`/`rolled_back` |
| `started_at`/`finished_at`/`error_code` | timestamptz/text | — | 开始时间保留，不被结束更新覆盖；失败写错误码 |

**权限**：无用户策略 → 仅 `service_role`。
**回滚**：见 §8.4。

### 3.9 不由本管线写入的表

| 表 | 处理 |
|---|---|
| `app_chunks`、`app_chunk_embeddings`、`app_embedding_profiles` | worker 在入库 embed 时生成（语料见 §7） |
| `app_courses`、`app_prerequisites`、`app_competitions`、`app_credit_rules` | 本轮无结构化来源，**保持空表**（培养方案 PDF 未解析） |
| `app_requirement_actions` | 无“要求→行动”映射数据，保持空表 |
| `app_profiles`、`app_plans`、`app_plan_versions`、`app_runs`、`app_run_results`、`app_run_events`、`app_artifacts`、`app_usage` | 用户运行时数据，不属于快照导入 |
| `app_sources` 的 private 行、`app_source_versions` 的 private 行 | 用户上传后由 BFF/worker 写入，本管线不创建 |

## 4. 派生规则（全部可复算）

### 4.1 `source_scope` 优先级

1. 文档类型：`official_documents/` 下的培养方案 PDF → `official_curriculum_pdf`；补档附件 → `official_attachment`。
2. 记录类型（按优先级）：`municipal_metric`→`municipal_employment_report`；`official_observation`→`school_employment_report`；`destination`→`school_destination_observation`；`graduate_case_or_aggregate`→`graduate_case_public_account`；`job`→`job_posting_snapshot`；`social_case`→`social_case_backup`；`research_claim`→`research_reference_page`。
3. 变体元数据 `source_kind`/`source_type`/`kind`（如 `official_curriculum`、`official_report`、`市教委就业质量报告` 等映射表）。
4. 批次默认值（如 `suibe_main`→`official_curriculum_catalog`、`boss-market`→`job_posting_snapshot`）。
5. 兜底 `unclassified_reference`（本轮 0）。

本轮分布（319）：official_curriculum_catalog 104 / social_case_backup 81 / official_curriculum_pdf 32 / job_posting_snapshot 27 / school_employment_report 12 / official_reference_page 12 / graduate_case_public_account 12 / school_catalog_reference 9 / policy_or_market_reference 5 / research_reference_page 5 / municipal_employment_report 4 / report_lead 4 / official_context_page 4 / market_background_reference 3 / official_attachment 2 / department_profile_reference 1 / school_official_report_reference 1 / report_repost 1。

### 4.2 `verification_class`

见 §3.3。只由**原文状态字符串**匹配得到；原始字符串始终保存在 `verification_status` 与 `metadata.research_verification_status`。记录级同理保存在 `locator.verification_class`。

### 4.3 招聘要求 → 方向

- 方向由父招聘记录 `payload.group_id`（招聘归档中的**显式字段**）决定；`term` 命中方向关键词时只作为佐证（方法记为 `term_keyword_and_parent_group`）。
- 关键词与父分组冲突时**保留父分组**，不把一条招聘要求“转赠”给另一个方向。
- `status` 一律 `unverified`；`task_only` 一律降为 `mentioned`。
- 方向是产品导航分类，不是官方专业目录。

### 4.4 canonical URL

- 仅删除 `#fragment`、`utm_*`、`gclid`、`fbclid`、`spm`、`scm`、`share_*` 等追踪参数；保留 `classid`/`type`/`query` 等有语义参数并排序。
- 不做短链展开、不访问网络、不把 GitHub 私有 raw URL 写入公开引用。

## 5. 权限总表（public 共享 / private 用户）

| 表 | anon | authenticated | service_role | 说明 |
|---|---|---|---|---|
| `app_directions` | R | R | 全部 | 公开目录 |
| `app_assessments` | R | R | 全部 | 公开题面 |
| `app_sources` | — | R（`approved_reference` 或本人 private） | 全部 | 共享语料读；用户可插入/更新自己的 private（迁移 500） |
| `app_source_versions` | — | R（同上） | 全部 | 同上 |
| `app_evidence_records` | — | R（经父版本 visibility） | 全部 | 共享证据 |
| `app_direction_requirements` | — | R | 全部 | 规则参考 |
| `app_source_aliases` | — | — | 全部 | 别名仅内部 |
| `app_import_batches` | — | — | 全部 | 批次仅运维 |
| `app_chunks` | — | R（`approved_reference` 或本人） | 全部 | worker 写入 |
| `app_courses`/`prerequisites`/`competitions`/`credit_rules`/`requirement_actions` | — | R | 全部 | 本轮空表 |
| 用户表（profiles/plans/runs/artifacts/usage） | — | 仅本人（RLS owner 校验） | 全部 | 不导入 |

本管线所有共享行 `visibility='approved_reference'`、`owner_id=NULL`；**不导入真实学生个人信息**。`verification_status`（质量）与 `visibility`（权限）是两列，互不替代。

## 6. 缺失语义（重要）

1. **NULL 表示“未取得/未披露/不可比较”，不表示 0、不表示 false、不表示不存在**。
   - `value=NULL` ≠ 0；`denominator=NULL` ≠ 0；`statistical_cutoff=NULL` ≠ 无统计时点；`storage_path=NULL` ≠ 文件不存在（见 `metadata.document.repo_path`）。
2. `included` 只有两类取值，且原值保留：
   - `False`：显式排除 **或** 原文未标注（104 条空值）。不要把它读成“已核验且无关”。
   - `True`：纳入该批研究（26 条）。
3. `published_at=NULL` 表示记录中没有完整日期；**不从 URL 日期、发布时间推断届别或统计截止日**。
4. `destination`/`research_claim` 的 `payload.count`/`payload.value` **不迁入 `value` 列**：两者语义不同，避免把“某单位签约人数”当成通用指标值。
5. `metadata.verification_class` 是派生粗分类，**不是人工批准**；不能据此宣称“已核验”。
6. `app_source_versions.extraction_status='partial'` 只表示“登记了原件哈希”，不代表正文已解析。

## 7. Corpus（worker 语料清单）准入

产物：`data/import/out/corpus.jsonl`（764 行）+ `corpus-meta.json`。每行一个 JSON：`chunk_id`、`source_id`、`source_version_id`、`source_title`、`source_scope`、`verification_status`（分级）、`verification_status_raw`、`visibility='approved_reference'`、`chunk_kind`、`record_id`、`record_type`、`chunk_text`（≤1200 字符）、`locator`、`heading_path`、`search_terms`（分词提示，jieba 在 worker 做）、`chars`、`sha256`、`ordinal`。

| 准入 | 规模 |
|---|---:|
| SUIBE 2015–2022 机器提取报告全文（line+heading locator，无页码） | 226 chunks / 9 份 |
| 结构化证据记录（**排除** social_case 及社交来源的 research_claim，共 99 条不入语料） | 144 chunks |
| 招聘要求（job_snapshot，仅作快照） | 115 chunks |
| 研究归纳 `REPORT.md`（research_synthesis，转引需回原始来源） | 21 chunks / 3 份 |
| 20 份 `web/plans/*.md`（plan_suggestion，仅建议） | 20 chunks |
| 官方来源标题/口径卡片（不伪装正文） | 238 chunks |

- 总计 764 chunks、408,104 字符、270 个来源文档（其中 32 份有正文）；每块 ≤1200 字符，附 sha256。
- **排除**：`product-v2.md`、未核社交备用（85 条 social_case + 14 条社交来源 research_claim）、2023/2024 OCR 错位提取稿、`web/plans` 重复副本 20 份、34 份未解析 PDF、原始采集/运行文件、evidence_cells 派生视图。
- **319 个统一来源都没有可直接发布的正文**：34 份原件未解析，其余只有标题/口径与结构化证据。正文语料来自 32 个 **corpus-only 来源**（9 份 SUIBE 报告 + 3 份研究归纳 + 20 份方向方案），它们不在 319 导入清单内，worker embed 前须按 `corpus-meta.json.source_registry_extra` 登记（含确定性 `source_version_id`）。
- corpus 的 `verification_status` 是分级值（`verified` 83 / `partial` 502 / `unverified` 179），原文在 `verification_status_raw`。

## 8. 复现、幂等与回滚

### 8.1 复现

```bash
npx tsx scripts/import-research.ts --dry-run --emit-manifest  # 报告 + manifest
npx tsx scripts/build-corpus.ts                                # corpus.jsonl + corpus-meta.json
```

快照未变时：`plan_hash`、批次 ID、manifest 哈希、corpus sha256 全部不变（已验证两次运行一致：batch `career-cloud-import-20261019-c11625d6fa97`；manifest `5d9bf235…`；corpus `1360ffe1…`）。

### 8.2 幂等

所有写入均为按主键/唯一键 upsert；`source_version_id` 与批次 ID 是内容确定性推导；重复执行 **行数不变**（对真实数据库的行数核对需在 `--apply` 后执行 `select count(*)`，本次未执行）。

### 8.3 manifest 审计

`data/import/manifest.json` 含：快照 53 个文件 sha256、两个仓库的记录/解析/实测 commit、7 个实体集合的行数与主键集合哈希、种子文件哈希、pilot 7 条别名、方向要求分布、排除项、安全声明。`app_import_batches.manifest_sha256` 即该 manifest 的规范哈希。

### 8.4 失败回滚（`--apply` 实现，尚未真实执行）

1. 写库前读取 7 张表主键快照。
2. 任一步失败：按逆依赖顺序删除“本次新增”（不在主键快照中）的行；批次置 `rolled_back` 并写 `error_code`。
3. schema 没有 import batch 列：**被更新的既有行不还原**；复合主键表按行精确删除。无法完成回滚时批次置 `failed` 并在报告中列出错误，不谎报成功。
4. 密钥只从环境变量读取，不落盘、不打印；错误信息中的密钥值被替换为 `***`。

## 9. 不可推断项（数据红线）

1. **17/600**：只有 17 个精确同名专业证据格；600 格是“20 专业 × 10 届 × 3 学历”的目标矩阵，**没有逐格检索完成**。缺口不等于零就业，也不代表该专业未开设。
2. **243 不是人数**：243 条是证据/指标/研究摘要/招聘快照的混合记录数，不是 243 名毕业生，不能相加成就业人数或计算就业率。
3. **记录类型不可混合计算**：official_observation 57 / municipal_metric 17 / destination 15 / graduate_case_or_aggregate 15 / job 28 / social_case 85 / research_claim 26 是不同口径；不同类型不得相加算就业率、薪资或专业排名。
4. **PDF ≠ 结构化课程表**：培养方案 PDF 只登记哈希与来源；不解析、不生成课程/学分/先修，不做课表冲突或毕业学分判断。
5. **product-v2 数字禁用**：`product-v2.md` 的“约 5%”、申请人数、英语分数、录取偏好、薪资与竞品比较均未核证，不得进入事实库或语料。
6. **旧就业率含升学**：市级 2017/2018 “就业率（旧口径）”包含升学/出国/灵活就业等七类去向；“直接用工率”也不能称真实就业率；未计入的 5,434 人（2017）不能称失业。
7. **未拆分研究生**：原文“研究生”不推成硕士/博士；不从图示四舍五入值反推人数。
8. **发布时间 ≠ 毕业届别/统计截止日**：不从网页 URL 日期或发布日推届别、统计时点。
9. **招聘快照 ≠ 当前在招/录用结果**：28 条 job 是平台广告快照，未核雇主与有效性；115 条要求是分类摘要，`task_only` 已降为 `mentioned`，全部 `unverified`。
10. **社交备用不是证据**：85 条 social_case `included=false`，只留备用层，不升级、不进语料、不作为就业结果。
11. **来源卡片不是正文**：`source_card` 只有标题/口径/核验状态，引用数字必须回到 canonical URL 或原件。
12. **corpus-only 来源不在 319 清单**：9 份 SUIBE 报告、3 份研究归纳、20 份方向方案需单独登记后方可嵌入；不能声称已导入 `app_sources`。
13. **六个方向是产品导航分类**，不是学校官方就业分类；同一岗位可映射多个方向。
14. **核验分级不是人工批准**：`verified` 只表示原文状态显示官方原件已核对；全库仍无团队人工批准记录。
