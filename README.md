# Genote · 生思笔记

> 面向中国 **考研 / 考公** 学生的 AI 学习辅助 SaaS。
> 基于 **Open Notebook** (23k+ stars, MIT) 成熟架构，融合 Genote 专注学习体验。

| 维度 | 内容 |
|---|---|
| 状态 | v0.2 — 基于 Open Notebook 架构重建 |
| 端 | Web (Next.js 16 + React 19 + TypeScript + TailwindCSS + shadcn/ui) |
| 后端 | Python FastAPI + LangGraph + SurrealDB |
| AI | DeepSeek-V3 / OpenAI / Anthropic / Ollama (18+ 提供商) |
| 定价 | 月度订阅 15–25 RMB (计划) |

---

## 架构

本项目的核心引擎是 **[Open Notebook](https://github.com/lfnovo/open-notebook)**，一个生产级的开源 NotebookLM 替代品。Genote 在其基础上添加了：

- **学习库** — 考研倒计时、每日签到、连胜奖励、学习指标
- **闪卡复习** — SM-2 间隔重复算法、翻转动画、4级评分
- **专注模式** — 三档切换 (关闭/隐藏侧栏/仅文档)、⌘. 快捷键
- **视频时间戳同步** — 转录分段、时间戳 AI 引用、点击跳转
- **暖琥珀暗色主题** — oklch 色系、高对比度排版
- **⌘K 命令面板** — 分组搜索、快速 AI 提问

所有 Open Notebook 原有功能 (RAG 聊天、播客生成、内容转换、多模型切换) 完整保留。

---

## 快速开始

### 1. 准备 Open Notebook 工作树

`open-notebook/` 是独立 Git 工作树，不直接提交到本仓库 `main` 分支。如果本地还没有该目录：

```bash
git clone --single-branch --branch open-notebook-genote https://github.com/turtojian520/genote.git open-notebook
```

### 2. Docker Compose 启动 (推荐)

```bash
cd open-notebook
docker compose up -d
```

访问 http://localhost:8502

### 3. 配置 AI 提供商

1. 打开设置 → API 密钥
2. 添加 DeepSeek API 密钥 (或 OpenAI / Anthropic / Ollama)
3. 测试连接 → 自动发现模型 → 注册

### 4. 手动启动前端 (开发)

```bash
cd open-notebook/frontend
npm install
npm run dev
```

### 5. 云端预览部署

云端部署配置维护在独立工作树：

- Compose: `open-notebook/docker-compose.yml`
- 环境模板: `open-notebook/.env.example`
- 部署手册: `open-notebook/docs/GENOTE_CLOUD_DEPLOY.md`

推荐先用 4 vCPU / 8GB RAM / 100GB SSD 的 Ubuntu 机器做预览部署。

---

## 仓库导览

```
.
├── README.md                  # 本文件
├── Genote_PRD_v0.1.md         # 完整需求文档
├── GENOTE_CONTEXT.md          # 项目上下文与技术架构
├── prototype/                 # 原始 UI 原型 (React + CDN Babel)
│
└── open-notebook/             # 主项目，独立 Git 工作树 (基于 Open Notebook)
    ├── frontend/              # Next.js 前端
    ├── api/                   # FastAPI 后端 (含 Genote 扩展)
    ├── open_notebook/         # Python 核心库
    └── docker-compose.yml     # 一键部署
```

---

## Genote 特色功能

| 功能 | 说明 | 快捷键 |
|------|------|--------|
| 学习驾驶舱 | 考研倒计时 + 上传 + 最近文档 + 签到 + 指标 | — |
| 闪卡复习 | SM-2 间隔重复 + 翻转动画 + 4级评分 | — |
| 专注模式 | 隐藏侧栏 / 仅文档 / 关闭 | ⌘. |
| 命令面板 | 搜索文档 / 跳转 / AI 提问 | ⌘K |
| 视频时间戳 | 转录同步播放 + 时间戳引用跳转 | — |

---

## License

本项目基于 MIT 许可。Open Notebook 同样采用 MIT 许可。
