# 研究快照导入执行记录（2026-10-19）

状态：**dry-run 已真实执行并通过；`--apply` 未执行，等待 Supabase 凭据。**
本文只记录实际跑过的命令、实际输出与哈希；没有声称执行过 `--apply`，也没有 git commit/push。

## 1. 执行环境

| 项目 | 值 |
|---|---|
| 日期时间 | 2026-10-19 18:11:45 CST（UTC 2026-10-19T10:11:45Z） |
| 执行人 | data-dev（子任务） |
| Node | v24.12.0 |
| tsx | 4.21.0（`node_modules` 已安装；未新增依赖） |
| 工作目录 | 产品仓库 `campus_life-career_decision_agent`（`feat/career-cloud-wizard` 分支） |
| 快照目录 | `../smart-campus-career/data/research`（相对本仓库；未写绝对路径） |
| 网络 | **未使用**（dry-run 与 corpus 构建均为本地文件读取） |
| 数据库 | **未连接**（没有执行 `--apply`，没有跑旧 `01-import.sql`） |

## 2. 快照与版本

| 项目 | 值 |
|---|---|
| 统一快照 | `unified-2026-10-19`（`research-archive-v1`，快照日 2026-10-19） |
| 快照文件清单哈希 | `53ccc4e73cd2907e768780bf7759faf818678294f9015fd714c1b8112a47e899`（53 个纳入审计的文件） |
| validation.json sha256 | `8c3c49031a981995ca7b2ba146986b278ad96f80229a2f1404cffa5f9465baa1` |
| validation.json counts | sources 319 / records 243 / documents 34 / requirements 115 / aliases 250 |
| validation.json 基线 | commit `82ea5c316170b93be437dc830201717f0a6d7c9e`，branch `feat/shanghai-graduate-outcomes` |
| 源仓库（记录 commit） | `ba2794b`，本地解析 `ba2794b3a0e54711d0457298254fc1baaad2eb2b` |
| 源仓库（实测 HEAD） | `a5a5eecbddd9e1dafadf9e0a2371bd7f49c18178`（快照提交后又有提交，故与记录值不同） |
| 产品仓库（记录 commit） | `8c72ad4`；实测 HEAD `67adddf7a565df2b9083e15b21b3f64f9398375e`（工作区含其他并行改动） |

## 3. 命令 1：dry-run + manifest（真实输出）

```bash
npx tsx scripts/import-research.ts --dry-run --emit-manifest
# EXIT=0
```

实际输出（节选，完整 JSON 在 `data/import/out/import-report.json`）：

```text
知途（Campus Pathway）· 研究快照导入
模式：dry-run（只读，不联网，不写数据库）
批次：career-cloud-import-20261019-c11625d6fa97
快照：unified-2026-10-19 · 快照日 2026-10-19
快照哈希：53ccc4e73cd2907e…（validation.json sha256 8c3c49031a981995…）

将导入行数（全部按主键/唯一键 upsert，可重复执行）：
  app_directions              6
  app_assessments             1
  app_sources                 319
  app_source_versions         319（原件哈希 47 / 快照引用哈希 272）
  app_evidence_records        243
      · destination 15 · graduate_case_or_aggregate 15 · job 28 · municipal_metric 17
      · official_observation 57 · research_claim 26 · social_case 85
  app_direction_requirements  115（全部 status=unverified）
      · data_business 22 · finance_accounting 27 · public_service 36 · trade_supply_chain 30
      级别：required 57 / preferred 4 / mentioned 54
  app_source_aliases          250（含 pilot M001–M007 的 7 条别名）
  documents（元数据）         34（嵌入 source_versions，不解析正文）

试导入复用：来源 2 个 + 指标 7 条（不重复计数，pilot 别名行 7）
校验：73/73 通过，失败 0，致命失败 0

缺口与提醒（12 条）：
  - canonical URL 规范化：1 个来源的 URL 去除了片段或追踪参数、或对查询参数做了确定性排序（不删除有语义的参数）。
  - 记录缺失语义：2 条非 ISO 统计日置 NULL；104 条 included 空值入库为 false（原值保留）。
  - 319 个来源中 47 个有原件文件哈希（documents.csv 34 个 + 变体元数据 13 个，无重叠），272 个只有快照引用哈希；后者 content_sha256 不是网页字节哈希，storage_path=NULL 且保留 canonical_url。
  - 所有 34 份原件仅登记相对仓库路径与 SHA-256，未上传 Supabase Storage；私有 GitHub raw URL 不作为公开引用。
  - 17/600：仅有 17 个精确同名专业证据格，缺口不等于零就业，也不代表 600 格都检索完成。
  - 243 条记录是证据/招聘快照/研究摘要的混合计数，不是 243 名毕业生。
  - 培养方案 PDF 不等于结构化课程表：本导入不恢复课程比对，不填课程/学分/先修。
  - product-v2.md 的通过率/薪资/英语门槛等数字未核证，禁止进入事实库与语料。
  - 招聘要求全部保持 status=unverified；方向映射方法记录在 locator.direction_mapping，未升级为官方结论。
  - SUIBE 2023/2024 届只有 OCR 提取稿（已排除），2015–2022 届机器提取文本才进入 corpus；2025 届报告在快照中缺失。
  - source_versions.retrieved_at 采用快照记录日期（无记录时用快照日期 2026-10-19 的 UTC 零点），保证重复导入可复现。
  - 统一快照自校验：validation.json 基线 commit=82ea5c3…，branch=feat/shanghai-graduate-outcomes。

报告：data/import/out/import-report.json（--apply 未执行，等待 SUPABASE_URL + SUPABASE_SECRET_KEY）
manifest：data/import/manifest.json
EXIT=0
```

`--emit-manifest` 是本任务额外使用的可选参数（默认 dry-run 只写 `out/import-report.json`）。

## 4. 命令 2：corpus（真实输出）

```bash
npx tsx scripts/build-corpus.ts
# EXIT=0
```

```text
chunks：764；chars：408104；documents：270（其中有正文 32）
chunk 长度：min 79 / mean 534.2 / max 1199（上限 1200）
按 chunk 类型：
  suibe_report_text 226 / research_synthesis 21 / plan_suggestion 20
  evidence_record 144 / job_requirement 115 / source_card 238
按核验分级：partial 502 / unverified 179 / verified 83
去重：删除重复正文块 0；过短块 0。
没有可发布正文（319 个统一来源）：只有来源标题/口径 179 个、只有结构化证据 73 个、社交备用 67 个。
corpus-only 来源 32 个（9 份 SUIBE 报告 + 3 份研究归纳 + 20 份方向方案），见 corpus-meta.json.source_registry_extra。
输出：data/import/out/corpus.jsonl（764 行）
统计：data/import/out/corpus-meta.json
sha256：1360ffe1b98f818e6a0341a3c5a0ef2bc0a0bf9a32f22d794a7e17260a97c178
```

## 5. 校验与计数

- 校验项：**73 项全部通过**（0 失败、0 致命失败）。覆盖：validation.json vs CSV 计数、7 类 record_type 计数、FK（records→sources、requirements→records、aliases→records/sources、documents→sources）、34 份文档哈希格式、17 个证据格、pilot 2+7 字段一致性、六个方向种子、canonical URL、文档嵌入版本、证据/要求版本引用、social 未升级、product-v2 排除、批次 ID 稳定性。
- 期望 vs 实际：

| 项目 | 期望 | 实际 |
|---|---:|---:|
| sources | 319 | 319 |
| records | 243 | 243 |
| requirements | 115 | 115 |
| aliases | 250 | 250 |
| documents | 34 | 34 |
| pilot 来源/指标 | 2 / 7 | 2 / 7（0 重复行） |
| directions / assessments | 6 / 1 | 6 / 1 |

- 记录类型：official_observation 57、municipal_metric 17、graduate_case_or_aggregate 15、destination 15、job 28、social_case 85、research_claim 26（合计 243）。
- 版本哈希：原件文件哈希 47（documents.csv 34 + 变体元数据 13，无重叠）；快照引用哈希 272。
- 要求：方向 finance 27 / data 22 / public 36 / trade 30；级别 required 57 / preferred 4 / mentioned 54；status **115 条全部 unverified**；映射方法 `term_keyword_and_parent_group` 74 条、`parent_job_group` 41 条。
- Pilot 映射（actual）：

| legacy | unified record |
|---|---|
| M001 | `rec_c720d2c002a3c4436f808636` |
| M002 | `rec_362faa5b72b5f29cc287a958` |
| M003 | `rec_8c42620914a30bf48dccfb2d` |
| M004 | `rec_1bd674a468a8780619d1936d` |
| M005 | `rec_c984e838b3427a3cbe21e791` |
| M006 | `rec_4ffc97a425faa347d184ac19` |
| M007 | `rec_12975509da7ab028778ea188` |

C17→`src_22a1f0f92dd412aa8d714538`、C18→`src_52bf62d992ae14b63febd2b3`；legacy id 记录在 `app_sources.metadata.legacy_ids`，不重复计入 319。

## 6. 只读核对 unified archive.sqlite

```bash
python3 -  # sqlite3.connect('file:.../archive.sqlite?mode=ro', uri=True)
```

```text
sqlite integrity_check: ok
foreign_key_check: []
count sources: 319
count records: 243
count documents: 34
count requirements: 115
count aliases: 250
record_type counts: social_case 85 / official_observation 57 / job 28 / research_claim 26 / municipal_metric 17 / graduate_case_or_aggregate 15 / destination 15
orphan records->sources: 0
orphan requirements->records: 0
orphan aliases->records: 0
orphan aliases->sources: 0
```

（只读打开，未修改快照；sqlite 与 CSV 计数一致。）

## 7. 幂等 / 可复现性核对

同一快照连续运行两次，以下值完全一致：

| 值 | 结果 |
|---|---|
| 批次 ID | `career-cloud-import-20261019-c11625d6fa97`（两次一致） |
| plan hash | `c11625d6fa9762963f7081144724308a4a462691fc57957b281af2093f875b99` |
| manifest 规范哈希 | `5d9bf235cf036c6985a8cc90a8af0bdfd8ef2e84f0822e0f5889e4d9910626a2` |
| 计数 / 73 项校验结果 | 两次一致 |
| corpus sha256 | `1360ffe1b98f818e6a0341a3c5a0ef2bc0a0bf9a32f22d794a7e17260a97c178`（两次一致） |

`--apply` 的“重复运行不增行”由主键 upsert 保证；**对真实数据库的行数核对未执行**（无凭据），不在此声称已验证。

## 8. 产物与哈希（本次实际生成）

| 文件 | 大小 | sha256 | 说明 |
|---|---:|---|---|
| `data/import/manifest.json` | 18,744 B | 文件整体 `ce6aad6ed4ce7590d80cae28d4c908c6811ebc00907a3534decb424c66569091`；规范内容 `5d9bf235…` | **可提交的审计 manifest**（快照文件哈希、实体集合 ID 哈希、种子哈希、pilot 别名、排除项、安全声明） |
| `data/import/out/import-report.json` | 26,694 B | `2b2626a2b2a7f505b4eb1b891ccbe44dbfef4389b45a4352b46fa2f0945b183b` | dry-run 报告（gitignored） |
| `data/import/out/corpus.jsonl` | 2,094,745 B（764 行） | `1360ffe1b98f818e6a0341a3c5a0ef2bc0a0bf9a32f22d794a7e17260a97c178` | worker 语料（gitignored） |
| `data/import/out/corpus-meta.json` | 122,937 B | — | corpus 统计/排除/corpus-only 来源登记（gitignored） |

manifest 内实体集合 ID 哈希：directions `b26a36f5…`、assessments `c1ecd6cd…`、sources `39a74cb4…`、source_versions `af54266f…`、evidence `5986561e…`、requirements `4d157d89…`、aliases `9246c8d3…`。

## 9. 不导入清单（dry-run 报告完整记录 13 项）

1. `docs/product-v2.md`：未核证提案数字（通过率/薪资/英语门槛/竞品），不进事实库与语料。
2. `supabase-pilot-2026-10-19/01-import.sql`：旧项目建表 SQL，只读参考、**绝不执行**。
3. pilot M001–M007：不重复导入；7 条 alias 映射到统一记录。
4. pilot C17/C18：不重复导入；映射到统一 `src_*`，legacy id 进 metadata。
5. 34 份文档（32 培养方案 PDF + 2 补档附件）：只登记哈希与元数据，不解析正文。
6. 2023/2024 届 OCR 提取稿：标签-数值配对系统性错位，不进语料。
7. social_case 社交备用：保留在库（included=false），不进语料、不升级。
8. research_claim/job 中 included=false 的记录：保留审计，不作为事实结论。
9. 17 个精确证据格：派生映射视图，不是新表/新正文。
10. `file-audit.json/csv`、`documents.md`：审计元数据，不是实体数据。
11. `web/plans` 重复副本 20 份（`m01 2.md`…）：内容哈希相同，只收 20 份。
12. 旧数据库/压缩包、页面截图副本、原始采集/运行文件：未随快照提交，无导入对象。
13. `app_courses`/`app_credit_rules`/`app_requirement_actions`：无结构化来源，保持空表。

## 10. `--apply` 状态：未执行

- **未执行原因**：没有 `SUPABASE_URL` / `SUPABASE_SECRET_KEY`，且任务要求不得把凭据写入文件。
- 无凭据保护已验证：`env -u SUPABASE_URL -u SUPABASE_SECRET_KEY npx tsx scripts/import-research.ts --apply` → 提示缺少环境变量，**退出码 2，未连接数据库、未写任何行**。
- 待授权的执行命令：

```bash
# 仅在本地受保护环境变量中提供凭据（不要写进仓库/日志）
SUPABASE_URL=... SUPABASE_SECRET_KEY=... npx tsx scripts/import-research.ts --apply
```

- 执行后产物：`data/import/out/apply-report.json`（含 `status`、逐表行数、真实表计数、回滚信息）。
- 失败回退方式（代码已实现，未真实触发）：
  1. 写库前记录 7 张表主键快照；
  2. 任一步失败 → 按逆依赖顺序删除“仅本次新增”的行（子表先删），批次状态 `rolled_back` 并写 `error_code`；
  3. 无 batch 列 → 既有行更新不还原；复合键表按行精确删除；仍失败则批次 `failed` 并报告，不谎报成功。
- 风险提示：apply 前需确认目标项目已按顺序应用 `supabase/migrations/20261019000{100,200,300,400,500}_*.sql`；不要使用旧 `01-import.sql`。

## 11. 安全与权限声明

- 未执行旧 `01-import.sql`；未使用网络；未连接任何数据库。
- 未写入、打印或提交任何密钥；apply 代码只从环境变量取值，错误信息脱敏。
- 未导入真实学生个人信息；快照为官方汇总/招聘快照/研究摘要/社交备用（备用不进语料）。
- 未把私有 GitHub raw URL 当公开引用；`storage_path` 全部 NULL。
- 所有记录路径均为相对路径（`../smart-campus-career/...`、`data/research/...`、`web/plans/...`）；`manifest.json`、报告、corpus-meta 中无 `/Users/...` 绝对路径。
- 未修改 `src/**`、`worker/**`、`supabase/**`、`package.json`、`docs/architecture/**`、根目录文档；未 git commit/push。

## 12. 验收对照

| 验收项 | 结果 |
|---|---|
| `npx tsx scripts/import-research.ts --dry-run` 真实跑通并打印计数 | ✅ 退出码 0，73/73 校验通过 |
| `npx tsx scripts/build-corpus.ts` 生成 corpus.jsonl 并给统计 | ✅ 764 chunks / 408,104 字符 / sha256 `1360ffe1…` |
| 用 python/sqlite 只读核对 unified archive.sqlite 计数与 FK | ✅ 见 §6 |
| dry-run 报告实际输出，不声称 --apply 执行 | ✅ 本文与 `out/import-report.json` |
| 不 git commit/push、不碰他人文件 | ✅ 仅新增本任务范围内文件 |
| 阻塞点 | `--apply` 等待 Supabase 凭据；SUIBE 2023/2024 无可靠机器提取正文（只有 OCR 稿）；2025 届报告缺失；34 份原件未上传 Storage；32 个 corpus-only 来源待 worker 登记 |
