# 权限、密钥与数据安全

## 1. 角色与密钥边界

| 角色 | 持有凭据 | 能做什么 | 不能做什么 |
|---|---|---|---|
| 游客/浏览器 | `NEXT_PUBLIC_SUPABASE_URL` + publishable key（设计上可公开） | 读公开目录/测评、匿名登录后读写本人数据 | 读别人数据、拿 service key、直连 OpenRouter |
| 匿名/正式用户（authenticated） | Supabase Auth JWT cookie | 提交 run、读写本人 profile/plan/run/artifact、上传私有文件 | 写共享语料、claim 任务、发布方案版本 |
| Vercel BFF | Supabase URL + publishable key（用户态）+ `SUPABASE_SECRET_KEY`（仅签发上传/验权下载/创建 ingest run） | 校验 JWT/Zod/所有权/预算/限流；签名上传；创建 ingest 任务 | 用 admin client 做任意用户查询后前端过滤 |
| Freestyle worker | `SUPABASE_SECRET_KEY` + `OPENROUTER_API_KEY` | 领取任务、解析、embedding、检索、生成、写结果/artifact/usage | 被公网调用；把 key 传给 parser 容器 |
| 运维/CI | `SUPABASE_ACCESS_TOKEN`、`SUPABASE_DB_PASSWORD`、`VERCEL_TOKEN`、`FREESTYLE_API_KEY` | 迁移、部署、建 VM | 进入浏览器 bundle 或普通任务环境 |

`SUPABASE_ACCESS_TOKEN`、`SUPABASE_SECRET_KEY`、`SUPABASE_DB_PASSWORD` 是三类不同凭据，不能互换。任何 secret 都不得加 `NEXT_PUBLIC_` 前缀。

## 2. RLS / Storage 策略要点

- 用户表（profiles/plans/plan_versions/runs/results/events/artifacts）以 `owner_id = auth.uid()` 隔离；子表用 `exists` 校验父归属，不信任子表自报 owner。
- 共享语料只在 `visibility='approved_reference'` 时可读；`verification_status` 与 `visibility` 分开，不能用核验状态代替权限。
- `app_runs` 没有用户 INSERT/UPDATE 策略；提交/取消走 `app_submit_run` / `app_cancel_run`，内部用 `auth.uid()`。
- worker 函数是 SECURITY DEFINER 且只 grant 给 `service_role`；`(worker_id, lease_epoch)` fencing，旧 worker 不能发布结果。
- Storage 两个 bucket 均 private；用户对象路径首段必须是 `auth.uid()`；artifact 下载由 BFF 先查 RLS 再签 60 秒 URL。
- 检索在 SQL 候选集阶段过滤 `visibility/owner_id`；不会先跨用户召回再事后过滤。

## 3. 匿名身份与防滥用

- 首次 AI/上传/云端导出时才建立 Supabase anonymous sign-in；本地进度不上云。
- 上线前在 Supabase 控制台启用 Anonymous Sign-ins，并配置每 IP 每小时匿名登录限额；若启用 CAPTCHA/Turnstile，由用户在官方 Auth 流程完成。
- BFF 有每实例 5 分钟 20 次 run 的限流（非分布式，仅缓解）；预算检查读 `app_usage` 当月 `estimated_cost`，`MODEL_MONTHLY_BUDGET_USD` 未设置时不得视为无限预算（见 deployment 的前置要求）。
- 匿名用户升级正式账号需保留/链接身份并验证旧资源归属；过期匿名数据清理前先用 synthetic 用户验收清理范围。

## 4. 上传与内容安全

- 仅允许 PDF/DOCX/TXT/MD，≤20MB；complete 阶段实际下载对象、校验 sha256 与大小，声明不一致拒绝。
- 文件内容一律当数据，不执行其中指令；解析在 worker 内隔离进程/容器，不给 parser 数据库/模型 key。
- 第一版不做任意网页抓取；后续 URL 导入必须防 SSRF/私网/metadata/重定向绕过。
- 日志只记 request/run/job id、模型、耗时、token、错误码；遮盖 Authorization、连接串、签名 URL、简历正文、Cookie、邮箱。

## 5. 威胁模型检查（验收时逐项）

1. 游客 A 用 JWT 读 B 的 profile/plan/run/event/source/artifact：应 404。
2. 猜 chunk_id/source_version_id 调引用接口：RLS/检索过滤后不可得。
3. 未认证请求与 anonymous 用户分开测试：前者 401，后者按 authenticated 处理。
4. service key 不出现在浏览器 bundle/source map/Network/日志/截图。
5. 签名上传路径越权、artifact 路径越权、Storage 猜 URL：均应被策略拒绝。
6. 429/401/402/超时：任务失败状态与 safe error_code，不能静默换模型或无限重试。
7. 旧 worker 在租约过期后提交结果：`stale_lease` 拒绝。

## 6. 已知缺口（截至 2026-10-19）

- 匿名 Auth 的 CAPTCHA/限流需在 Supabase 控制台实际开启并验证。
- 限流为单实例内存实现，不构成生产级分布式配额；预算依赖 worker 写入的 usage 近似值。
- 尚未做真实公网渗透测试；RLS 将在专用 dev 项目用两个匿名 JWT 做 A/B 回归。
