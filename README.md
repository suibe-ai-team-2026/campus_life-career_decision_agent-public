# 知途（Campus Pathway）· 纯生涯规划版

> 比赛主项目仓库。赛事：首届「数字赋能经贸，智创未来校园」AI 创新应用大赛。
> 团队：Organization `suibe-ai-team-2026`（秦翰 @turtojian520、吴迪仪 @Jade-soleil、彭烨 @cactusye79）。
> 产品名 **知途（Campus Pathway）** 由团队 2026-10-18 确定；仓库 slug 为 `campus_life-career_decision_agent`。

当前分支 `feat/career-cloud-wizard` 实现用户明确要求的**纯生涯规划版本**：五步向导（定位 → 自我探索 → 方向认知 → 暂定方向 → 行动方案 → 导出分享），复用既有研究资料，采用 Next.js/Vercel + Supabase + Freestyle worker + OpenRouter 云端架构。范围登记见 [`docs/adr/0001-career-cloud-wizard-scope.md`](docs/adr/0001-career-cloud-wizard-scope.md)。

## 当前状态（2026-10-19）

| 项 | 状态 | 说明 |
|---|---|---|
| 五步向导前端 | 已实现 | Next.js 16 App Router + React 19 + TypeScript；本地进度、跳过、方向切换、方案调整、导出空态 |
| BFF | 已实现 | 同源 API：画像、run 提交/轮询/取消、方案、来源、PDF 签名下载、健康检查 |
| 数据库/RLS | 已应用并验证 | Supabase 项目 `cvohcdzfscoxytmpbwsk`（org `suibeAIproductcompe`，us-east-2）：7 个迁移、24 表全部 RLS、33 policy、2 私有 bucket；数据已导入 |
| Freestyle worker | 已部署并跑通 | VM `vm-7f674dd9ed5d422b880f5bec7fe9f734` / `campus-pathway-worker-dev`；plan/ask/export 均 succeeded；单 worker，无公网端口 |
| 数据导入 | 已 apply | 319 来源 / 243 记录 / 115 要求 / 250 aliases / pilot 2+7；另有 32 个 corpus-only 来源，764 chunks/embeddings |
| 模型探针 | 已通过 | `qwen/qwen3-embedding-8b` 返回 4096 维、有限、L2 norm=1；chat `deepseek/deepseek-chat` 可用 |
| 云端部署 | 公开生产站已上线 | https://campuslife-careerdecisionagent.vercel.app （Vercel Hobby，CLI 部署；Git 自动部署待 GitHub org 安装 Vercel App） |
| 旧 `prototype/` | 归档参考 | 不再是产品入口；保留只读历史，避免破坏团队资产 |

## 快速开始（本地）

需要 Node.js 22+。用户无需安装 Docker。

```bash
npm install
cp .env.example .env.local   # 或从受保护文件注入；真实密钥不要提交
npm run dev                  # http://127.0.0.1:3000
npm run check                # typecheck + lint + vitest + production build
```

未配置 `NEXT_PUBLIC_SUPABASE_*` 时是本地演示模式：前四步与导出空态可用，云端生成/上传/PDF 明确禁用，不伪造结果。

配置了 Supabase 后，本地联调：

```bash
npm run dev -- -H 127.0.0.1 -p 3100
```

Python worker（本机默认 Python 3.14，必须用 3.12）：

```bash
cd worker
UV_CACHE_DIR=/tmp/uv-cache uv sync --python 3.12 --extra dev
UV_CACHE_DIR=/tmp/uv-cache uv run --python 3.12 pytest -q
UV_CACHE_DIR=/tmp/uv-cache uv run --python 3.12 python -m app.runtime.worker --check
```

## 目录

| 位置 | 用途 |
|---|---|
| `src/app/` | 首页、五步路由、工具区、BFF API routes |
| `src/components/wizard/` | 五步交互、方向对比、方案、来源/引用卡 |
| `src/lib/contracts/` | Zod DTO 与错误码（前后端共享） |
| `src/lib/supabase/` | browser / server 用户态 / server-only admin |
| `src/lib/runs/` | 幂等、所有权校验、预算/限流 |
| `worker/` | Python 3.12 worker：队列、解析、embedding、检索、规则、PDF |
| `supabase/migrations/` | 表、RLS、函数/队列、Storage 策略 |
| `scripts/` | 研究导入、corpus 构建、模型探针、smoke |
| `data/import/` | 导入 manifest 与产品种子；生成物 gitignored |
| `docs/` | ADR、架构、权限/安全、数据字典、部署、验收 |
| `prototype/` | 旧 Genote/比赛初期 UI 原型，仅历史参考 |

## 数据边界（必须保留）

- `unified-2026-10-19`：319 来源、243 条分类记录、115 条招聘要求、34 文件引用；**不是 243 名毕业生**。
- 17/600 精确同专业证据格不代表其余格为零，也不代表全矩阵已完成逐格检索。
- 32 份培养方案 PDF 只有原件/目录，**不等于**结构化课程、学期与先修表；缺数据时 `credits=null`、返回 `data_unavailable`，不编造。
- `docs/product-v2.md` 的约 5% 通过率、薪资、英语门槛等是未核证提案，禁止进入生产事实库。
- AI 三个不：不替用户做决定、不替用户算数、不编造；规则引擎管确定性计算，LLM 只解释。

## 文档

- 架构与契约：[docs/architecture/overview.md](docs/architecture/overview.md)、[contracts.md](docs/architecture/contracts.md)、[database.md](docs/architecture/database.md)
- 权限与密钥：[docs/architecture/security.md](docs/architecture/security.md)
- 部署 Runbook：[docs/deployment.md](docs/deployment.md)
- 验收清单：[docs/acceptance.md](docs/acceptance.md)
- 资源归属：[docs/team-infrastructure.md](docs/team-infrastructure.md)
- 导入记录与数据字典：[docs/import-record.md](docs/import-record.md)、[docs/data-dictionary.md](docs/data-dictionary.md)
- 团队工作空间：[`suibe-ai-team-2026/ai-agent-competition-2026`](https://github.com/suibe-ai-team-2026/ai-agent-competition-2026)

## 团队与协作

- 仓库保持私有；比赛主项目。公开只读副本用于 Vercel Hobby 部署，不含 Issues/PR/Secrets。
- 短期任务分支（`feat/`、`fix/`、`docs/`）通过 PR 合并到 `main`。
- 不提交 `.env`、密钥、真实学生数据和未授权课程材料；`prototype/` 不需要构建步骤。
- 用户只需浏览器；不依赖 Docker 或本地 Python 服务即可访问前端。

## License

当前未授予开源许可证。参考的 Open Notebook 项目为 MIT，本仓库不是其发行版。
