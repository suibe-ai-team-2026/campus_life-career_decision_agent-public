# 参考数据来源与边界（schools / employment / curriculum）

生成日期：2026-11-02。生成者：知途数据接入子任务（Agent）。
文件：`worker/app/reference_data/schools.json`、`employment.json`、`curriculum.json`、本说明。

## 1. 输入资料

| 文件 | 用途 | 规模 |
|---|---|---|
| `smart-campus-career/data/research/unified-2026-10-19/dataset.json`、`sources.csv`、`records.csv` | 七校就业事实与来源登记的背景核对 | 319 来源 / 243 记录 |
| `smart-campus-career/data/research/suibe-2026-10-17/suibe_main.sqlite` | 上经贸培养方案目录：`programs` 32、`documents` 32（2024 级 13 份 + 2025 级 19 份 PDF 路径与下载链接） | 32 份 PDF |
| `campus_life-career_decision_agent/data/import/out/corpus.jsonl` | 上经贸 2021/2022 届就业质量报告机器提取文本（`chunk_text` + 行号 locator）；培养方案只有来源登记卡，无课程表正文 | 764 chunks |
| `ai-agent-competition-2026/data/employment/metrics-pending-2021-2025.json` | 七校 2021–2025 共 40 条 pending 数值事实 + 1 条东华勘误 | 41 条 |
| `ai-agent-competition-2026/data/employment/coverage-2021-2025.json` | 七校 × 五届共 35 格覆盖状态 | 35 格 |
| `ai-agent-competition-2026/data/sources.csv` | 24 条来源登记（含 `sv=` 映射、官网 PDF URL） | 24 条 |
| `ai-agent-competition-2026/data/curriculum/shlixin-accounting-2024.courses.json` | 上海立信会计金融学院会计学课程表（外校对照样例） | 116 门 |
| 教务处培养方案栏目（2025-09-18 页面） | 补下 8 个缺失专业的 2025 级培养方案 PDF（电子商务、投资学、工商管理（国际企业管理方向）、文化产业管理、会展经济与管理（中德合作）、旅游管理、国际政治、经济学（国际投资方向）） | 8 份 PDF |

## 2. 生成方法

### schools.json
7 所学校来自覆盖表的学校集合（东华、华东政法、上外、立信、上海工程技术、上经贸、上海视觉艺术学院）。官网地址取自学校公开主页；`employment_report_url` 取团队 `data/sources.csv` 中该校最新一届就业质量报告 URL，取不到时为 `null`。

### employment.json
- **54 条事实**：41 条来自 `metrics-pending`（40 条数值事实 + 1 条东华 2021 勘误），13 条来自 `corpus.jsonl` 中上经贸 2021/2022 届报告的机器提取文本。
- 每条事实带 `quote`（原文短引文，截断到 ≤120 字，未改写）+ `locator` + `source_title` + `source_url`。
  - 来自 `metrics-pending` 的事实：`locator` 沿用其页码（如「第 11 页（机器提取文本）」）；`source_url` 通过 `data/sources.csv` 的 `sv=` 映射回官网 PDF/附件 URL。
  - 来自 corpus 的上经贸事实：报告全文是机器提取文本，**没有可靠页码**，`locator` 用「文件路径 + 第 X–Y 行」，不伪造页码；`source_url` 取自 `data/sources.csv` 的 2021/2022 报告 URL。
- 仅收录能核到引文与定位的数字；找不到的（2023、2025 届，以及 2024 届除毕业生总数外的指标）没有补造，记在 `coverage` 的缺口里。
- **不跨校/跨届别相减或排名**；不同口径只在 `note`/`scope` 说明。
- `verification_status`：`pending` 53 条（机器提取、未逐条人工复核）；`official_lead` 1 条（东华 2021 勘误，研究层已做视觉核对）。全部 `production_eligible: false`。

上经贸覆盖（`coverage`）：2021 `extracted`、2022 `extracted`、2023 `restricted`（该届报告未取得）、2024 `extracted`（仅图片摘要，仅提取到毕业生总数 4188）、2025 `unavailable`（栏目最新为 2024）。

### curriculum.json
- **40 个专业条目 / 2004 门课程**：32 个条目来自 `suibe_main.sqlite` 已下载的 2024/2025 级官方培养方案 PDF（13 + 19），8 个条目来自 2026-11-02 从教务处 2025-09-18 栏目补下的 2025 级 PDF。
- 每份 PDF 用 `pdftotext -layout` 与 `-raw` 提取：
  - 课程名来自「课程体系与毕业要求关联度矩阵」（raw 文本中的编号列表）；
  - 学分/学时来自「八、教学计划表」的版式文本，按行匹配课程名；
  - 开课学期根据教学计划表表头的第 1–8 学期列位置推断（如「1上」「3下」）；列对不齐时留 `[]`；
  - 培养方案 PDF 属官方来源、机器提取、未逐门人工复核 → `verification_status: official_lead`。
- `skills` 与 `direction_ids` 是按课程名关键词的保守启发式映射（研究/数据/写作/沟通/执行/数字工具；6 个方向 id），**不是官方技能矩阵**；无法判断时留空数组。
- `prerequisites` 一律 `[]`：培养方案 PDF 未提供可逐门解析的先修结构，不猜测。
- `fallback_courses`：复用 `worker/app/planning.py` 的 `COURSE_LEADS` 思路（6 个方向各 3–5 门通用课程线索），`note` 标明「方向通用线索，学分与学期以教务处当年培养方案为准」。
- `external_reference_samples`：上海立信会计金融学院会计学 2024 级课程表 116 门，仅作外校结构对照，不用于上经贸学生推荐或学分认定。
- 覆盖的 16 个目标专业：国际经济与贸易（全英语）、金融学、会计学、财务管理、审计学、电子商务、工商管理（国际企业管理方向）、法学、商务英语、数据科学与大数据技术、投资学、经济学（国际投资方向）、旅游管理、文化产业管理、国际政治、会展经济与管理（中德合作）均已覆盖。

## 3. 数据缺口与已知误差

- 就业：2023、2025 届上经贸指标缺失；2024 届仅有毕业生总数；只有校级/学历级口径，**没有分专业就业率**；部分数值无分母/统计截止日，不能做比率换算。
- 课程：14 门课程学分缺失；16 门课程学期为空；全部课程无先修结构；373 门课程未匹配到技能标签；培养方案表格由机器提取，可能出现课程名与模块名粘连、跨行合并、学分列错位（使用前应回原 PDF「教学计划表」核对）。
- 2025 级 8 个补下专业的 PDF 来自教务处 2025-09-18 栏目，页面链接与 PDF 版本可能随学校更新变化；抓取日期为 2026-11-02。
- 外校（立信）课程样例只作对照，**不是**上经贸课程，也不代表上经贸学分或培养方案。
- 所有引文均为机器提取后的原文截取；`metrics-pending` 的页码来自团队研究层，未在本任务中重新逐页核对。

## 4. 使用边界（必须遵守）

1. 本目录数据只用于**产品展示与规划参考**，不得写入生产规则、不得作为默认 RAG 检索依据、不得对外宣称「已核验」。
2. 课程与就业数据不在同一时间轴：2024/2025 级培养方案对应 2028/2029 届，就业数据是 2021–2024 届；**不能写「学了这门课所以就业好」**，只能并列展示。
3. 不得跨校、跨届别相减或排名；口径不一致时只展示、不比较。
4. 课程学分/学期/课程名在使用前需回原 PDF 人工核对；就业数字需回官网报告核对。
5. 外校课程（立信）不得用于上经贸学生的课程推荐或学分认定。

## 5. 校验

- `python -c "import json; json.load(open(...))"` 三个 JSON 均可解析。
- counts：schools 7；facts 54（suibe 18 / sues 13 / dhu 10 / lixin 7 / shisu 4 / ecupl 2）；coverage 35 格；majors 40；courses 2004；fallback 6 个方向共 24 条；external 1 条。
- 所有 fact 均含 `quote`、`locator`、`source_title`、`source_url`（找不到 URL 的为 `null` 的规则未触发；本次全部有 URL）。
