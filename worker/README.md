# 知途（Campus Pathway）· Python worker

本目录是知途的**云端后台执行进程**：部署在 Freestyle VM（或任意 Linux VM）上，
主动向 Supabase Postgres 队列 claim 任务，用固定 LangGraph 流程完成
资料入库、检索、规则计算、AI 解释、PDF 导出，然后把结果写回 Supabase。
它**不向公网开放任何端口**，也**不把 service/secret key 下发给浏览器**。

> 仓库根 `AGENTS.md` 与 `docs/architecture/*.md` 是上游契约；本 README 只描述
> worker 的实现细节与部署方式。事实与解释严格分离：规则引擎出事实，模型只解释。

## 1. 它做什么 / 不做什么

做：

- `ingest`：下载私有/共享来源文件 → Docling（优先）或 fallback 解析 → 切块 →
  OpenRouter `qwen/qwen3-embedding-8b`（4096 维 / L2）→ 写 `app_chunks` /
  `app_chunk_embeddings`，更新 `app_source_versions`；
- 6 种 run 的固定图：`ingest`、`plan`、`ask`、`export`、`assessment_explain`、`compare`；
- 混合检索（RRF + 每文档/每来源上限 + 来源类型配额 + 邻近扩展 + 约 7000 字符预算）
  与版本化拒答闸门；
- 确定性规则引擎（Decimal、同输入同版本同结果、缺资料 `credits=null`）；
- 中文 PDF（reportlab `UnicodeCIDFont('STSong-Light')`）并登记 `app_artifacts`；
- `app_usage` 记账（token 未知写 NULL，不写 0）与月度预算闸门（未配置预算时 fail closed）。

不做：

- 不替用户做决定、不计算就业率/薪资/通过率、不编造课程/学分/竞赛；
- 不解析整份 PDF 到 BFF，不跑常驻 Python 在 Vercel；
- 不自动切换模型/维度/模板（切换 = 新 embedding profile + 全量重建 + 人工切换）。

## 2. 目录结构

```
worker/
  pyproject.toml / uv.lock        # Python 3.12，可复现依赖
  Dockerfile / docker-compose.yml # 部署（无公网端口、非 root）
  worker.env.example              # 环境变量模板（不含真实值）
  systemd/campus-pathway-worker.service
  scripts/probe_openrouter.py     # 部署探针（embedding 维度/instruction/JSON/token）
  scripts/seed_corpus.py          # 语料 seed CLI（默认 dry-run；--apply 写库）
  scripts/prewarm_docling.py      # Docling/OCR 模型预热（可选）
  app/
    config.py                     # 环境变量与冻结版本常量（不打印密钥）
    errors.py                     # 错误码/脱敏/可重试分类
    budget.py                     # 月度预算闸门（未配置 = fail closed）
    db.py                         # PostgREST/Storage 客户端 + worker_* RPC 封装
    providers/openrouter.py       # embedding/chat（校验/重试/映射/用量）
    corpus/seed.py                # corpus.jsonl → Supabase + embedding profile（幂等/可续跑）
    ingest/parsers.py             # Docling 优先 + pypdf/python-docx 降级 + locator
    ingest/chunking.py            # 600 tokens / overlap 80 / 表格保表头 / search_terms
    ingest/pipeline.py            # load → parse → embed → persist
    retrieval/hybrid.py           # 纯函数：RRF/配额/预算/闸门
    retrieval/service.py          # 查询 embedding + worker_search_chunks + 邻近块
    prompts/                      # 三类系统提示 + 输出校验/确定性兜底
    rules/repository.py           # 只读 verified 规则行
    rules/engine.py               # 确定性规则引擎（Decimal/环检测/gap code）
    export/pdf.py                 # 中文 PDF
    graphs/                       # 六张固定 LangGraph 图
    runtime/worker.py             # 常驻循环/心跳/优雅退出
    runtime/lease.py              # 30s 心跳与租约丢失判定
  tests/                          # 离线 pytest（不联网）
  tests/fixtures/                 # 合成规则/检索夹具（只用于测试，不进正式库）
```

## 3. 快速开始

本机默认 Python 是 3.14；**必须用 3.12**（`requires-python >=3.12,<3.13`）。

```bash
cd worker
UV_CACHE_DIR=/tmp/uv-cache uv sync --python 3.12 --extra dev
UV_CACHE_DIR=/tmp/uv-cache uv run --python 3.12 pytest -q
```

运行 worker（需要真实环境变量；本地无 Docker 也能跑）：

```bash
cd worker
export $(grep -v '^#' .env | xargs)   # 或用 systemd EnvironmentFile / docker compose env_file
UV_CACHE_DIR=/tmp/uv-cache uv run --python 3.12 python -m app.runtime.worker --check
UV_CACHE_DIR=/tmp/uv-cache uv run --python 3.12 python -m app.runtime.worker
# 本地冒烟：处理一个已入队 job 后退出
UV_CACHE_DIR=/tmp/uv-cache uv run --python 3.12 python -m app.runtime.worker --once
```

`--check` 只校验配置：预算未设置时退出码为 2（fail closed），不会打印任何密钥。

## 4. 配置

全部来自环境变量（见 `worker.env.example`）。关键项：

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `SUPABASE_URL` | 是 | — | Supabase Project URL |
| `SUPABASE_SECRET_KEY` | 是 | — | service/secret key，仅存在 worker 端 |
| `OPENROUTER_API_KEY` | 是 | — | OpenRouter key |
| `OPENROUTER_BASE_URL` | 否 | `https://openrouter.ai/api/v1` | OpenAI 兼容 |
| `OPENROUTER_EMBEDDING_MODEL` | 否 | `qwen/qwen3-embedding-8b` | 冻结，不可静默替换 |
| `EMBEDDING_DIMENSIONS` | 否 | `4096` | 必须 4096（`vector(4096)` 列） |
| `EMBEDDING_NORMALIZATION` | 否 | `l2` | 仅支持 l2 |
| `EMBEDDING_QUERY_TEMPLATE_VERSION` | 否 | `career-qwen-v1` | 模板版本，写入 profile metadata |
| `EMBEDDING_INSTRUCTION_MODE` | 否 | `explicit_template` | 探针确认提供方自动加 instruction 时改 `provider_auto` |
| `OPENROUTER_CHAT_MODEL` | 否 | `deepseek/deepseek-chat` | 只用于解释 |
| `WORKER_CONCURRENCY` | 否 | `1` | v1 固定为 1（一次一个大任务） |
| `RUN_MAX_ATTEMPTS` | 否 | `3` | 供运维核对；实际值由 DB `jobs.max_attempts` 决定 |
| `MODEL_REQUEST_TIMEOUT_SECONDS` | 否 | `60` | HTTP 超时 |
| `MODEL_MONTHLY_BUDGET_USD` | **是** | 未设置 | 未设置时模型调用被拒绝（fail closed） |
| `UNKNOWN_USAGE_RESERVE_USD` | 否 | `0.02` | 成本未知的历史用量按条预留，避免当作 0 |
| `MODEL_INPUT_PRICE_USD_PER_MTOK` 等 | 否 | 未设置 | 设置后写 `estimated_cost`；不设置则成本 NULL |

预算未设置时：worker 启动会打一条 `budget_unset` 告警，任何模型调用抛
`budget_exceeded`（不可重试）；`--check` 退出码 2。**不存在“无限预算”默认值。**

## 5. Embedding profile 与探针

冻结契约（`docs/architecture/overview.md` §6）：

- provider=`openrouter`，model=`qwen/qwen3-embedding-8b`，4096 维，L2 归一化；
- query 输入使用版本化模板：
  `Instruct: Given a campus career planning question, retrieve relevant passages from authorized university documents and verified career evidence.\nQuery: <问题>`
- 文档片段**不加** instruction；
- `query_template_version` 写入 `app_embedding_profiles.metadata`；
- 切换模型/维度/模板 = 新建 profile + 全量重建 + 人工切换 active；worker 检测到
  已有 active profile 与配置不一致时直接 `ConfigError`，绝不混用向量。

部署前用探针确认真实账号权限与行为（会消耗少量额度）：

```bash
cd worker
UV_CACHE_DIR=/tmp/uv-cache uv run --python 3.12 python scripts/probe_openrouter.py
```

探针检查：embedding 维度/条数/index/norm、query 模板与原始问题的余弦相似度
（判断是否需要 `provider_auto`）、batch 形状、chat `response_format=json_object`
是否被接受、token usage 是否返回。输出为安全 JSON，不含密钥。

## 6. 队列 / 租约 / 重试 / 优雅退出

- 队列：`app_private.jobs`；worker 只调用 `public.worker_claim_job` 等 SECURITY DEFINER 函数。
- 租约 120s，心跳 30s；`(worker_id, lease_epoch)` 是 fencing，旧 worker 发布会被
  `stale_lease` 拒绝；心跳返回 false 或连续失败超过租约时长 → 立即停止发布。
- 失败：`worker_fail_job` 决定 `retry`（指数退避）还是 `failed/cancelled`；
  可重试分类：`model_timeout`/`model_unavailable`/`internal_error`；
  不可重试：`model_auth_failed`/`model_quota_exceeded`/`budget_exceeded`/
  `bad_request`/`invalid_profile`/`unsupported_direction`/`resource_not_found`。
- 取消：每个阶段边界检查 `app_runs.cancel_requested`，已取消的任务以 `cancelled` 结束。
- SIGTERM/SIGINT：停止 claim 新任务，当前任务跑完后退出（systemd/compose 给 90s）。

## 7. `app_run_results.payload` 契约（与 BFF/前端一致）

```jsonc
// plan
{"plan_id":"uuid","version_id":"uuid","version":1,"result":{ /* PlanResult，见 src/lib/contracts/plan.ts */ }}

// ask
{"answer":"...","citations":[Citation],"refusal":false,"refusal_reason":"...","boundary_note":"..."}

// export
{"artifact_id":"uuid","plan_id":"uuid","plan_version_id":"uuid",
 "artifact":{"artifact_id":"uuid","bytes":12345,"sha256":"...","expires_at":"..."}}

// assessment_explain
{"explanation":"...","dimensions":[{"dimension":"interest","title":"兴趣倾向","score":3.2,"answered":4,"total":4,"descriptive":"..."}]}

// compare
{"comparison":"...","direction_ids":["trade_supply_chain","finance_accounting"],"evidence":[Citation]}

// ingest
{"source_id":"uuid","source_version_id":"uuid","chunks":12,"documents":1,
 "parser_version":"docling-2.x","extraction_status":"parsed"}
```

要点：

1. `plan` 先 `worker_save_plan` 拿真实 `plan_id/version_id/version`，再 complete；
   `app_plan_versions.actions` 与 `PlanResult.actions` 同源，`p_result` 是完整 PlanResult。
2. `export` 先上传 PDF（路径必须 `{owner_id}/{run_id}/{artifact_id}.pdf`）→
   `worker_register_artifact` → 再 complete。
3. `ask` 的 `Citation` 字段：`citation_no/source_id/source_version_id/chunk_id/record_id/
   title/locator/excerpt/verification_status/source_scope`；引用编号由服务端分配。
4. 进度事件：`parsing → embedding → retrieving → planning → rendering → validating`，
   `progress` 单调递增且 <100，最后 `worker_complete_job`。
5. 事实/数字只来自规则引擎；`credits=null` 表示资料缺失，不是 0。

## 8. ingest 细节

- 解析：优先 Docling（PDF/DOCX，开启 OCR 与表格结构）；import 失败或解析异常时降级
  `pypdf` / `python-docx`，`parser_version` 记录为 `pypdf-<ver>-fallback` /
  `python-docx-<ver>-fallback`，`extraction_status='partial'` 并写告警。
- 定位：Docling 用 `prov.page_no` 记录真实页码；pypdf 用真实页号；DOCX 用段落 block
  序号（DOCX 没有页码，不伪造）；TXT/Markdown 用行号。markdown 中没有定位的文本不会
  被编造页码。
- 扫描件：pypdf 交叉检查空页。Docling OCR 生效时 `extraction_status='ocr'`；否则
  `partial`/`failed`；纯扫描无文本会以 `bad_request` 失败，不会写入空语料。
- 切块：标题/段落优先，目标约 600 tokens、overlap 80 tokens；token 估算器
  `career-cjk-estimator-v1`（中文≈1 token/字，可复现），版本写入 `locator`；
  表格整块保留，超大表按行切但每段重复表头行；`search_terms = jieba 词 + 中文二元字
  + 原文小写`；`text_sha256` 由服务端计算。
- 写入：同一 `source_version_id + splitter_version` 先删旧 chunks（cascade 删
  embeddings）再插入，天然幂等；embedding 以 `"[...]"` 文本写 `vector(4096)` 列；
  单批 16 条调用 `/embeddings`。

### 8.1 语料 seed（`scripts/seed_corpus.py`）

data-dev 生成的 `data/import/out/corpus.jsonl` + `corpus-meta.json` 用本脚本写入 Supabase，
并建立 Qwen3 embedding profile。**默认 dry-run**，只有 `--apply` 才写库/调模型。

```bash
cd worker
# dry-run（不联网、不写库；校验 sha256/计数/source_registry_extra 并打印计划）
uv run --python 3.12 python scripts/seed_corpus.py
# 真正写库（需要 SUPABASE_URL / SUPABASE_SECRET_KEY / OPENROUTER_API_KEY /
# MODEL_MONTHLY_BUDGET_USD；密钥只从环境变量读取，不写文件、不打印）
uv run --python 3.12 python scripts/seed_corpus.py --apply \
  --corpus data/import/out/corpus.jsonl \
  --meta data/import/out/corpus-meta.json \
  --profile-id career-qwen-4096-v1 --batch-size 16
```

参数与默认值：`--corpus data/import/out/corpus.jsonl`、`--meta data/import/out/corpus-meta.json`、
`--profile-id career-qwen-4096-v1`、`--batch-size 16`、`--progress-every 10`。
相对路径会先按当前目录、再按仓库根目录解析，所以从 `worker/` 或仓库根目录运行均可。

行为：

1. **校验**：corpus 文件 sha256/bytes 与 meta 一致、每条 chunk `sha256==sha256(chunk_text)`、
   `chars==len(text)`、visibility 为 `approved_reference`、meta counts 一致、32 个
   `source_registry_extra` 的 source/version/内容哈希与 corpus 行一致。
2. **source_version 解析**：已在库来源（corpus 中 238 个）按 `source_id` 匹配唯一
   `app_source_versions`，并校验其 `source_version_id` 与 corpus 行一致；不一致直接 abort
   （说明 corpus 与 DB 快照不同步，禁止混语料）。32 个 corpus-only 来源用
   `source_registry_extra.source_version` 的确定性 UUID 新增 `app_sources`
   （`visibility=approved_reference`、`owner_id=NULL`、`verification_status` 取 corpus 值）与
   `app_source_versions`（`extraction_status='parsed'`、`parser_version=worker-corpus-seed-…`、
   metadata 标记 `corpus_seed`）。
3. **ordinal**：corpus 行里的 `ordinal` 不可靠（data-dev 生成时多为 0），seed 按
   **source_version 内文件顺序**重排 `0..n-1`；依赖 `unique(source_version_id, splitter_version,
   ordinal)` 做幂等。`app_chunks.splitter_version` 使用 worker 常量
   `career-splitter-2026-10-19.1`，corpus 实际 splitter 版本写入 metadata（`corpus_splitter_version`）。
4. **chunks/embeddings**：`chunk_id` 由 DB 生成；`text_sha256/search_terms/locator/heading_path`
   取自 corpus；embedding 每批 16 条（`/embeddings`），4096 维 + finite/nonzero + L2 校验，
   以 `"[...]"` 文本写 `vector(4096)` 列；写完后重新查库校验 chunk 数量/ordinal/sha 与
   embedding 数量完全匹配。
5. **embedding profile**：固定 provider/model/dims/normalization/query_template_version/
   splitter_version；状态先 `building`，全部校验通过才置 `active`。已存在同 profile 且配置一致则
   复用（corpus sha256 不同会 abort）；配置不一致、或已存在别的 active profile → abort 并提示人工切换，
   **绝不自动覆盖/混用向量**。
6. **预算**：`MODEL_MONTHLY_BUDGET_USD` 未设置直接拒绝（fail closed）；每次模型调用走
   `BudgetGuard` 并写 `app_usage`（token 未知写 NULL）；每 10 批打印一次安全进度日志。
7. **幂等/续跑**：重复 `--apply` 不会重复 chunk/embedding、不重复调模型；中途失败时 profile
   保持 `building`，重新执行会从缺失的 chunk/embedding 续写。不会删除已有数据。
8. **退出码**：`0` 成功；`1` 本地 corpus/meta 校验失败；`2` apply 的配置/预算/写库失败
   （apply 失败输出里 `wrote_database` 为 `null`，表示可能已部分写入、可重跑续写）。

安全：CLI 只打印 JSON 结果与统计，不打印 key/请求体；DB 凭据只从环境变量读取。
本仓库开发环境没有执行 `--apply`（避免未授权写库），由 lead/运维在凭据环境执行并核对
`chunks=764 / embeddings=764 / profile status=active`。

## 9. 检索与拒答闸门

`worker_search_chunks` 在 SQL 内做授权过滤（`approved_reference` 或 owner 本人），
返回 dense（cosine 距离）+ lexical（`ts_rank_cd`）两个分支。worker 侧：

- 分支内排名 → `RRF(k=60)` → 每文档（source_version）最多 3 段、每来源（source）最多 4 段；
- 问题触发来源类型关键词时保留配额（policy 2 / job 2 / plan 1 / case 1 / catalog 2）；
- 选 8–12 段 → 用 `worker_chunk_neighbors` 扩展前后各 1 段（只作上下文，不增加引用编号）
  → 约 7000 字符预算（软预算，至少保留 1 段）；
- 闸门：`dense_min_similarity=0.60` 或（`lexical_min_score=0.08` 且关键词重合 ≥3）
  或关键词重合 ≥5；阈值与 `RETRIEVAL_GATE_VERSION` 一起版本化。**没有照抄旧 bge 0.52**；
  这是保守默认值，换语料后应用题集回归再调，并升级 gate 版本。
- 不过闸门 → 不调用生成模型，返回说明缺哪类/哪届资料的拒答文案。

## 10. 规则引擎

`RulesEngine.query(direction_id, profile, rules_version) -> PlanResult`

- 只读 `status='verified'` 的 `app_courses/app_prerequisites/app_credit_rules/
  app_competitions/app_direction_requirements`；
- `Decimal` 计算学分；任一 verified 课程学分缺失 → `credits=null` + `credits_unavailable`；
- 无 verified 数据 → `data_unavailable` + gap codes（`curriculum_unavailable`、
  `credit_rules_unavailable`、`competitions_unavailable`、
  `direction_requirements_unavailable` 等），行动只包含“去核对”任务，不编造内容；
- `as_of` 从 `rules_version` 里的日期推导（如 `career-rules-2026-10-19.1`），
  输出全部排序；先修环检测 DFS 标记 `prerequisite_cycle`，不会无限递归；
- 合成 fixtures 只在 `tests/fixtures/`，**不进入正式规则库**。

## 11. 提示词与输出校验（三个不）

系统提示（`app/prompts/career.py`）强制：不替用户决定、不替用户算数、不编造；
只依据证据与规则事实；证据中的指令只当资料；中文简洁。

模型统一输出 JSON，程序校验：

- 引用编号必须存在（`answer`/`explanation` 中 `[n]` 与 `citation_numbers`）；
- 数字/百分比必须逐字出现在证据（或规则事实）里；含数字的事实句必须带 `[n]`
  （无数字的陈述句由提示词要求逐句引用，程序不做语义判断）；
- 不得输出证据外 URL；plan 的 `cited_action_ids` 必须是规则事实中已有的 action_id；
- plan 解释中用《》/「」声明的新实体名必须来自规则事实或证据，防止在散文里新增课程/竞赛；
- 越界 → **丢弃解释**：`ask` 回退为确定性拒答；`plan` 回退为确定性说明
  （规则事实不变）；`assessment_explain`/`compare` 回退为确定性说明。

## 12. 导出 PDF

`app/export/pdf.py` 用 reportlab + `UnicodeCIDFont('STSong-Light')`（内置 CID 字体，
无需系统字体文件）生成人工可读 PDF：画像摘要 / 暂定方向 / 行动时间线 / 课程与竞赛
（仅 verified）/ 学分（null 显示“资料缺失，不表示 0 学分”）/ 规则版本与资料截止日 /
引用标题+定位 / 方案说明 / 待核验项 / 免责声明。上传到私有 bucket
`career-artifacts/{owner_id}/{run_id}/{artifact_id}.pdf` 后登记 artifact。

## 13. 部署

### 13.1 Docker Compose（推荐）

```bash
sudo install -d -m 700 /etc/campus-pathway
sudo install -m 600 worker.env.example /etc/campus-pathway/worker.env
sudoedit /etc/campus-pathway/worker.env     # 填 SUPABASE_* / OPENROUTER_API_KEY / 预算
docker compose up -d --build
docker compose logs -f worker
docker compose exec worker python -m app.runtime.worker --check
```

- 不映射端口；`restart: unless-stopped`；`stop_grace_period: 90s`；
- 密钥只通过 `env_file` 注入宿主文件，镜像/仓库不含真实值；
- 健康检查 = `--check`（校验配置与预算，不触网）。

### 13.2 systemd（裸机 VM）

见 `systemd/campus-pathway-worker.service`：`EnvironmentFile=/etc/campus-pathway/worker.env`，
`ExecStartPre=...--check`，`KillSignal=SIGTERM`，`TimeoutStopSec=90`，权限最小化
（`ProtectSystem=strict`、`NoNewPrivileges`）。安装步骤写在文件头注释里。

### 13.3 Docling / OCR 缓存

Docling 的 layout/table/OCR 模型在**首次转换**时下载到 `DOCLING_CACHE_DIR` /
`HF_HOME`（默认 `/home/worker/.cache`）。两种策略：

1. **运行期下载（默认，镜像小）**：compose 把 `/home/worker/.cache` 挂到命名卷
   `docling-cache`，容器重建不重复下载；首次 ingest 会慢一些。
2. **构建期预热（镜像大、启动快）**：
   `docker build --build-arg PREWARM_DOCLING=1 ...` 或运行
   `python scripts/prewarm_docling.py`。预热脚本只下载模型并转换一份自造样例，
   不读取用户资料。
3. 私有/离线环境：提前把缓存目录拷贝进 VM 的卷，并设 `DOCLING_ENABLED=true`；
   未安装 Docling 时 worker 自动降级 pypdf/python-docx（记录 fallback）。

### 13.4 重启恢复与滚动升级

- 进程崩溃/VM 重启：`restart: unless-stopped` / `Restart=always`；未完成 job 的租约
  120s 后过期，`worker_claim_job` 会自动回 `queued`（未超 `max_attempts`）或标
  `failed/lease_expired`（已超）；旧 worker 的迟到结果会被 `(worker_id, lease_epoch)`
  fencing 拒绝，不会覆盖新结果。
- 滚动升级（单实例）：`docker compose up -d` 会先发 SIGTERM → 最多等 90s 让当前任务
  收尾 → 新容器启动后重新 claim。不要并行跑两个 `WORKER_CONCURRENCY=1` 的实例去抢
  同一个 VM 资源；需要扩容时按 job 并发评估，并保持 fencing 前提。
- 回滚：镜像/release 保留上一版 tag；配置回滚后 `docker compose up -d --force-recreate`。

## 14. 测试

离线 pytest（不联网；HTTP/DB 全用 fake client）：

```bash
cd worker
UV_CACHE_DIR=/tmp/uv-cache uv run --python 3.12 pytest -q
```

覆盖：切块/定位、embedding 校验与归一化、重试与错误映射、RRF/配额/预算、闸门、
规则确定性与缺数据 `credits=null`、引用/数字校验、队列 fencing 纯逻辑、PDF 生成、
六类图（用 fake DB/provider）、corpus seed（dry-run 计划/ordinal/幂等/profile 冲突/维度校验）。

## 15. 已知限制

- `WORKER_CONCURRENCY` 只支持 1；多实例扩容需要另做资源与重复 claim 评估。
- Docling 是重型可选依赖；基础镜像不装时自动降级，解析质量/页码定位会变弱。
- 检索/闸门阈值是保守默认值，**必须在真实语料上用题集回归后**再调并升级 gate 版本。
- 就业率/薪资/通过率等数字不在本 worker 的事实输出范围内（团队三个不）。
- 本 README 描述的部署步骤在目标 VM 上需要运维实际执行；仓库不包含真实密钥。
