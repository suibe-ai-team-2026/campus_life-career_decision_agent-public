# 云端 RAG 回归

`cloud_questions.json` 复用 `smart-campus-career` 旧 PR #7 的 38 道题（只作为回归输入，不作为本版验收分数）。`cloud_eval.py` 通过本机 BFF 创建匿名身份、逐题提交 `kind=ask` run、轮询结果，并记录：

- 状态、是否拒答、引用数、引用 source_id；
- expected_source_ids 命中；expected_behavior=answer 时误拒、=refuse 时漏拒；
- 端到端延迟。

运行（需要本地 BFF 与云端 worker 在线）：

```bash
python3 tests/rag_eval/cloud_eval.py --base http://127.0.0.1:3100
```

报告默认写到 `docs/evidence/rag-eval-cloud.json`。旧 PR 的 38/38 不能作为本版准确率承诺。
