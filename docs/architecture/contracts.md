# BFF / worker 契约

统一响应：成功 `{ request_id, data }`；失败 `{ error: { code, message, request_id, details? } }`。
错误码见 `src/lib/contracts/common.ts`；`authentication_required=401`、`resource_not_found=404`、`version_conflict|idempotency_conflict=409`、`upload_too_large=413`、`invalid_profile|unsupported_direction=422`、`rate_limited=429`。

## 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 公开存活状态；不暴露 DB host/key/内部路径 |
| GET | `/api/catalog/directions` | 六方向卡 + 核验覆盖；可匿名 |
| GET | `/api/assessments/current` | 当前轻测题目/版本；可匿名 |
| POST | `/api/profiles` | 保存授权上云的画像快照；需登录（含匿名） |
| PATCH | `/api/profiles/:id` | `expected_version` 乐观锁 |
| GET | `/api/profiles/:id` | 本人画像 |
| POST | `/api/runs` | body `RunSubmit`；返回 202 `{run_id,status,status_url}` |
| GET | `/api/runs/:id` | 授权状态/结果/错误 |
| GET | `/api/runs/:id/events?after=seq` | 增量事件 |
| POST | `/api/runs/:id/cancel` | 取消自己的 run |
| GET | `/api/plans/:id` | 当前/历史方案版本 |
| PATCH | `/api/plans/:id/actions/:actionId` | `expected_version`；用户调整与机器字段分开 |
| POST | `/api/sources/upload-intent` | 返回私有路径 + 签名上传参数 |
| POST | `/api/sources/:id/complete` | 校验对象并提交 ingest 任务 |
| GET | `/api/sources/:id/versions/:version` | 来源元数据与安全定位 |
| GET | `/api/sources` | 已批准共享来源 + 本人来源 |
| GET | `/api/artifacts/:id/download` | 验权后返回短期签名地址 |
| POST | `/api/auth/anonymous` | 建立匿名身份（首次 AI/上传/导出时调用） |

## Run 提交

```json
{"kind":"plan","profile_id":"uuid","profile_version":2,"direction_id":"trade_supply_chain","plan_id":"uuid|null","idempotency_key":"浏览器生成 UUID"}
```

- `kind`：`assessment_explain | compare | plan | ask | export`。
- `ask` 另带 `question`（≤1000 字）、`history`（≤4 轮）、可选 `source_version_ids`。
- `compare` 另带 `direction_ids`（2–3 个不重复方向）。它只比较方向卡与证据，**不强制 `profile_id`**；
  带 `profile_id` 时服务端会校验归属并注入画像版本，仅用于可选的个性化说明。
- `plan` / `assessment_explain` 仍必须带 `profile_id`（服务端按 `profile_version` 做乐观锁）。
- 同一 `(owner_id, kind, idempotency_key)` 重试只建一次；同键不同 `input_hash` 返回 409。
- 202 只代表入队，不代表生成成功；完成状态必须读 run/events。

## 方案结果（事实 / 解释分离）

```json
{"status":"partial","rules_version":"career-rules-2026-10-19.1","profile_version":2,
 "direction_id":"trade_supply_chain","actions":[],"courses":[],"competitions":[],
 "credits":null,"gaps":[{"code":"curriculum_unavailable","message":"尚未取得适用年级的结构化培养方案"}],
 "evidence":[],"explanation":"..."}
```

- `credits=null` 表示资料缺失，不表示 0。
- 引用由服务端分配 `citation_no`；LLM 不生成 source URL。
- 任务失败通过 `run.failed + error_code`，不能把 HTTP 202 当成功。

## Worker 契约

- 队列：`public.worker_claim_job` / `worker_heartbeat` / `worker_set_progress` / `worker_complete_job` / `worker_fail_job`。
- 发布：`worker_save_plan`、`worker_register_artifact` 都在 lease 校验通过后才写入；旧 epoch 调用报 `stale_lease`。
- 检索：`worker_search_chunks(owner, profile, query_embedding_text, query_text, limit)` 与 `worker_chunk_neighbors(ids, owner)` 已在 SQL 内做权限过滤。
- 事件类型：`queued → running → parsing/embedding/retrieving/planning/rendering → validating → succeeded`，另有 `cancel_requested/cancelled/failed`；`seq` 单调。
