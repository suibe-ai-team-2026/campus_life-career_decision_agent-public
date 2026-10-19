# 数据库与权限摘要

来源：`supabase/migrations/20261019000{100,200,300,400}_*.sql`。以下为快速索引，字段与约束以 SQL 为准。

## 表

- 来源与检索：`app_sources`、`app_source_versions`、`app_evidence_records`、`app_source_aliases`、`app_chunks`、`app_embedding_profiles`、`app_chunk_embeddings`、`app_import_batches`。
- 产品与规则：`app_directions`、`app_assessments`、`app_profiles`、`app_plans`、`app_plan_versions`、`app_courses`、`app_prerequisites`、`app_competitions`、`app_credit_rules`、`app_direction_requirements`、`app_requirement_actions`。
- 运行与交付：`app_runs`、`app_run_results`、`app_run_events`、`app_artifacts`、`app_usage`、`app_private.jobs`。

## 权限要点

1. 所有前端可达表启用 RLS；用户表 `owner_id = auth.uid()`，父子表用 `exists` 校验父归属，不信任子表自报 owner。
2. 共享语料读策略只允许 `visibility='approved_reference'`；私有资料只允许本人。`verification_status` 与 `visibility` 分开。
3. `app_chunk_embeddings`、`app_source_aliases`、`app_import_batches` 无用户策略；只有 service_role。
4. `app_runs` 无用户 INSERT/UPDATE 策略；提交与取消走 `app_submit_run` / `app_cancel_run`（SECURITY DEFINER，内部用 `auth.uid()`）。
5. worker 函数只 grant 给 `service_role`；`(worker_id, lease_epoch)` fencing。
6. Storage：`career-source-files`、`career-artifacts` 均 private；用户路径首段必须是 `auth.uid()`；下载由 BFF 验权后签短期 URL。
7. 4096 维 vector 可存储，但未建 HNSW/IVFFlat；精确 cosine 扫描，规模增长时另建 MRL profile 并全量重建。

## 队列状态机

`queued → running → succeeded|failed|cancelled|dead`。租约 120 秒，30 秒心跳；过期未超 max_attempts 回 queued（指数退避+jitter），超过则 failed/dead；同一 run 的迟到结果因 epoch 不匹配无法发布。
