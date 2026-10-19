# ADR 0001：纯生涯规划版本的实现范围与云端架构

- 日期：2026-10-19
- 状态：Accepted for implementation（实现中）
- 决策者：用户（项目负责人 @turtojian520）
- 关联：团队 `docs/discovery/decision.md`（2026-10-15）、`docs/meetings/2026-10-18-产品方向与功能取舍.md`、`smart-campus-career` PR #5/#6/#7

## 背景

团队 2026-10-15 的选题是「校园 AI 知识库助手，生涯规划为模块」，2026-10-18 讨论了把生涯向导作为亮点的取舍但未形成「彻底垂直化」的最终团队决议。2026-10-19 用户明确要求本次交付「纯生涯规划版本」，并指定 Next.js/Vercel + 比赛专用 Supabase + Freestyle worker + OpenRouter `qwen/qwen3-embedding-8b` 的架构。

## 决策

1. 本次实现范围收窄为五步生涯向导：定位 → 自我探索 → 方向认知 → 暂定方向 → 行动方案 → 导出分享；工具区只保留与生涯相关的资料问答/来源查看。
2. 该范围是**本次实现范围**，不改写 2026-10-15/10-18 的历史会议与决策；通用知识库能力保留为可复用底座，不在本次主线。
3. 技术架构按用户指定执行：
   - Next.js App Router / TypeScript / React 运行在 Vercel，同源 BFF。
   - Supabase（比赛专用组织的新项目）承载 Postgres/pgvector/Auth/私有 Storage/任务队列表。
   - 受信任 Python worker 部署在 Freestyle VM，主动领取任务；不向公网开放 Python 端口。
   - Embedding 固定 OpenRouter `qwen/qwen3-embedding-8b`，4096 维、L2 归一化；chat 使用 `deepseek/deepseek-chat`。
4. 代码落在 `suibe-ai-team-2026/campus_life-career_decision_agent` 的 `feat/career-cloud-wizard` 分支，保留 `prototype/` 的纯静态运行方式。
5. 研究快照 `smart-campus-career` main `ba2794b`（unified-2026-10-19）为数据源；不从同学 Supabase 项目复制数据，不执行旧 `01-import.sql`。

## 不在本次范围

支付/订阅、播客、视频、泛办公生成、任意网页抓取、移动端原生 App、离线模式、协作编辑、完整六方向规则库、32 份培养方案 PDF 的课程结构化。

## 后果与约束

- 课程/竞赛/学分规则资料不足时，Step 4 必须返回 `data_unavailable`、`credits=null` 与核对任务，不能用 LLM 编造。
- 17/600 精确同专业证据格不代表其余格为零；243 条统一记录不是 243 名毕业生；`product-v2.md` 的通过率/薪资/英语门槛是未核证提案，禁止进事实库。
- 六个方向 ID 是产品导航分类，不是官方就业分类；同一岗位可多对多映射。
- 4096 维向量可存储但超出 pgvector HNSW/IVFFlat 常规索引上限，第一版只用精确 cosine 扫描；规模增长另建 MRL profile 并全量重建。
- 部署前必须完成 Supabase/Vercel/Freestyle 的资源归属、套餐与权限确认；未获授权不升级付费套餐、不公开私有仓库、不修改同学数据库。

## 备选方案

- 复用 `ltxgjjcxuvqwnjtpegye` 同学项目：未验证当前账号写权限与所有者授权，且会引入既有 `career_*` 表与权限混用，故不作为默认；仅在所有者明确授权且约定可写范围后评估。
- 继续只做 RAG demo：不能满足五步旅程、权限隔离、异步任务与 PDF 导出要求，故不作为本次交付。

## 验收

见 `docs/acceptance.md` 与 `docs/deployment.md`；所有完成声明必须附实际命令/响应或部署证据。
