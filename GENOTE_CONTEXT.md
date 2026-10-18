# GENOTE 项目上下文文档

> **比赛版提示（2026-10-18）**：本文件描述 Genote 原产品（考研 / 考公 AI 学习助手）的技术上下文，作为**可复用参考**保留。比赛版（校园 AI 知识库助手）的技术底座按团队决策执行，见工作空间仓库 `docs/discovery/decision.md` 与 [`docs/product-alignment.md`](docs/product-alignment.md)。两份文档冲突时，以团队决策为准。

## 1. 项目概览 (Project Overview)

- **项目名称**: Genote (生思笔记) v0.2
- **核心愿景**: 打造一个"学术导师"级的笔记助手，为考研/考公学生提供 AI 驱动的学习辅助
- **当前状态**: 基于 Open Notebook (`lfnovo/open-notebook`) 架构重建；Genote 扩展维护在独立 `open-notebook/` Git 工作树
- **比赛版定位**: 本仓库为 `suibe-ai-team-2026` 的比赛主项目；比赛选题为校园 AI 知识库助手，复用本文件所述原型与交互设计，技术底座另按决策执行

---

## 2. 技术栈与架构 (Tech Stack & Architecture)

本项目基于 **Open Notebook** (23k+ stars, MIT license) 的成熟架构扩展而来：

### 2.1 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | Next.js 16+ App Router / React 19 / TypeScript |
| **UI** | TailwindCSS / shadcn/ui / oklch 暖琥珀暗色主题 |
| **状态管理** | Zustand (持久化) / TanStack Query |
| **后端** | Python FastAPI (port 5055) + LangGraph |
| **数据库** | SurrealDB (文档图混合数据库) |
| **AI 引擎** | LangChain + Esperanto (18+ 提供商，含 DeepSeek) |
| **搜索** | Hybrid Search (BM25 + 向量) |
| **部署** | Docker Compose (SurrealDB + FastAPI + Next.js) |

> **比赛版差异（2026-10-15 决策）**：上表是 Genote 原实现（Open Notebook 自托管，原型 / 参考阶段）。比赛版技术底座为 **Next.js（Vercel）+ Supabase（Postgres、pgvector、Auth、私有 Storage、Queues）+ Python Deep Agents / LangGraph + Freestyle VM**；下文的 FastAPI + SurrealDB + Docker Compose 结构仅作为参考实现保留，不作为比赛版最终架构。

### 2.2 架构图

```
┌─────────────────────────────────────────────────────────┐
│          Genote Frontend (Next.js + React)              │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ 学习库   │ │ 闪卡复习  │ │ PDF 阅读  │ │ 视频播放   │  │
│  │ 签到打卡  │ │ 专注模式  │ │ AI 聊天   │ │ 时间戳同步 │  │
│  └─────────┘ └──────────┘ └──────────┘ └───────────┘  │
│         Open Notebook Frontend (shadcn/ui)              │
└────────────────────────┬────────────────────────────────┘
                         │ REST API + SSE
┌────────────────────────▼────────────────────────────────┐
│          FastAPI Backend (port 5055)                    │
│  ┌────────────────────┐ ┌───────────────────────────┐  │
│  │ Open Notebook 路由器 │ │ Genote 扩展路由器          │  │
│  │ - notebooks        │ │ - flashcards (SM-2)       │  │
│  │ - sources          │ │ - streaks (每日签到)       │  │
│  │ - notes            │ │ - study_metrics (学习指标)  │  │
│  │ - chat             │ │ - transcripts (时间戳转录)  │  │
│  │ - podcasts         │ │                           │  │
│  │ - search           │ │                           │  │
│  └────────────────────┘ └───────────────────────────┘  │
│              LangGraph Workflows + Esperanto AI          │
└────────────────────────┬────────────────────────────────┘
                         │ SurrealQL
┌────────────────────────▼────────────────────────────────┐
│          SurrealDB (port 8000)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐           │
│  │ Open NB   │ │ Genote    │ │ 向量嵌入      │           │
│  │ 数据模型   │ │ 扩展表    │ │ 语义搜索      │           │
│  └──────────┘ └──────────┘ └──────────────┘           │
└─────────────────────────────────────────────────────────┘
```

---

## 3. 核心功能模块

### 3.1 学习库 (Dashboard)
- 考研/考公倒计时
- 文档上传（PDF/视频/音频）
- 最近文档列表 + 索引进度
- 每日签到 + 连胜天数
- 闪卡复习入口
- 本周学习指标

### 3.2 闪卡复习 (SM-2 间隔重复)
- 翻转卡片
- 4 级评分 (Again/Hard/Good/Easy)
- 自适应下次复习日期
- 来源引用追踪

### 3.3 专注模式
- 3 档：关闭 / 隐藏侧栏 / 仅文档
- 快捷键 ⌘. 切换

### 3.4 视频时间戳同步
- HTML5 播放器 + 转录分段
- 时间戳标记 AI 问答引用
- 点击引用跳转对应时间点

### 3.5 Cmd+K 命令面板
- 分组搜索（动作 / 文档 / AI 提问）
- ↑↓ 导航 / ↵ 选择 / esc 关闭

### 3.6 Open Notebook 原有功能（保留）
- 多模型 AI 支持 (DeepSeek, OpenAI, Anthropic, Ollama 等)
- RAG 聊天 + 上下文控制
- 播客生成 (多说话人)
- 内容转换 (Transformations)
- 全文 + 向量混合搜索
- MCP 集成

---

## 4. 目录结构

```
Genote/
├── README.md                    # 项目说明
├── GENOTE_CONTEXT.md            # 本文件
├── Genote_PRD_v0.1.md           # 需求文档
├── prototype/                   # 原始 UI 原型 (参考)
│
├── open-notebook/               # 基于 Open Notebook 的主项目（独立 Git 工作树）
│   ├── frontend/                # Next.js 前端
│   │   ├── src/
│   │   │   ├── app/(dashboard)/ # 仪表盘页面
│   │   │   │   ├── page.tsx     # 学习库首页
│   │   │   │   └── flashcards/  # 闪卡复习页
│   │   │   ├── components/
│   │   │   │   ├── layout/      # AppShell, AppSidebar
│   │   │   │   ├── study/       # Genote 学习组件
│   │   │   │   └── ui/          # shadcn/ui 基础组件
│   │   │   └── lib/             # Hooks, Stores, API
│   │   └── ...
│   ├── api/                     # FastAPI 后端
│   │   ├── routers/
│   │   │   ├── flashcards.py    # 闪卡 API
│   │   │   ├── streaks.py       # 签到打卡 API
│   │   │   └── study_metrics.py # 学习指标 API
│   │   └── main.py              # 应用入口
│   ├── open_notebook/
│   │   └── database/migrations/
│   │       ├── 15.surrealql     # 闪卡表
│   │       └── 16.surrealql     # 签到打卡表
│   └── docker-compose.yml       # 一键部署
```

---

## 5. 开发约束

- **API Key**: 通过 `.env` 注入，严禁硬编码
- **默认 AI**: DeepSeek（成本优先）
- **主题**: 默认深色模式，暖琥珀 oklch 色系
- **字体**: Inter (UI) + Noto Sans SC (中文) + JetBrains Mono (代码) + Source Serif 4 (阅读)
- **比赛版补充**: Supabase / Freestyle 凭据只放服务端环境变量，不下发前端；真实学生数据、授权课程材料不得进入 Git、Issue 或演示包

