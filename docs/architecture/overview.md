# 知途（Campus Pathway）· 纯生涯规划版本架构

状态：实现中（2026-10-19）。本文件是新 ADR 的正文入口；范围与管理决策见 `docs/adr/0001-career-cloud-wizard-scope.md`。

## 1. 本次范围

- 纯生涯规划版本：五步旅程（首页定位 → 自我探索 → 方向认知 → 暂定方向 → 行动方案 → 导出分享）。
- 保留 `prototype/` 纯静态运行方式，不改其依赖。
- 不把支付、播客、视频、泛办公生成放进本次主线。
- 2026-10-15 团队选题「校园 AI 知识库助手」与 2026-10-18 产品方向讨论没有被改写；本次用户明确要求纯生涯规划版本，作为新的实现范围登记。
- 资料边界：`unified-2026-10-19` 的 319 来源 / 243 记录 / 115 招聘要求不是 243 名毕业生；17/600 精确格不代表其余格为零；培养方案 PDF 不等于结构化课程表；`product-v2.md` 的通过率、薪资、英语门槛等未核证提案不得进入事实库。

## 2. 运行架构

```
浏览器（五步向导 / 本地进度 / 来源面板 / 任务进度 / PDF 下载）
  │ HTTPS 同源
Vercel / Next.js App Router（BFF：JWT、Zod、所有权、限流、签名地址）
  │ Supabase Auth JWT + 用户态 server client（RLS 生效）
Supabase（Postgres + pgvector + Auth + 私有 Storage + jobs 队列表）
  │ worker 主动 claim（不向公网开放 Python 端口）
Freestyle 云端 worker（LangGraph 固定流程；Docling；OpenRouter Qwen3 Embedding 8B；OpenRouter chat；PDF）
```

- 浏览器只拿 Supabase URL + publishable key；service/secret key 只在 BFF 与 worker。
- worker 通过 `public.worker_*` SECURITY DEFINER 函数领取任务、续租、发布结果；`(worker_id, lease_epoch)` 做 fencing，旧 worker 不能发布。
- 队列是 Supabase Postgres `app_private.jobs` 表（不是 pgmq，也不声称已接托管 Queues）。
- 检索在 SQL 候选集阶段按 `visibility`/`owner_id` 过滤；4096 维向量用精确 cosine 扫描，不建超出 pgvector 限制的 ANN 索引。

## 3. 目录与模块边界

| 目录 | 职责 | 负责人 |
|---|---|---|
| `src/app/api/` | BFF 路由；不解析整份 PDF、不跑常驻 Python | Lead |
| `src/lib/contracts/` | Zod DTO 与错误码，前后端共享 | Lead |
| `src/lib/supabase/` | browser / server 用户态 / server-only admin | Lead |
| `src/app/(wizard)/`、`src/components/` | 五步 UI 与本地进度 | web-dev |
| `worker/` | 队列消费、解析切块、OpenRouter、检索、规则、PDF | worker-dev |
| `supabase/migrations/` | 表、RLS、函数、Storage 策略 | Lead |
| `data/import/`、`scripts/import-research.ts` | 研究快照导入 manifest、别名、校验 | data-dev |
| `docs/` | ADR、权限矩阵、数据字典、部署、回滚、验收证据 | Lead + QA |

前后端共享 `src/lib/contracts`；Python worker 用 Pydantic 校验同一语义。页面不直接解析 CSV/规则文件。

## 4. 六个方向 ID（产品导航分类）

`trade_supply_chain`、`cross_border_business`、`finance_accounting`、`data_business`、`public_service`、`further_study`。
这是一套产品导航分类，不是本校官方就业分类；同一岗位可映射多个方向。数据目录里尚未冻结稳定 ID，采用本实现集合并登记在 ADR/数据字典。

## 5. 规则引擎边界

- 规则与数字由 `engine.query(direction_id, profile, rules_version)` 确定性计算；LLM 只解释，不改实体和数字。
- 第一闭环优先国贸相关方向；课程/竞赛/学分资料缺失时返回 `data_unavailable`、`credits=null` 与核对任务，不伪造。
- 合成 fixtures 只用于算法测试，不进入正式规则库。

## 6. Embedding（用户指定，不可替换）

- Provider：OpenRouter；模型：`qwen/qwen3-embedding-8b`；4096 维；L2 归一化。
- 查询模板版本 `career-qwen-v1`；文档片段不加 query instruction。
- Chat：`deepseek/deepseek-chat`（OpenRouter）。
- 切换模型/维度/模板必须新建 profile、全量重建、回归后原子切换 `active`；绝不混入 BGE/512 维向量。
- 真实账号权限、余额、返回维度与耗时必须在部署探针确认；本仓库不预置密钥。
