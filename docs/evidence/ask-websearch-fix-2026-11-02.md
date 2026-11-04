# 资料问答「联网补充」失败修复（2026-11-02）

状态：**已修复、已部署、线上实测通过**。

## 1. 现象

线上资料问答勾选「联网补充」后，前端显示
「生成失败：服务暂时不可用，请稍后重试」。同一时间 `web_search=false` 的问答正常。

## 2. 线上证据

Supabase `app_runs` / `app_run_events`（不含用户身份信息）：

| run_id | 提交时间 (UTC) | web_search | 结果 |
|---|---|---|---|
| `eaf6e74b-ab1b-47f1-b753-519cb7843b7f` | 2026-11-02T10:10:21 | true | **failed / internal_error**，progress 38 |
| `965e7ff1-4c07-4d44-9815-babdd112b452` | 2026-11-02T08:22:36 | false | succeeded |

失败 run 的事件序列（重复 3 次）：

```
retrieving(38)
agent_note 已开启联网补充，开始实时网页调研
running {code:"internal_error", retry:true}   ← 约 0.3 秒后立即失败
running {attempt:2} … 同样失败
running {attempt:3} … 同样失败
failed {code:"internal_error", retry:false}
```

即：进入 `answer` 节点写「已开启联网补充」后立刻抛未知异常；worker 归类为
`internal_error` + 可重试，重试 3 次后 run 失败。前端把 `internal_error`
显示为「服务暂时不可用」，因此用户看到的是通用错误，而不是真实原因。

## 3. 根因

`worker/app/graphs/ask.py` 的 `answer_node` 在提交 `e589cc3`
（接入参考数据）后出现回归：

```python
# 旧代码：citations 尚未赋值，却先读取 len(citations)
web = run_web_research(..., numbering_start=len(citations) + 1)
...
citations: list[Any] = list(retrieval.citations)   # 在 web 分支之后
```

`web_search=true` 时触发 `UnboundLocalError: cannot access local variable
'citations'`；该异常不在 WorkerError 分类内，`classify()` 返回
`internal_error` + 可重试，最终写回 `app_runs.error_code = internal_error`。

此外，只把赋值顺序调换仍会撞号：参考数据证据编号与网页引用编号都从
`len(evidence)+1` 起算，两者同时存在时会重复。

## 4. 修复

`worker/app/graphs/ask.py`：

1. 先组装语料证据 + 参考数据证据并完成编号，再做可选联网调研；
2. 新增 `_next_citation_no(evidence)`（`max(citation_no)+1`），参考数据与网页证据
   都接在已有证据之后，避免非连续编号时撞号；
3. 联网补充失败（`WorkerError`：超时/鉴权/配额/预算/数据库）降级为仅使用
   语料 + 参考数据，并在 `boundary_note` 标注「联网补充暂不可用」，不再把整个
   问答判为失败；
4. 联网开启但 0 条来源时，也把「未找到可用的实时网页证据」写入边界说明。

`worker/tests/test_graphs.py` 新增 6 个 ask 联网回归用例：语料+参考+网页编号连续、
无参考数据命中、联网失败降级、联网 0 来源提示、仅网页证据时编号从 1 开始、
联网关闭路径；第二轮再补 1 个 plan 联网降级用例，共 7 个。

## 5. 验证（第一轮）

本地（离线、fake DB/provider，不联网）：

```
cd worker && .venv/bin/python -m pytest -q
# 第一轮提交 087ce10 时 358 passed；第二轮补测试后 359 passed（见 §7.4）
```

旧代码对照：同一份新增测试在 HEAD 版 `ask.py` 上 2 failed，异常为
`UnboundLocalError: cannot access local variable 'citations' ... ask.py:155`，
与线上事件链一致；修复后 `test_graphs.py` 21 passed（第一轮提交时；第二轮后 22 passed）。

线上端到端（生产 https://zhitu.quest，真实 worker）：

| 场景 | run_id | 结果 |
|---|---|---|
| 修复前同一问题 + 联网补充 | `eaf6e74b-…` | failed / internal_error |
| 修复后同一问题 + 联网补充 | `bd0e3ac5-93f5-4689-82f0-aa7f0cd69843` | succeeded，29 条引用（含 19 条实时网页） |
| 修复后同一问题 + 联网补充（第二次） | `1083e11a-ec21-4704-8b21-ca388d599849` | succeeded，29 条引用，编号连续 |
| 镜像重建/容器重启后联网补充 | `3cbd1fe1-0cac-4db8-8a3d-9a68c57da625` | succeeded，35 条引用（含实时网页） |
| 镜像重建/容器重启后仅本地资料 | `8f66e4f3-bdb1-4373-b15a-7977d362c4c4` | succeeded，18 条引用 |

前端检查：`npm run check`（typecheck + lint + vitest + production build）exit 0。
注：首次 check 因 `.next/` 内的 iCloud 重复文件（`routes.d 2.ts`）失败，删除
gitignored 的 `.next/` 重新生成后通过，与本次代码改动无关。

部署：VM 源码目录同步 `app/graphs/ask.py` → 重建镜像
`campus-pathway-worker:local` → `docker compose up -d` 重建容器；
容器内文件 sha256 与仓库工作区一致（`42e6fbed…`），容器 healthy。

## 6. 复跑命令

```bash
cd worker && .venv/bin/python -m pytest tests/test_graphs.py -q
cd worker && .venv/bin/python -m pytest -q
cd .. && npm run check
```

线上复测（匿名会话需自行创建）：`POST /api/runs` 传
`{"kind":"ask","question":"…","web_search":true}`，轮询 `/api/runs/{id}`，
确认 `status=succeeded` 且 `citations[].source_scope` 含「实时网页」。

## 7. 相关风险修复（第二轮）

第一轮修复后，同一链路上还有两处会把「可选联网增强」的失败放大成用户可见的
通用错误/任务失败，一并修掉：

### 7.1 plan 的联网调研失败会直接 fail job

`worker/app/graphs/plan.py` 的 `explain_node` 直接调用 `run_web_research`，模型超时/
配额/鉴权/预算/DB 错误不在解释生成的 try 内，会冒泡成任务失败。

修复：包 `try/except WorkerError`，失败时降级为仅用本地证据，`warnings` 写入
`web_research_fallback:<code>`，`explanation` 追加「资料边界：联网补充调研暂不可用…」；
`src/lib/plan-display.ts` 新增该 warning 的中文翻译。即使联网 0 来源，也把
「未找到可用的实时网页证据」写入资料边界。新增测试
`test_plan_graph_web_research_failure_degrades`。

### 7.2 DB 租约回收码 `lease_expired` 仍显示「服务暂时不可用」

DB 的 `app_reap_expired_leases` 会把 `app_runs.error_code` 写成 `lease_expired`，
但前端 `ERROR_CODES` 没有该码，`runFailureMessage` 会回退到 `internal_error` 文案。

修复：`ERROR_CODES` 增加 `lease_expired`（HTTP 409）；`api-client.ts`
增加「任务执行超时或中断，请重新发起」；`http/rpc.ts` 的 `mapDbError` 映射该码；
`worker/app/errors.py` 的码表对齐；`docs/architecture/contracts.md` 同步。
新增 `tests/unit/error-messages.test.ts` 覆盖已知/未知/取消三类文案，并锁定
`lease_expired`=409 与 `mapDbError` 映射；`tests/unit/contracts.test.ts` 新增
TS↔Python 错误码表一致性测试，防止 `ERROR_CODES` 两处漂移。

### 7.3 引用编号工具统一

`next_citation_no`（`max(citation_no)+1`）从 `ask.py` 移到
`worker/app/graphs/common.py`，ask 与 plan 共用，避免两处各自用 `len+1` 漂移。

### 7.4 第二轮验证

- worker：`pytest -q` → **359 passed**；
- 前端单测：`npx vitest run` → **103 passed（13 files）**；
- `npm run check`（typecheck + lint + vitest + production build）→ exit 0；
- 线上（部署第二轮代码后，真实 worker）：
  - ask + 联网补充 `851f7c81-8bbf-469b-bd89-d0f5b687a53d` → succeeded，32 条引用，编号连续，含实时网页；
  - plan + 联网补充 `7a156978-cdce-49cf-845b-0308c539d8e7` → succeeded，38 条证据（含 28 条实时网页），
    warnings 无 `web_research_fallback`（测试画像触发的 `data_unavailable` 是预期状态，不是失败）；
  - 镜像重建 + 容器重建后 ask + 联网补充 `dc040b6f-0e1a-4955-9e11-0e8f293da4d0` → succeeded，29 条引用，编号连续。

部署：同步 `ask.py` / `plan.py` / `common.py` 到 VM 源码目录，重建镜像并
`docker compose up -d` 重建容器；容器内三个文件 sha256 与仓库工作区一致
（`484baa46…` / `c3fd153f…` / `31890da2…`），容器 healthy。
