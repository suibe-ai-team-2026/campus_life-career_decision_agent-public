# 验证证据索引

本目录只记录可复核的结果与命令输出摘要，不含密钥、Cookie、签名 URL 或学生个人信息。

| 文件 | 内容 |
|---|---|
| `migration-dry-run.json` | 5+2 个迁移在真实库单事务执行后回滚的计划记录 |
| `migration-apply.json` | 按序应用迁移、迁移历史与对象计数 |
| `database-state.json` | 迁移历史、表/RLS/policy/Storage/extension/数据计数 |
| `model-probe.json` | OpenRouter Qwen3 Embedding 8B 真实探针（4096 维、归一化、延迟、usage） |
| `cloud-e2e.json` | 匿名登录→画像→plan/ask/export→签名下载→幂等/越权测试 |
| `worker-runtime.json` | Freestyle VM、镜像、compose 健康与三类任务成功记录 |
| `preview-smoke.json` | Vercel Preview 健康、首页、目录 API 与部署保护说明 |

复跑命令见 `docs/deployment.md`；云端迁移通过 Management API 执行，因为本机到 5432/6543 的直连被网络代理阻断。
