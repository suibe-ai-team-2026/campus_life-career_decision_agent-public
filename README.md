# 知途（Campus Pathway）· 校园 AI 知识库助手

> **比赛主项目仓库**。赛事：首届「数字赋能经贸，智创未来校园」AI 创新应用大赛。
> 团队：Organization `suibe-ai-team-2026`（秦翰 @turtojian520、吴迪仪 @Jade-soleil、彭烨 @cactusye79）。
> 选题与决策以工作空间仓库 [`ai-agent-competition-2026`](https://github.com/suibe-ai-team-2026/ai-agent-competition-2026) 为准。
>
> 产品名 **知途（Campus Pathway）** 由团队 2026-10-18 确定，取代此前文档中的「Genote / 生思笔记」作为**比赛版对外名称**；仓库 slug 为 `campus_life-career_decision_agent`。

## 仓库定位

本仓库由个人项目 **Genote（面向考研 / 考公学生的 AI 学习助手）** fork 而来，现作为团队的比赛主项目使用。**Genote 是 fork 上游的原产品名称，仅在描述来源与历史时保留**；本仓库代表的产品是知途。两者**产品方向并不相同**：

| 维度 | Genote 原产品 | 比赛版 |
|---|---|---|
| 产品定位 | 面向考研 / 考公学生的 AI 学习助手 SaaS | 通用校园 AI 知识库助手（办公 + 知识库 + RAG + 生成，生涯规划为模块） |
| 目标用户 | 备考学生 | 大一大二学生与校园用户 |
| 技术底座 | Open Notebook（Next.js + FastAPI + SurrealDB + Docker） | Next.js（Vercel）+ Supabase + Python Deep Agents / LangGraph + Freestyle VM |
| 商业模式 | 月度订阅 | 比赛 MVP 不接入支付 |

比赛版**复用** Genote 的原型界面、RAG 引用交互与 PRD 方法，但**不直接沿用**考研 / 考公的 C 端定位与订阅模式。逐项映射见 [比赛版对齐说明](docs/product-alignment.md)。

## 当前状态

| 项 | 状态 | 说明 |
|---|---|---|
| UI 原型 | 可用 | `prototype/`，React 18 + Babel CDN 单页，需联网 |
| PRD | v0.1 + 比赛版裁剪 | 见 `PRD_v0.1.md` 的「0.1 比赛版范围裁剪」 |
| 产品实现 | 未开始 | 待按共识技术底座搭建 |
| 部署 | 未部署 | 尚无正式演示地址 |
| 许可证 | 未授予 | 私有仓库，待团队与学校要求确认 |

## 快速开始

### 1. 打开 UI 原型（最快）

原型是静态文件，但 `.jsx` 由 Babel 通过 XHR 加载，`file://` 会被浏览器拦截，**必须经 HTTP 访问**；同时需联网加载 unpkg 的 React / Babel 与 Google Fonts。

```bash
cd prototype
python3 -m http.server 5500 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:5500/
```

### 2. 运行 Open Notebook 参考实现（非比赛主线）

`open-notebook-genote` 分支是 Genote 原产品基于 Open Notebook 的实现，作为**可复用参考**保留；比赛版技术底座以团队决策为准。

```bash
git clone --single-branch --branch open-notebook-genote https://github.com/suibe-ai-team-2026/campus_life-career_decision_agent.git open-notebook
cd open-notebook
docker compose up -d          # 访问 http://localhost:8502
```

手动启动前端开发：

```bash
cd open-notebook/frontend
npm install
npm run dev
```

`open-notebook/` 是独立 Git 工作树，已在 `.gitignore` 中忽略，不提交到本仓库 `main` 分支。

## 目录

| 位置 | 用途 |
|---|---|
| `prototype/` | UI 原型（React 18 + CDN Babel），可直接静态托管 |
| `docs/product-alignment.md` | 比赛版对齐说明：可复用 / 需改造 / 不采用 |
| `PRD_v0.1.md` | 需求文档；含比赛版范围裁剪章节 |
| `PRODUCT_CONTEXT.md` | 技术上下文与架构说明（fork 上游的原始实现） |
| `AGENTS.md` | 协作与 Agent 操作约束 |

## Genote 原功能与比赛版去向

| Genote 原功能 | 比赛版处理 |
|---|---|
| 学习库驾驶舱（考研倒计时、签到、学习指标） | 改造：换成校园学习 / 资料场景，去掉考研倒计时类文案 |
| 闪卡复习（SM-2 间隔重复） | 保留：对应共识中的「学习 Studio」闪卡 |
| 专注模式（三档切换） | 保留：通用 UI 能力 |
| 视频时间戳同步问答 | 保留：长视频学习场景 |
| ⌘K 命令面板 | 保留：全局搜索与 AI 提问入口 |
| RAG 聊天 / 来源引用（Open Notebook） | 参考：按共识架构重写「只用所选资料 + 引用」的问答 |
| 订阅计费（Stripe） | 暂缓：比赛 MVP 不接入支付 |
| 生涯规划 | 新增：原型中没有，按 v2 三段式探索漏斗新做 |

## Genote 原架构（参考）

基于 **Open Notebook**（23k+ stars，MIT）扩展：学习库、闪卡复习、专注模式、视频时间戳、暖琥珀暗色主题；Open Notebook 原有的 RAG 聊天、播客生成、内容转换、多模型切换保留。完整说明见 [`PRODUCT_CONTEXT.md`](PRODUCT_CONTEXT.md)。比赛版不沿用其 Docker 自托管形态与 SurrealDB 数据层。

## 团队与协作

| 姓名 | GitHub | 年级 / 专业 | 仓库角色 |
|---|---|---|---|
| 秦翰 | @turtojian520 | 大三 / 国际经济与贸易（全英） | Organization Admin、仓库 Admin |
| 吴迪仪 | @Jade-soleil | 大一 / 国际经济与贸易 | developers，Write |
| 彭烨 | @cactusye79 | 研一 / 旅游管理 | developers，Write |

- 仓库保持**私有**，权限由 Organization `developers` 团队控制。
- 会议记录、选题决策与申报材料在 [`ai-agent-competition-2026`](https://github.com/suibe-ai-team-2026/ai-agent-competition-2026)，本仓库只负责产品原型与实现。
- 短期任务分支（`feat/`、`fix/`、`docs/`）通过 PR 合并到 `main`；不保留个人长期分支。
- 不提交 `.env`、密钥、真实学生数据和未授权课程材料。

## 相关文档

- 比赛版对齐说明：[`docs/product-alignment.md`](docs/product-alignment.md)
- 团队工作空间：[`suibe-ai-team-2026/ai-agent-competition-2026`](https://github.com/suibe-ai-team-2026/ai-agent-competition-2026)
- 选题决策：`docs/discovery/decision.md`（工作空间仓库内）
- 会议记录：`docs/meetings/2026-10-15-选题确定.md`（工作空间仓库内）

## License

当前**未授予开源许可证**。仓库为私有；是否开源、采用何种许可，待团队确认学校与第三方资源要求后决定。知途参考的 Open Notebook 项目本身采用 MIT 许可，但本仓库不是它的发行版。
