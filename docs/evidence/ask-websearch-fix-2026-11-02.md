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

`worker/tests/test_graphs.py` 新增 5 个回归用例：语料+参考+网页编号连续、
无参考数据命中、联网失败降级、联网 0 来源提示、仅网页证据时编号从 1 开始。

## 5. 验证

本地（离线、fake DB/provider，不联网）：

```
cd worker && .venv/bin/python -m pytest -q
# 358 passed
```

旧代码对照：同一份新增测试在 HEAD 版 `ask.py` 上 2 failed，异常为
`UnboundLocalError: cannot access local variable 'citations' ... ask.py:155`，
与线上事件链一致；修复后 21 passed（test_graphs.py）。

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
