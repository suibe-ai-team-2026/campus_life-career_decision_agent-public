# GENOTE 项目上下文文档

## 1. 项目概览 (Project Overview)

- **项目名称**: Genote (Beta 0.1)
- **核心愿景**: 打造一个"学术导师"级的笔记助手，具备处理长录音（2.5h+）、复杂 PDF 及 OCR 图片的能力，并输出具备上岸品质的结构化笔记。
- **当前状态**: UI/UX 已搭建，核心逻辑已跑通，但 PDF 兼容性待优化。

---

## 2. 技术栈与架构 (Tech Stack & Architecture)

根据《技术与商业全景指南》及开发回顾，本项目采用以下技术栈：

- **后端**: FastAPI (Python) - 支持异步处理
- **前端**: Next.js / React - 仿 NotebookLM 三栏布局
- **工作流引擎**: Dify (核心逻辑编排) 或 LangChain
- **核心模型**: DeepSeek-V3 (用于逻辑重组与润色)
- **PDF 解析**: PyMuPDF 或 Unstructured (用于增强文本提取)
- **向量数据库**: SQLite 或 Milvus (用于 RAG)

---

## 3. 核心工作流逻辑 (Core Workflow)

系统采用 **Map-Reduce 架构**处理多模态输入，流程如下：

### 3.1 环境感知 (Environment Sensing)
- **功能**: 识别用户输入文件类型（Audio/PDF/Image）并进行初步分发
- **已知问题**: PDF 处理有时触发错误分支，需增强 MIME type 校验

### 3.2 多路解析 (Multi-route Parsing)
- 并行处理音频（异步转写）、PDF/Word（文本提取）和图片（OCR）

### 3.3 变量聚合 (Variable Aggregator)
- **功能**: 将不同来源的文字统一汇聚为变量 `merged_text`

### 3.4 内容识别 (Text Previewer)
- **逻辑**: 截取前 500 字生成 `preview_content`
- **用途**: 辅助 `subject_classifier` 节点自动判定学科，替代不可靠的文件名判断

### 3.5 全局聚合 (Reduce Aggregate)
- **核心**: 调用 DeepSeek-V3 对零散考点进行逻辑重组与学术润色

---

## 4. 开发约束与已知挑战 (Constraints & Known Issues)

在编写代码时，必须严格遵守以下修复逻辑，避免历史 Bug 回归：

### A. 数据流格式校验 (Data Flow Gap)
- **风险**: `text_previewer` 节点容易出现 "Not all output parameters are validated" 错误
- **规范**: 必须确保代码返回的 Key（如 `preview_content`）在 Dify/工作流的输出变量列表中已明确注册

### B. Map-Reduce 解析瓶颈
- **风险**: `reduce_aggregate` 节点容易输出 `total_points: 0`
- **原因**: 上游 map_results 格式为 `Array[String]`（纯文本数组），而默认逻辑常误读为字典
- **解决方案**: 解析逻辑必须包含"增强兼容版"代码，支持直接抓取纯文本数组内容，而非仅读取 Key-Value

### C. 鉴权与安全
- **规范**: 严禁将 API Key 硬编码。必须通过 `.env` 环境变量注入 DeepSeek 或阿里云 API Key
- **配置**: 采用 OpenAI 兼容格式 (`base_url`, `api_key`) 接入模型

---

## 5. 待优化任务 (Pending Tasks)

- **PDF 兼容性修复**: 修复 `environment_sensing` 中的错误分支逻辑，集成更强的解析库（PyMuPDF）
- **防御逻辑**: 需增加单文件大小限制（如 20MB）及频率限制
