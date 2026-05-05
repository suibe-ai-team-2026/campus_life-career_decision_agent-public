# Genote · 生思笔记

> 面向中国 **考研 / 考公** 学生的 AI 学习辅助 SaaS。
> 处理超大 PDF 与长视频（2.5h+），提供时间戳同步的 RAG 对话、自动保存笔记、专注模式与闪卡复习。

| 维度 | 内容 |
|---|---|
| 状态 | Beta 0.1 — UI 原型 + 后端 Dify DSL 已就位，未连真实数据 |
| 端 | Web (Next.js 目标栈；当前为 React + CDN Babel 静态原型) |
| 后端 | FastAPI（计划） · Dify 工作流 · DeepSeek-V3 / Whisper / LlamaIndex / Qdrant |
| 定价 | 月度订阅 15–25 RMB（参考 PRD §5.3） |

---

## 仓库导览

```
.
├── README.md                  # 本文件
├── Genote_PRD_v0.1.md         # 完整需求文档（11 章 + 3 附录 + 21 项 [FILL] 缺口）
├── GENOTE_CONTEXT.md          # 一页项目上下文（架构 / 已知问题 / 约束）
│
├── prototype/                 # 交互式 UI 原型（10 个文件，可直接静态运行）
│   ├── Genote Prototype.html  # 入口
│   ├── styles.css             # oklch 暖琥珀暗色主题 + 三栏布局
│   ├── app.jsx                # App 壳 / Titlebar / Sidebar / Status / 全局快捷键
│   ├── library.jsx            # 学习库首页
│   ├── reader.jsx             # PDF 阅读器（分屏 + AI 聊天 + 笔记 + 目录）
│   ├── video.jsx              # 视频阅读器（HTML5 + 时间戳同步聊天 + 转录）
│   ├── overlays.jsx           # ⌘K 命令面板 + 闪卡复习 + 上传弹窗
│   ├── data.jsx               # mock 数据（文档 / 转录 / 闪卡 / 命令面板项）
│   ├── icons.jsx              # 内联 SVG 图标库
│   └── tweaks-panel.jsx       # 配色 / 密度 / 分屏宽度 / 专注模式调节器
│
├── Genote_AI.yml              # 简版 Dify DSL（教程级）
├── Genote_Delivery.yml        # 交付物清单
├── Genote_beta_0.2.yml        # Dify 工作流 DSL（含 PDF / 视频 / 音频多路解析 + Map-Reduce）
├── Genote_beta_0.3.yml        # 0.2 修订
├── Genote_beta_0.4.yml        # 当前版本（API key 已替换为 ${DASHSCOPE_API_KEY}）
├── fix_genote.py              # 历史修复脚本（PDF MIME 校验 / Map-Reduce 解析）
│
├── .env.example               # 提交版：标注需要的环境变量
├── .gitignore                 # 排除 .env / 缓存 / IDE 配置
└── .claude/launch.json        # Claude Preview MCP 的本地预览服务器配置
```

---

## 快速开始

### 1. 预览原型（最快，0 依赖）

```bash
cd prototype
python3 -m http.server 8765
# 浏览器打开 http://localhost:8765/Genote%20Prototype.html
```

或用任何 Claude Preview MCP / VS Code Live Server / `npx serve` 都行。

### 原型涵盖的交互（仿真，无真实后端）

- **学习库** — 上传卡片、5 条最近文档（带索引状态/进度）、4 天连胜签到、12 张闪卡入口、本周指标
- **PDF 阅读器** — 三栏分屏（文档 / 480px 右栏可拖拽 360–820px）、缩放 60–180%、目录跳页、引用高亮 → toast
- **视频阅读器** — HTML5 拟态播放器、scrubber 带 11 个 transcript markers、转录段当前段高亮
- **AI 聊天** — 上下文 chip / quick prompts (`总结考点 / 出真题 / 易错点`) / 引用 chip 跳转视频时间戳
- **笔记** — `contentEditable` + 1.2s 防抖自动保存动画
- **⌘K 命令面板** — 模糊搜索 / ↑↓ 导航 / Enter 选中 / 按"动作 · 文档 · 搜索 & 提问"分组
- **闪卡复习** — 翻面 → Again / Hard / Good / Easy 间隔重复
- **上传弹窗** — 三段式进度：上传文件 → 解析与切分 (PyMuPDF) → 向量化 (BAAI/bge-m3 → Qdrant) → 完成
- **专注模式** — 关 / 隐藏侧栏 / 仅文档 三档（⌘. 切换）
- **Tweaks 面板** — 强调色色相、密度、右栏宽度、签到开关

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，把 DASHSCOPE_API_KEY 填入你的 DashScope / OpenAI 兼容 API key
```

`.env` 已在 `.gitignore` 里，不会被误提交。3 份 Dify YAML 在第 30 行通过 `${DASHSCOPE_API_KEY}` 引用该值。

### 3. 部署 Dify 工作流（可选）

把 `Genote_beta_0.4.yml` 上传到 Dify Console → 应用 → 导入 DSL。详见 [PRD §5.2 后端 RAG 模块](Genote_PRD_v0.1.md#52-后端-rag-模块be) 与 [GENOTE_CONTEXT.md](GENOTE_CONTEXT.md)。

---

## 架构概览

```
┌────────────┐   上传    ┌──────────────┐   异步    ┌─────────────────┐
│  Web 前端   ├─────────▶│  Environment ├─────────▶│ Multi-route     │
│ (Next.js)  │           │   Sensing    │  分发    │  Parsing         │
└────────────┘           └──────────────┘           │  ├─ PDF (PyMuPDF)│
       ▲                                            │  ├─ DOCX         │
       │ RAG 答复                                    │  ├─ 图片 (OCR)   │
       │                                            │  └─ 音频 (Whisper)│
┌──────┴──────┐  Hybrid  ┌─────────┐    Embed       └─────────────────┘
│ DeepSeek-V3 │◀─────────┤ Qdrant  │◀───────┐                │
│  推理       │  Search  │ Vector  │        │                ▼
└─────────────┘          │  DB     │   ┌────┴───────┐   ┌──────────┐
                         └─────────┘   │ Variable    │   │  Map-    │
                                       │ Aggregator  │──▶│  Reduce  │
                                       │ merged_text │   │ (DeepSeek)│
                                       └─────────────┘   └──────────┘
```

技术栈与设计取舍详见 [Genote_PRD_v0.1.md](Genote_PRD_v0.1.md)：

- 切分：PDF 段落级语义切分；视频转录每 2–3 分钟时间切分（[REQ-BE-006](Genote_PRD_v0.1.md#52-后端-rag--异步处理be)）
- 检索：Hybrid Search (BM25 + Dense Vectors) + Re-ranking（[REQ-BE-007](Genote_PRD_v0.1.md#52-后端-rag--异步处理be)）
- 嵌入：BAAI/bge-m3 或 OpenAI text-embedding-3-small（成本敏感切换）
- 推理：DeepSeek-Coder / DeepSeek-Chat（参考成本 ~$0.14/1M tokens）

---

## 已知问题与待办

| 类别 | 项 |
|---|---|
| **已修** | 专注模式下主区宽度坍缩为 0（`.app.focus { grid-template-columns: 0 1fr }` → `1fr`，见 [styles.css L70](prototype/styles.css#L70)） |
| **PRD 缺口** | 21 项 `[FILL]`：性能 SLA、单文件上限、内部 API、数据字典字段、UAT 规模、UX Principles 第 6–10 条等。详见 PRD 附录 B |
| **后端待优化** | PDF 兼容性 / `text_previewer` 输出参数校验 / Map-Reduce 解析 `Array[String]` 兼容（详见 [GENOTE_CONTEXT.md](GENOTE_CONTEXT.md) §4） |
| **前端目标栈** | 当前原型是 React + CDN Babel 单页；目标迁移到 Next.js + TypeScript + TailwindCSS + shadcn/ui + Zustand |

---

## 路线图

- [ ] 把原型迁到 Next.js 14 App Router + Tailwind + shadcn/ui
- [ ] 接通 FastAPI / Dify 后端，替换 `data.jsx` 中的 mock
- [ ] 实现真实文件上传链路（含 200MB 单文件上限校验）
- [ ] 接通 Stripe 月度订阅（15–25 RMB / 月，参考 PRD §5.3）
- [ ] 闪卡间隔重复算法（SM-2 / FSRS）
- [ ] 移动端响应式 / PWA
- [ ] 多语言 UI（PRD `[FILL]` NF-I18N-002）

---

## 信息源声明

- 产品需求基于 [NotebookLM](https://notebooklm.google.com) 三个 notebook 整理：*Singsi Note AI - Frontend & UX Engineering* / *Backend RAG & DeepSeek Engine* / *Startup Business Strategy & Subsidies*
- UI 原型由 [Claude Design](https://claude.ai/design) 生成，后落盘并修复了 1 个布局 bug
- PRD 与本 README 由 [Claude Code](https://claude.com/claude-code) 协助整理

---

## License

[FILL: 选择一个 license — 建议 MIT 或 Apache-2.0]
