# 部署与运维 Runbook

状态：**代码与迁移已准备；云端资源尚未创建/登录，以下步骤中标注「未执行」的条目必须在真实凭据到位后执行并记录证据。**
用户无需安装 Docker；本地开发用 `npm`/`uv` 即可，Supabase 迁移走云端 CLI。

## 0. 资源与前置确认

| 资源 | 建议 | 当前状态 |
|---|---|---|
| GitHub | `suibe-ai-team-2026/campus_life-career_decision_agent`，分支 `feat/career-cloud-wizard` | 已创建分支/提交 |
| Supabase | 比赛专用 Organization 下的新项目 `campus-pathway-career-dev`（不是同学项目 `ltxgjjcxuvqwnjtpegye`） | 等待用户登录/授权 |
| Vercel | 比赛专用 Pro Team（Hobby 不能部署 private org 仓库）；项目名 `campus-pathway-career` | 等待用户确认套餐/team |
| Freestyle | 比赛专用 Team/VM `campus-pathway-worker-dev` | 等待用户登录/团队 |
| OpenRouter | API Key，模型 `qwen/qwen3-embedding-8b` + `deepseek/deepseek-chat` | 等待用户填入受保护文件 |

**不自动做的事**：升级套餐、增加收费席位、公开私有仓库、修改/导出同学数据库、用个人空间冒充团队资源。

## 1. 本地受保护配置

用户在自己的终端创建（不要发到聊天）：

```bash
mkdir -p ~/.config/campus-pathway
chmod 700 ~/.config/campus-pathway
# 用编辑器填写，保存后 chmod 600
$EDITOR ~/.config/campus-pathway/credentials.env
chmod 600 ~/.config/campus-pathway/credentials.env
```

`credentials.env` 变量名（值由用户填写）：

```dotenv
OPENROUTER_API_KEY=
SUPABASE_ACCESS_TOKEN=
SUPABASE_DB_PASSWORD=
VERCEL_TOKEN=
FREESTYLE_API_KEY=
SUPABASE_ORG_ID=
SUPABASE_PROJECT_REF=
SUPABASE_REGION=
VERCEL_SCOPE=
FREESTYLE_TEAM=
```

Agent 运行脚本时通过 `CAMPUS_PATHWAY_ENV_FILE=~/.config/campus-pathway/credentials.env` 读取；日志/PR/文档不出现值。校验方式：`stat -f '%Sp'` 为 `-rw-------`，且 `npx tsx scripts/probe-models.ts` 不打印 key。

## 2. Supabase（M2）

### 2.1 创建/接管项目

由用户在 Supabase 控制台确认比赛专用 Organization（显示名建议 `SUIBE AI Team 2026`），并邀请成员各自接受邀请；不共享登录。然后二选一：

- **A（推荐）** 用户创建 `campus-pathway-career-dev`，地区建议 `ap-southeast-1`（以控制台实际可选项为准），记下 Project Ref 与 DB 密码（填进受保护文件）。
- **B** 复用同学项目：仅当项目所有者明确授权写范围；只读授权只允许跑只读查询，不执行迁移/导入。当前未取得该授权，默认走 A。

CLI（token 从受保护文件注入，不写进命令历史）：

```bash
set -a; . ~/.config/campus-pathway/credentials.env; set +a
npx supabase orgs list
npx supabase projects list
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push --dry-run   # 只列计划，不等于真实执行
npx supabase db push             # 执行 5 个迁移
npx supabase gen types typescript --linked > src/lib/supabase/database.types.ts
```

迁移文件：`20261019000100` 表/索引 → `...000200` RLS → `...000300` 函数/队列 → `...000400` Storage → `...000500` 私有上传策略。
不使用 `db reset --linked`、不自动 `migration repair`、不使用 `--include-all` 跳过历史冲突。

### 2.2 控制台设置（CLI 不会自动完成）

1. Authentication → Providers → 启用 Anonymous Sign-ins；配置 Site URL = Vercel 正式域名，Additional Redirect URLs 只放精确 callback。
2. Authentication → Rate limits：匿名登录按 IP 限额；必要时加 CAPTCHA/Turnstile（由用户完成官方流程）。
3. Storage：确认 `career-source-files`、`career-artifacts` 均为 private；文件大小/ MIME 限制与迁移一致。
4. Database → Extensions：确认 `vector`、`pgcrypto`、`pg_trgm` 已启用。
5. 备份策略与项目成员角色（Owner/Developer/Administrator）按 `docs/team-infrastructure.md` 登记。

### 2.3 数据导入（M2）

```bash
# dry-run：只读、本地报告
npx tsx scripts/import-research.ts --dry-run

# apply：需要 SUPABASE_URL + SUPABASE_SECRET_KEY（不是 ACCESS_TOKEN）
set -a; . ~/.config/campus-pathway/credentials.env; set +a
npx tsx scripts/import-research.ts --apply
```

导入 2+7 pilot、319 来源、243 记录、115 要求、250 aliases、34 文档、种子方向/测评；重复运行行数不变。旧 `01-import.sql` 不执行。详细计数与校验见 `docs/import-record.md`。

## 3. Vercel（M6，前置 M2）

私有组织仓库需要获授权的比赛 Pro Team（Hobby 不支持）。确认套餐/席位/付款人后再执行：

```bash
set -a; . ~/.config/campus-pathway/credentials.env; set +a
npx vercel whoami
npx vercel teams ls
npx vercel link --scope "$VERCEL_SCOPE" --project campus-pathway-career
# Root Directory 必须是本仓库根（Next.js）
npx vercel env add NEXT_PUBLIC_SUPABASE_URL preview
npx vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY preview
npx vercel env add NEXT_PUBLIC_APP_URL preview
npx vercel env add SUPABASE_SECRET_KEY preview   # 仅 server-only
npx vercel deploy
# 预览验收后：
npx vercel deploy --prod
```

production 环境变量单独添加，不能把 preview 数据库当生产库。Freestyle 团队管理 key、OpenRouter key **不**放 Vercel（BFF 不直接调用它们）。

## 4. Freestyle worker（M3/M4）

```bash
set -a; . ~/.config/campus-pathway/credentials.env; set +a
npx freestyle whoami
npx freestyle team list
npx freestyle team use "$FREESTYLE_TEAM"
npx freestyle vm create --snapshot-id freestyle/ubuntu --slug campus-pathway-worker-dev --no-ssh
npx freestyle vm get campus-pathway-worker-dev
npx freestyle vm exec campus-pathway-worker-dev -- docker --version
```

部署 worker（镜像不含 secret；VM 内 `/etc/campus-pathway/worker.env` chmod 600，来自用户安全注入）：

```bash
# 上传代码/镜像（二选一：vm scp 或受控 registry）
npx freestyle vm scp worker campus-pathway-worker-dev:/opt/campus-pathway/worker
npx freestyle vm scp ~/.config/campus-pathway/worker.env campus-pathway-worker-dev:/etc/campus-pathway/worker.env
npx freestyle vm exec campus-pathway-worker-dev -- bash -lc 'chmod 600 /etc/campus-pathway/worker.env && cd /opt/campus-pathway/worker && docker compose up -d --build'
```

worker 无公网端口；systemd/docker restart 策略常驻；记录 VM ID、镜像 digest、commit、CLI 版本。密钥不进 snapshot/镜像。

## 5. 模型探针与索引（M4）

```bash
npx tsx scripts/probe-models.ts      # 确认 qwen/qwen3-embedding-8b 在目录
npx tsx scripts/probe-embedding.ts   # 真实付费小请求：4096 维/有限/归一化/延迟/usage
```

探针通过后：
1. `scripts/build-corpus.ts` 生成 corpus.jsonl；
2. worker 执行 ingest/seed（`python -m app.runtime.seed_corpus --corpus ... --profile career-qwen-4096-v1`，以 worker README 为准）；
3. 创建 `app_embedding_profiles` 行并在全量向量完成、回归通过后原子切 `active`；
4. 跑 `worker/tests` 与 RAG 回归（有证据/跨源/缺数据/数字超界），记录命中、引用可定位率、拒答、误拒、P50/P95、费用。

## 6. 验收（M6）

```bash
npx tsx scripts/smoke.ts
```

按 `docs/acceptance.md` 逐项；必须记录真实 URL、Supabase ref、VM ID、迁移/导入批次、模型 profile、测试命令与输出。关闭开发电脑后网站与已提交任务仍可用，才算云端部署完成。

## 7. 回滚

- 前端：Vercel 回滚到上一个 deployment。
- worker：回滚镜像 digest/commit；旧结果因 lease epoch 不会覆盖。
- embedding：保留旧 profile 数据，原子切回 `active`；不混维。
- 数据：按 `app_import_batches.batch_id` 仅删本批次新增且未被用户引用的行；有依赖先标废弃。
- 密钥：平台撤销/轮换后更新受保护文件与平台 secret，记录时间与影响范围。

## 8. 当前阻塞

1. Supabase 账号登录/组织与项目授权未确认 → 不能执行迁移与导入。
2. OpenRouter Key 未提供 → 不能做真实 embedding 探针/建向量索引。
3. Vercel Team/付费套餐未确认 → 不能部署 private org 仓库。
4. Freestyle 账号/团队未确认 → 不能创建 worker VM。
5. 课程/竞赛/学分结构化资料缺失 → Step 4 规则闭环只能 `data_unavailable` + 核对任务。
