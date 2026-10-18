# 知途（Campus Pathway）产品需求文档（PRD）v0.1

> 编制日期：2026-05-05
> 信息源：通过 NotebookLM MCP 获取的 3 个项目 notebook 的全部 14 个 source（其中 6 份为内部设计文档，8 份为外部技术参考资料）。
> 严格约束：本文档**仅基于** NotebookLM 来源整理，未引入任何来源外信息；来源中未涵盖的事实统一以 `[FILL: …]` 占位符标注。
>
> **产品名说明（2026-10-18）**：本文件正文的全部条目编写于 fork 之前，当时的产品名为 Genote（生思笔记 / Singsi Note AI）。比赛版对外产品名已定为**知途（Campus Pathway）**，文件随之更名为 `PRD_v0.1.md`。下文的 0.1 节及术语表保留原始名称以便追溯，**不改写 v0.1 原始条目**；产品名的权威表述以本节和 [`docs/product-alignment.md`](docs/product-alignment.md) 为准。
>
> **冲突解决说明**：用户 prompt 的 *Output requirements* 要求"一份结构完整的需求文档"，*Constraints / Do-nots* 末尾出现"仅返回最终 rewritten prompt"字样（疑似 prompt 模板残留）。按 prompt 自带的优先级（Constraints > Required outputs），本响应正文保持精简、不复述文档；完整需求文档作为 deliverable 写入本文件。

---

## 0. 文档元数据

| 字段 | 值 |
|---|---|
| 项目名 | 原始条目：Genote（中文：生思笔记；英文别名：Singsi Note AI）。**比赛版产品名：知途（Campus Pathway）** |
| 文档版本 | v0.1（基于 NotebookLM 来源初版） |
| 编制人 | [FILL: 编制人] |
| 审批人 | [FILL: 审批人] |
| 状态 | 草稿（含信息缺口） |
| 适用版本 | Beta 0.1.x |
| 比赛版状态 | 见 0.1 节：按 2026-10-15 团队决策裁剪后使用 |

### 0.1 比赛版范围裁剪（2026-10-18 增量）

> 本 PRD 描述的是 Genote 原产品（面向考研 / 考公学生的 AI 学习助手 SaaS）。比赛版按团队 2026-10-15 决策及会后修订裁剪，权威结论见工作空间仓库 [`ai-agent-competition-2026`](https://github.com/suibe-ai-team-2026/ai-agent-competition-2026) 的 `docs/discovery/decision.md`。本节只标注处理方式，**不改写 v0.1 原始条目**，以便追溯。

**背景**：比赛选题为「校园 AI 知识库助手」——通用校园 Agent（办公辅助 + 来源整理成知识库 + RAG 提取 + 按内容生成），生涯规划作为其中一个模块，比赛版产品名**知途（Campus Pathway）**。fork 上游 Genote 的考研 / 考公定位、订阅模式与 Open Notebook 技术底座不直接进入比赛版。详细映射见 [`docs/product-alignment.md`](docs/product-alignment.md)。

**裁剪表**

| 原条目 | 比赛版处理 | 说明 |
|---|---|---|
| VIS-001 / VIS-002 目标用户 | 调整 | 改为校园用户（大一大二学生 + 知识库与办公场景用户），不再限定考研 / 考公 |
| VIS-003 大 PDF / 长视频问答 | 保留 | 对应共识中的资料问答与长视频学习 |
| VIS-004 商业量化指标 | 暂缓 | MVP 不做商业化验证 |
| SCOPE-IN-001 PDF RAG 问答 | 保留 | 强化为「只用所选资料 + 引用」 |
| SCOPE-IN-002 长视频时间戳 | 保留 | 进入长视频学习场景 |
| SCOPE-IN-003 笔记自动保存 | 保留 | 归入「学习 Studio」 |
| SCOPE-IN-004 Cmd+K 搜索 | 保留 | 全局搜索 / 快速提问 |
| SCOPE-IN-005 订阅计费（Stripe） | 暂缓 | MVP 不接入支付 |
| SCOPE-IN-006 签到 + 闪卡 | 调整 | 闪卡保留为学习 Studio 能力；签到 / 连胜降级为可选激励 |
| DEF-001 产品类型 SaaS 订阅 | 调整 | 比赛版为校园知识库 Agent，不做订阅 |
| DEF-005 商业模式 | 暂缓 | 同上 |
| BE 后端 RAG / 异步处理 | 调整 | 技术底座改为 Next.js（Vercel）+ Supabase + Deep Agents / LangGraph + Freestyle VM（见 decision.md） |
| 平台（Web / Next.js） | 保留 | 前端形态不变，部署改 Vercel |
| 移动端、离线、协作编辑（原范围外） | 维持不做 | 与决策一致 |

**新增需求（v0.1 未覆盖，比赛版必做）**

| 需求 | 说明 |
|---|---|
| 来源知识库 | 授权材料导入、解析、索引；只用所选资料回答并给出引用 |
| 办公交付 | DOCX / XLSX / PPTX / PDF / Markdown / CSV 交付 |
| 学习 Studio | 学习笔记、闪卡、测验、讲义、思维导图 |
| 生涯规划模块 | 按方案一 v2 三段式探索漏斗实现，作为 App 内主功能之一 |
| 联网研究 | 受控联网检索与来源标注 |
| VM 执行面 | Freestyle VM 隔离执行解析、浏览器与文档渲染（按决策） |
| 可溯源 | 每条推荐 / 回答可指出出处；LLM 输出结构化约束，解析失败降级 |

**待确认**（沿用会议记录编号）

| 编号 | 问题 | 影响 |
|---|---|---|
| Q2 | 赛道：融合应用产品还是智能体 | 演示侧重 |
| Q3 | 主体功能对应产品文档 | 是否另建比赛版 PRD |
| Q4 | Freestyle VM / Supabase 成本 | 技术底座可行性 |
| — | 比赛版对外产品名 | 材料与界面一致性 |

---

## 1. 目标与愿景

| ID | 内容 | 来源 |
|---|---|---|
| VIS-001 | 为中国考研、考公学生提供低成本 SaaS 学习辅助工具 | SRC-6 *"Niche: Chinese students prepping for Kaoyan (postgrad) and Gongka (civil service)."* |
| VIS-002 | 服务在校大学生与应届毕业生 | SRC-5 *"Target: University students and recent graduates."* |
| VIS-003 | 通过 AI 处理超大 PDF 与长视频，并提供时间戳同步的对话式问答，降低长时学习的认知负担 | SRC-1 + SRC-3 综合 |
| VIS-004 | 商业目标量化指标（MAU / 付费转化率 / 月留存） | [FILL: 来源未提供量化指标] |

---

## 2. 范围与边界

### 2.1 范围内（In-scope）

| ID | 能力 | 来源 |
|---|---|---|
| SCOPE-IN-001 | 大体量 PDF 阅读与 RAG 问答 | SRC-1, SRC-3, SRC-4 |
| SCOPE-IN-002 | 长视频播放、转录、时间戳同步聊天 | SRC-1, SRC-3 |
| SCOPE-IN-003 | 笔记自动保存 | SRC-2 |
| SCOPE-IN-004 | 文档全局搜索（Cmd+K） | SRC-2 |
| SCOPE-IN-005 | 订阅计费（基于 Stripe） | SRC-6 + SRC-10(Stripe) |
| SCOPE-IN-006 | 习惯养成机制（每日签到 + 闪卡） | SRC-6 |

### 2.2 范围外（Out-of-scope）

| ID | 项 | 状态 |
|---|---|---|
| SCOPE-OUT-001 | 移动端原生 App | [FILL: 来源仅提及 Web，未明确移动端是否在 v0.1 范围] |
| SCOPE-OUT-002 | 离线模式 / 协作编辑 / 跨设备同步 | [FILL: 来源未提及] |
| SCOPE-OUT-003 | 第三方平台导入（Notion、Anki 等） | [FILL: 来源未提及] |

### 2.3 平台

- 主形态：Web（基于 Next.js App Router，SSR / SEO 友好；服务器组件与流式渲染）—— SRC-1, SRC-7
- 其它平台：[FILL: 来源未提及]

---

## 3. 术语表

| 术语 | 解释 | 来源 |
|---|---|---|
| 知途 / Campus Pathway | 本仓库比赛版产品名（2026-10-18 定名） | 本文件顶部产品名说明 |
| Genote / Singsi Note / 生思笔记 | fork 上游原产品的不同命名，仅在追溯历史时使用 | 项目通用 |
| RAG | Retrieval-Augmented Generation，检索增强生成 | SRC-4 |
| Hybrid Search | BM25（稀疏检索） + Dense Vectors（稠密向量）联合检索 | SRC-4 |
| Re-ranking | 检索后重排序，用于提升精度 | SRC-4 |
| 考研（Kaoyan） | 中国硕士研究生统一招生考试 | SRC-6 |
| 考公（Gongka） | 中国公务员录用考试 | SRC-6 |
| Habit Loop | 用户留存机制，由每日签到 + 内置闪卡复习构成 | SRC-6 |
| Focus Mode | 专注模式，隐藏不必要工具栏的 UI 切换 | SRC-1, SRC-2 |
| Split-screen / Split-pane | 左右分屏视图（左文档、右 AI 聊天） | SRC-1, SRC-2 |
| Chunking | 文档切片：PDF 段落级语义切分；视频转录每 2-3 分钟切分 | SRC-4 |

---

## 4. 产品定义

| ID | 维度 | 定义 | 来源 |
|---|---|---|---|
| DEF-001 | 产品类型 | SaaS 订阅制学习辅助工具 | SRC-6 标题 *"Cost-Effective SaaS Subscription Growth Strategy"* |
| DEF-002 | 目标用户 | 在校大学生 / 应届毕业生 / 考研 / 考公备考人群 | SRC-5, SRC-6 |
| DEF-003 | 核心场景 | 长时学习；处理超大 PDF 与长视频；AI 对话式提取知识点；笔记记录与复习 | SRC-1, SRC-2, SRC-3, SRC-4 |
| DEF-004 | 形态 | Web 应用（Next.js + React） | SRC-1, SRC-7, SRC-8 |
| DEF-005 | 商业模式 | 月度订阅（15-25 RMB）+ 多种计费模型支持（flat-rate / per-seat / usage-based / tiered / variable / multi-currency） | SRC-6 + SRC-10(Stripe) |
| DEF-006 | 核心差异化 | 专注度（Focus Mode、深色默认）+ 时间戳同步聊天（视频学习场景） + 低成本 LLM（DeepSeek） | SRC-1, SRC-2, SRC-4, SRC-6 |

---

## 5. 功能需求

> 优先级标记：P0 = 必须，P1 = 重要，P2 = 期望，P3 = 运营/非产品功能。

### 5.1 前端模块（FE）

| ID | 名称 | 描述 | 优先级 | 来源 |
|---|---|---|---|---|
| **REQ-FE-001** | PDF 阅读器 | 使用 react-pdf 稳健渲染大型 PDF | P0 | SRC-1 *"PDF Viewer: react-pdf for robust rendering of massive PDF documents."* |
| **REQ-FE-002** | 视频播放器 | 嵌入式 HTML5 播放器，并带时间戳同步聊天 | P0 | SRC-1 *"Video Player: Embedded optimized HTML5 player with timestamp-synced chat."* |
| **REQ-FE-003** | 分屏视图 | 左侧文档 / 右侧 AI 聊天；分隔条可拖拽调整 | P0 | SRC-1 + SRC-2 |
| **REQ-FE-004** | 文档搜索（Cmd+K） | 键盘快捷键 Cmd+K 唤起文档搜索 | P1 | SRC-2 *"Fast navigation - keyboard shortcuts (Cmd+K) for document search."* |
| **REQ-FE-005** | 笔记自动保存 | 长时学习中防止数据丢失 | P0 | SRC-2 *"Auto-save notes - prevent data loss during long study sessions."* |
| **REQ-FE-006** | 专注模式 | Focus Mode 切换可隐藏工具栏 | P1 | SRC-1 + SRC-2 |
| **REQ-FE-007** | 默认深色模式 | 默认 dark mode，长文阅读高对比度排版 | P1 | SRC-1 *"dark mode default"* + SRC-2 *"High-contrast typography"* |
| **REQ-FE-008** | UI 组件库 | 基于 TailwindCSS + shadcn/ui 的极简组件 | P0（技术约束） | SRC-1, SRC-9 |
| **REQ-FE-009** | 全局状态 | 使用 Zustand 管理分屏宽度、活动文档等全局 UI 状态 | P0（技术约束） | SRC-1 |
| **REQ-FE-010** | UX 原则 6–10 | UX 原则补全 | [FILL: 来源仅列出 5 条 UX 原则，第 6-10 条不在来源中] | RISK-005 |

### 5.2 后端 RAG / 异步处理（BE）

| ID | 名称 | 描述 | 优先级 | 来源 |
|---|---|---|---|---|
| **REQ-BE-001** | 异步任务队列 | Celery + Redis 队列处理重型 PDF，避免阻塞主线程 | P0 | SRC-3 |
| **REQ-BE-002** | 视频转录 | Whisper API 或本地 Whisper medium，二选一 | P0 | SRC-3 |
| **REQ-BE-003** | 文档解析与索引编排 | 使用 LlamaIndex 完成解析、切分、索引 | P0 | SRC-4 |
| **REQ-BE-004** | 向量化（Embedding） | BAAI/bge-m3 或 OpenAI text-embedding-3-small（成本允许时云端，否则本地） | P0 | SRC-3 |
| **REQ-BE-005** | 向量数据库 | Qdrant 或 Pinecone | P0 | SRC-4 |
| **REQ-BE-006** | 切分策略 | PDF 段落级语义切分；视频转录每 2-3 分钟时间切分 | P0 | SRC-4 |
| **REQ-BE-007** | 检索策略 | Hybrid search (BM25 + Dense Vectors) + Re-ranking | P0 | SRC-4 |
| **REQ-BE-008** | LLM 推理 | DeepSeek-Coder / DeepSeek-Chat（成本敏感推理） | P0 | SRC-4 |

### 5.3 商业化与运营（BIZ）

| ID | 名称 | 描述 | 优先级 | 来源 |
|---|---|---|---|---|
| **REQ-BIZ-001** | 订阅定价 | 月度订阅 15-25 RMB；DeepSeek API 成本基准约 $0.14/1M tokens | P0 | SRC-6 |
| **REQ-BIZ-002** | Stripe 计费 | 自动化订阅、发票、阶梯定价、多币种 | P0 | SRC-10(Stripe) |
| **REQ-BIZ-003** | 留存机制 | 每日签到 + 内置闪卡复习 | P1 | SRC-6 *"Building habit loops (daily check-ins, flashcard review built-in)."* |
| **REQ-BIZ-004** | 增长渠道 | B 站 / 小红书 study-with-me 影响者推广 | P2（运营） | SRC-6 |
| **REQ-BIZ-005** | 创业补贴申请 | 在闵行注册 LLC + 学生创业者身份；申请办公场地租金、初创社保、首次创业 8000 RMB 一次性补贴 | P3（运营，非产品） | SRC-5 |

---

## 6. 非功能需求

| ID | 类型 | 内容 | 来源 |
|---|---|---|---|
| **NF-PERF-001** | 性能 | 重型 PDF 处理走异步队列，不阻塞主线程 | SRC-3 |
| **NF-PERF-002** | 性能 | 切片粒度：PDF 段落级 / 视频每 2-3 分钟，保证检索精度 | SRC-4 |
| **NF-PERF-003** | 性能 | 首屏加载 SLA / 检索响应时间 SLA / 转录速率 | [FILL: 来源未提供量化 SLA] |
| **NF-AVAIL-001** | 可用性 | 系统可用性 SLA | [FILL: 来源未提供] |
| **NF-SCAL-001** | 扩展性 | 后端解耦：LlamaIndex（编排）+ Qdrant/Pinecone（向量）+ Celery/Redis（异步）+ DeepSeek（推理），支持水平扩展 | SRC-3, SRC-4 |
| **NF-SCAL-002** | 扩展性 | 单文件大小上限 / 并发用户上限 | [FILL: 来源仅说"massive PDFs"和"long videos"，未给数值] |
| **NF-MAIN-001** | 可维护性 | 前端 Zustand 集中管理 UI 状态 | SRC-1 |
| **NF-MAIN-002** | 可维护性 | 后端组件分层独立，可替换（embedding / vectorDB / LLM 均提供二选一） | SRC-3, SRC-4 |
| **NF-UX-001** | UX | 默认深色模式 | SRC-1 |
| **NF-UX-002** | UX | 高对比度排版（长文阅读） | SRC-2 |
| **NF-UX-003** | UX | 极简界面，隐藏不必要工具栏，降低认知负荷 | SRC-2 |
| **NF-UX-004** | UX | 提供键盘快捷键导航 | SRC-2 |
| **NF-UX-005** | 可访问性 | WCAG 等级 / ARIA 支持 | [FILL: 来源未提及] |
| **NF-SEC-001** | 安全 | 用户认证 / 会话管理 / 密钥管理 | [FILL: 来源未提供] |
| **NF-SEC-002** | 合规 | 数据隐私 / 用户数据出境 / 学生用户合规 | [FILL: 来源未提供] |
| **NF-I18N-001** | 国际化 | Stripe 计费支持多币种 | SRC-10(Stripe) |
| **NF-I18N-002** | 国际化 | UI 多语言 / 视频转录支持的语言列表 | [FILL: 来源未提供] |
| **NF-COST-001** | 成本 | LLM 优先使用 DeepSeek（低成本）；嵌入模型默认本地；视频转录可使用本地 Whisper medium | SRC-3, SRC-4, SRC-6 |

---

## 7. 接口与数据字典

### 7.1 外部依赖接口

| ID | 接口 | 用途 | 来源 |
|---|---|---|---|
| **INT-001** | DeepSeek API（DeepSeek-Coder / DeepSeek-Chat） | LLM 推理 | SRC-4 + SRC-10(DeepSeek API Docs) |
| **INT-002** | Whisper API 或本地 Whisper medium | 视频转录 | SRC-3 |
| **INT-003** | OpenAI Embeddings（text-embedding-3-small） 或 本地 BAAI/bge-m3 | 文本向量化 | SRC-3 |
| **INT-004** | Qdrant API 或 Pinecone API | 向量存储与相似度搜索 | SRC-4 |
| **INT-005** | Stripe Billing API | 订阅、发票、阶梯定价、多币种支付 | SRC-10(Stripe) |
| **INT-006** | LlamaIndex 编排 | 文档解析与索引 | SRC-4 + SRC-10(LlamaIndex) |
| **INT-007** | Next.js App Router 服务端组件 + 数据获取 | 前端页面与数据流 | SRC-1, SRC-7 |
| **INT-008** | React Hooks 与 Reference API | 前端逻辑 | SRC-8 |

### 7.2 内部 API

| ID | 端点 | 状态 |
|---|---|---|
| INT-INT-001 | 文档上传 / 索引状态 / 检索 / 对话 / 笔记 CRUD / 用户与订阅 | [FILL: 来源未提供具体 REST/GraphQL endpoint 与 schema] |

### 7.3 数据字典

| 实体 | 关键字段 | 来源/状态 |
|---|---|---|
| Document（文档） | id, title, type(pdf/video), size, upload_at, status, owner_id | [FILL: 来源未列出字段；建议字段] |
| Chunk（文档块） | id, document_id, type(text/transcript), 段落号或视频时间区间[startSec, endSec]（视频每 2-3 分钟）, embedding_vector | 来源仅给出切分粒度（SRC-4），完整字段 [FILL] |
| Embedding | model(bge-m3 / text-embedding-3-small), dim, distance_metric | [FILL: 维度与距离度量未在来源中给出] |
| Note（笔记） | id, document_id, content, last_saved_at（自动保存） | SRC-2 仅说明自动保存，字段 [FILL] |
| Conversation / Message | id, document_id, role, content, timestamp_ref（视频时间戳） | SRC-1 *"timestamp-synced chat"*；其余字段 [FILL] |
| User | id, role(student / graduate), email, … | [FILL: 来源未列字段] |
| Subscription | id, user_id, plan, price_rmb(15-25), currency, billing_model(flat-rate / per-seat / usage-based / tiered / variable / multi-currency), status, period | 价位与模型源自 SRC-6 + SRC-10；其余字段 [FILL] |

---

## 8. 用例与用户故事

### UC-001：上传 PDF 并进行 RAG 问答（P0）

- **角色**：考研学生
- **前置条件**：已登录、订阅有效（[FILL: 试用策略]）
- **主流程**：
  1. 用户上传超大 PDF
  2. 后端 Celery/Redis 队列接收任务（REQ-BE-001）
  3. LlamaIndex 解析 PDF → 段落级语义切分（REQ-BE-003, REQ-BE-006）
  4. 切片走 BAAI/bge-m3 或 OpenAI embedding（REQ-BE-004）
  5. 向量入 Qdrant 或 Pinecone（REQ-BE-005）
  6. 用户在右侧 AI 聊天发起提问（REQ-FE-003）
  7. 后端执行 Hybrid Search（BM25 + Dense Vectors）+ Re-ranking（REQ-BE-007）
  8. 检索结果作为上下文注入 DeepSeek-Chat 推理（REQ-BE-008）
  9. 答案在 AI 聊天面板渲染
- **来源**：SRC-1, SRC-3, SRC-4
- **关联需求**：REQ-FE-001/003 + REQ-BE-001/003/004/005/006/007/008
- **关联验收**：见第 9 节 AC-UC-001

### UC-002：上传长视频并进行带时间戳的问答（P0）

- **角色**：考公学生
- **主流程**：
  1. 用户上传长视频（[FILL: 时长上限]）
  2. Whisper API 或本地 Whisper medium 转录（REQ-BE-002）
  3. 转录文本按每 2-3 分钟时间切分（REQ-BE-006）
  4. embedding → 入向量库（REQ-BE-004/005）
  5. 用户在右侧聊天提问；HTML5 播放器与聊天时间戳同步（REQ-FE-002）
  6. AI 答案中包含时间戳定位（[FILL: UI 跳转机制细节]）
- **来源**：SRC-1, SRC-3, SRC-4

### UC-003：长时学习与笔记自动保存（P0）

- **角色**：在校大学生
- **主流程**：开启 Focus Mode → 阅读 PDF → 在右侧记录笔记 → 系统自动保存（REQ-FE-005/006/007）
- **来源**：SRC-1, SRC-2

### UC-004：Cmd+K 文档搜索（P1）

- **角色**：任意已登录用户
- **主流程**：按 Cmd+K → 输入关键词 → 跳转或聚焦匹配结果（REQ-FE-004）
- **来源**：SRC-2

### UC-005：订阅付费（P0）

- **角色**：免费用户升级
- **主流程**：选择月度方案 (15-25 RMB) → Stripe Checkout → 订阅生效 → 解锁付费功能（REQ-BIZ-001/002）
- **来源**：SRC-6, SRC-10(Stripe)

### UC-006：每日签到 + 闪卡复习（P1）

- **角色**：留存中的活跃用户
- **主流程**：每日打开应用 → 签到 → 进入闪卡复习已学知识点（REQ-BIZ-003）
- **来源**：SRC-6

### UC-007 ~ UC-N（注册、忘记密码、跨设备同步、错题本、协作笔记、笔记导出等）

- 状态：[FILL: 来源未涵盖；需补充]

---

## 9. 验收标准

> 标号规则：`AC-<REQ_ID>-NN`。所有 P0 需求需在回归测试中通过；含 `[FILL]` 的项需在补充信息后由编制人具体化。

### 9.1 前端验收

| AC ID | 关联需求 | 验收点 |
|---|---|---|
| AC-FE-001-01 | REQ-FE-001 | 加载来源所谓 *"massive PDF"* 不崩溃；具体上限 [FILL: 单文件大小上限] |
| AC-FE-001-02 | REQ-FE-001 | 渲染响应时间 SLA [FILL] |
| AC-FE-002-01 | REQ-FE-002 | 视频播放进度变化时，AI 聊天面板能高亮/同步对应时间段对话 |
| AC-FE-002-02 | REQ-FE-002 | 视频格式支持清单 [FILL] |
| AC-FE-003-01 | REQ-FE-003 | 拖动分隔条可调整左右宽度，状态由 Zustand 管理 |
| AC-FE-003-02 | REQ-FE-003 | 分屏的最小/最大宽度 [FILL] |
| AC-FE-004-01 | REQ-FE-004 | 按下 `Cmd+K` 立即弹出搜索面板 |
| AC-FE-004-02 | REQ-FE-004 | 搜索匹配规则 / 防抖参数 / 结果上限 [FILL] |
| AC-FE-005-01 | REQ-FE-005 | 笔记内容修改后在 [FILL: 保存间隔] 内自动保存 |
| AC-FE-005-02 | REQ-FE-005 | 网络断开时不丢失本地草稿（缓存策略 [FILL]） |
| AC-FE-006-01 | REQ-FE-006 | Focus Mode 切换后，工具栏隐藏；退出后恢复 |
| AC-FE-007-01 | REQ-FE-007 | 首次打开默认 dark mode |
| AC-FE-007-02 | REQ-FE-007 | 长文阅读启用高对比度排版 |
| AC-FE-007-03 | REQ-FE-007 | 是否支持亮色切换 [FILL: 来源未提及] |

### 9.2 后端验收

| AC ID | 关联需求 | 验收点 |
|---|---|---|
| AC-BE-001-01 | REQ-BE-001 | 大 PDF 上传后入 Celery/Redis 队列，主线程不阻塞 |
| AC-BE-001-02 | REQ-BE-001 | 任务超时与重试策略 [FILL] |
| AC-BE-002-01 | REQ-BE-002 | 视频上传后启动 Whisper 转录任务 |
| AC-BE-002-02 | REQ-BE-002 | 转录精度阈值 / 多语言列表 [FILL] |
| AC-BE-003-01 | REQ-BE-003 | LlamaIndex 解析后构建可检索索引 |
| AC-BE-004-01 | REQ-BE-004 | 所有切片均完成 embedding 入库 |
| AC-BE-004-02 | REQ-BE-004 | 向量维度与距离度量 [FILL] |
| AC-BE-005-01 | REQ-BE-005 | 向量持久化到 Qdrant 或 Pinecone |
| AC-BE-005-02 | REQ-BE-005 | 索引备份与恢复策略 [FILL] |
| AC-BE-006-01 | REQ-BE-006 | PDF 切分粒度为段落级 |
| AC-BE-006-02 | REQ-BE-006 | 视频转录切片为每 2-3 分钟一段 |
| AC-BE-007-01 | REQ-BE-007 | 同时启用 BM25 + Dense Vectors |
| AC-BE-007-02 | REQ-BE-007 | 检索后通过重排序模型 [FILL: 模型名] 提升精度 |
| AC-BE-008-01 | REQ-BE-008 | 检索结果作为上下文注入 DeepSeek 调用 |
| AC-BE-008-02 | REQ-BE-008 | 推理参数（max_tokens / temperature 等）[FILL] |

### 9.3 商业化验收

| AC ID | 关联需求 | 验收点 |
|---|---|---|
| AC-BIZ-001-01 | REQ-BIZ-001 | 用户可订阅 15-25 RMB/月方案 |
| AC-BIZ-002-01 | REQ-BIZ-002 | Stripe 中创建并维护订阅、发票、阶梯定价；支持多币种 |
| AC-BIZ-002-02 | REQ-BIZ-002 | 阶梯/usage-based/per-seat 等具体阶梯 [FILL] |
| AC-BIZ-003-01 | REQ-BIZ-003 | 用户每日打开应用有签到提示 |
| AC-BIZ-003-02 | REQ-BIZ-003 | 闪卡复习模块支持复习已学知识点（具体算法 [FILL]） |

### 9.4 端到端 / 用例验收

| AC ID | 关联用例 | 验收点 |
|---|---|---|
| AC-UC-001 | UC-001 | 上传 → 索引 → 提问全链路通畅；问答回答可引用源文档段落 |
| AC-UC-002 | UC-002 | 视频问答回答中带可点击时间戳，点击后播放器跳到对应位置 |
| AC-UC-003 | UC-003 | 启用 Focus Mode 后页面无干扰；笔记自动保存生效 |
| AC-UC-004 | UC-004 | Cmd+K 在所有受支持页面可调起搜索 |
| AC-UC-005 | UC-005 | 完成 Stripe 支付后，付费功能立即解锁 |
| AC-UC-006 | UC-006 | 连续 N 日（[FILL: N]）签到能触发提示与奖励（[FILL: 奖励内容]） |
| AC-COVERAGE | 全局 | 测试覆盖率 / UAT 抽样规模 / 性能基线 [FILL] |

---

## 10. 风险与依赖

### 10.1 技术风险

| ID | 风险 | 影响 | 来源 |
|---|---|---|---|
| **RISK-001** | 嵌入模型选型（OpenAI 云端 vs BAAI/bge-m3 本地）影响成本与延迟 | 中 | SRC-3 *"if cost permits, else local"* |
| **RISK-002** | 向量数据库二选一（Qdrant 自建 vs Pinecone 托管） | 中 | SRC-4 |
| **RISK-003** | DeepSeek API 稳定性与成本波动（基线 ~$0.14/1M tokens） | 高 | SRC-6 |
| **RISK-004** | Whisper 转录精度（local medium vs API）影响视频问答质量 | 中 | SRC-3 |
| **RISK-005** | UX Principles 来源仅 5 条，标题声称 10 条 → 信息缺口 | 低 | SRC-2 |
| **RISK-006** | 大 PDF / 长视频的具体上限（"massive" / "long" 未量化） | 中 | SRC-1, SRC-3 |
| **RISK-007** | 数据合规、用户隐私、版权 | 高 | [FILL: 来源未涵盖] |

### 10.2 外部依赖

| ID | 依赖 | 角色 | 来源 |
|---|---|---|---|
| **DEP-001** | Next.js / React / TailwindCSS / shadcn/ui / Zustand | 前端栈 | SRC-1, SRC-7, SRC-8, SRC-9 |
| **DEP-002** | LlamaIndex | 解析与索引编排 | SRC-4 + SRC-10(LlamaIndex) |
| **DEP-003** | Celery + Redis | 异步任务队列 | SRC-3 |
| **DEP-004** | Whisper API / 本地 Whisper medium | 视频转录 | SRC-3 |
| **DEP-005** | DeepSeek API | LLM 推理 | SRC-4 + SRC-10(DeepSeek) |
| **DEP-006** | OpenAI Embeddings / BAAI/bge-m3 | 向量化 | SRC-3 |
| **DEP-007** | Qdrant / Pinecone | 向量数据库 | SRC-4 |
| **DEP-008** | Stripe Billing | 计费 | SRC-10(Stripe) |
| **DEP-009** | Bilibili / 小红书生态 | 增长渠道 | SRC-6 |
| **DEP-010** | 闵行区创业补贴政策（房租 / 社保 / 一次性 8000 RMB） | 运营资金 | SRC-5 |
| **DEP-011** | YC Startup Library 方法论 | 创业方法论 | SRC-10(YC) |

---

## 11. 变更控制

| 项 | 内容 |
|---|---|
| 当前版本 | v0.1（基于 NotebookLM 抓取的初版） |
| 变更流程 | [FILL: 来源未提供；建议 PR + Code Review + 需求评审会签 + 版本号递增] |
| 变更归口 | [FILL: 产品经理 / 技术负责人] |
| 历史记录 | v0.1 — 2026-05-05 — 由 NotebookLM MCP 自动整理初版 |
| 占位符更新策略 | 所有 `[FILL: ...]` 在补充信息后，由编制人在版本递增时统一替换并在历史记录中说明 |

---

## 附录 A：信息源映射表

| SRC ID | 类型 | NotebookLM Source UUID | 标题 | Notebook |
|---|---|---|---|---|
| **SRC-1** | 内部 | `fd22b8be-92bc-42cd-9631-6daa3ed20287` | Singsi Architecture | Frontend & UX Engineering |
| **SRC-2** | 内部 | `9fe9af6f-134b-45b0-863a-ce8093ab6b1a` | UX Principles（仅 5 条） | Frontend & UX Engineering |
| **SRC-3** | 内部 | `7c35becc-a531-4c74-9ce4-fc6cc0171d78` | Async Processing | Backend RAG & DeepSeek |
| **SRC-4** | 内部 | `f3875f6a-75b0-480b-b1e4-1e565005ff38` | RAG Design | Backend RAG & DeepSeek |
| **SRC-5** | 内部 | `f44fe0a7-00b6-4800-add2-afa32c0b914d` | Minhang Subsidies | Startup Business Strategy |
| **SRC-6** | 内部 | `ac5dcbb3-6897-409e-9349-57e3a5458c73` | SaaS Growth | Startup Business Strategy |
| SRC-7 | 外部 | `22848c39…` / `74edb963…` / `973a77c3…` | Next.js Docs | Frontend & UX |
| SRC-8 | 外部 | `944694bd…` / `114b3ed1…` / `29d6691d…` / `e4fd7e11…` | React Docs / Hooks / Reference | Frontend & UX |
| SRC-9 | 外部 | `4cf06f56…` | shadcn/ui | Frontend & UX |
| SRC-10 | 外部（合并） | `87a4c5dc…` / `8a1f5c53…` / `c965eaeb…` / `eaa594d9…` | LlamaIndex / DeepSeek API / Stripe Billing / YC Startup Library | Backend + Business |

NotebookLM Notebook 链接：

- Frontend & UX：<https://notebooklm.google.com/notebook/4ebf73c8-9cc8-4221-9645-06f9812fd96d>
- Backend RAG：<https://notebooklm.google.com/notebook/a22e280d-e57a-4868-8e4f-3ec95bfa3355>
- Business Strategy：<https://notebooklm.google.com/notebook/acc4f7f1-65d2-4f6f-997d-e0db166b92de>

---

## 附录 B：信息缺口清单（待补充）

> 本文中所有 `[FILL: …]` 占位符的集中索引。补充任一项后请同步更新对应章节并递增版本号。

| # | 章节 | 缺口 |
|---|---|---|
| 1 | §1 VIS-004 | 商业目标量化指标（MAU、付费转化、留存） |
| 2 | §2 SCOPE-OUT-001/002/003 | 移动端 / 离线 / 协作 / 第三方导入是否在 v0.1 范围 |
| 3 | §2.3 平台 | 除 Web 外的平台覆盖 |
| 4 | §5 REQ-FE-010 | UX Principles 第 6-10 条原文 |
| 5 | §6 NF-PERF-003 | 首屏 / 检索 / 转录 SLA |
| 6 | §6 NF-AVAIL-001 | 系统可用性 SLA |
| 7 | §6 NF-SCAL-002 | 单文件大小上限、并发用户上限 |
| 8 | §6 NF-UX-005 | WCAG / ARIA 等可访问性等级 |
| 9 | §6 NF-SEC-001/002 | 用户认证、数据合规 |
| 10 | §6 NF-I18N-002 | UI 多语言 / 转录语言列表 |
| 11 | §7.2 INT-INT-001 | 内部 REST/GraphQL 端点列表与 schema |
| 12 | §7.3 数据字典 | Document/Chunk/Note/Conversation/User/Subscription 完整字段 |
| 13 | §8 UC-001 | 试用策略 |
| 14 | §8 UC-002 | 视频时长上限、时间戳跳转 UI |
| 15 | §8 UC-007+ | 注册、忘记密码、跨设备同步、错题本、协作、导出等用例 |
| 16 | §9 多个 AC | 各 AC 中的具体阈值（响应时间、保存间隔、文件大小等） |
| 17 | §9 AC-BE-007-02 | 重排序模型名 |
| 18 | §9 AC-BE-008-02 | DeepSeek 推理参数 |
| 19 | §9 AC-COVERAGE | 测试覆盖率、UAT 抽样规模 |
| 20 | §10 RISK-007 | 数据合规、隐私、版权 |
| 21 | §11 | 变更流程、归口、当前历史 |

---

## 附录 C：可追溯性矩阵（需求 ↔ 来源 ↔ 用例 ↔ 验收）

| 需求 ID | 来源 | 关联用例 | 验收 ID |
|---|---|---|---|
| REQ-FE-001 | SRC-1 | UC-001 | AC-FE-001-01/02 |
| REQ-FE-002 | SRC-1 | UC-002 | AC-FE-002-01/02 |
| REQ-FE-003 | SRC-1, SRC-2 | UC-001, UC-002 | AC-FE-003-01/02 |
| REQ-FE-004 | SRC-2 | UC-004 | AC-FE-004-01/02 |
| REQ-FE-005 | SRC-2 | UC-003 | AC-FE-005-01/02 |
| REQ-FE-006 | SRC-1, SRC-2 | UC-003 | AC-FE-006-01 |
| REQ-FE-007 | SRC-1, SRC-2 | — | AC-FE-007-01/02/03 |
| REQ-FE-008 | SRC-1, SRC-9 | — | [FILL] |
| REQ-FE-009 | SRC-1 | UC-001/UC-002（分屏状态） | [FILL] |
| REQ-FE-010 | [FILL] | — | [FILL] |
| REQ-BE-001 | SRC-3 | UC-001 | AC-BE-001-01/02 |
| REQ-BE-002 | SRC-3 | UC-002 | AC-BE-002-01/02 |
| REQ-BE-003 | SRC-4 | UC-001/UC-002 | AC-BE-003-01 |
| REQ-BE-004 | SRC-3 | UC-001/UC-002 | AC-BE-004-01/02 |
| REQ-BE-005 | SRC-4 | UC-001/UC-002 | AC-BE-005-01/02 |
| REQ-BE-006 | SRC-4 | UC-001/UC-002 | AC-BE-006-01/02 |
| REQ-BE-007 | SRC-4 | UC-001/UC-002 | AC-BE-007-01/02 |
| REQ-BE-008 | SRC-4 | UC-001/UC-002 | AC-BE-008-01/02 |
| REQ-BIZ-001 | SRC-6 | UC-005 | AC-BIZ-001-01 |
| REQ-BIZ-002 | SRC-10(Stripe) | UC-005 | AC-BIZ-002-01/02 |
| REQ-BIZ-003 | SRC-6 | UC-006 | AC-BIZ-003-01/02 |
| REQ-BIZ-004 | SRC-6 | — | （运营，不在 AC 内） |
| REQ-BIZ-005 | SRC-5 | — | （运营，不在 AC 内） |

---

> *— 文档结束 —*
