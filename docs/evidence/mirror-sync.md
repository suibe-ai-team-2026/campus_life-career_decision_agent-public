# 私有仓 → public 镜像同步验证

- 检查时间：2026-10-21（Asia/Taipei）
- private：`suibe-ai-team-2026/campus_life-career_decision_agent`
- public：`suibe-ai-team-2026/campus_life-career_decision_agent-public`
- 触发方式：private `main` push → `.github/workflows/mirror-main-to-public.yml`

## 结果

| 项目 | 结果 |
|---|---|
| private main | `7d8ac4d`（`ci: skip mirror workflow in public mirror repo`） |
| public main | `7d8ac4d`（与 private 一致） |
| private mirror run | [#39570169378](https://github.com/suibe-ai-team-2026/campus_life-career_decision_agent/actions/runs/39570169378) success |
| public mirror run | [#39571079997](https://github.com/suibe-ai-team-2026/campus_life-career_decision_agent-public/actions/runs/39571079997) success（仓库 guard 跳过，不再误报 failure） |

## 说明

1. public 仓昨天两条 failure 不是镜像失败：镜像已把 commit 推到 public，随后 public 仓里的同一 workflow 文件被这次 push 触发，因 public 仓没有 `PUBLIC_MIRROR_TOKEN` 而失败。workflow 已加仓库 guard，在 public 仓触发时直接跳过，只保留一条 success。
2. `PUBLIC_MIRROR_TOKEN` 已生效，普通代码/文档 commit 会自动同步。修改 `.github/workflows/*` 本身时，还要求 token 具备 public 仓 `Workflows` 写权限（见 `docs/deployment.md`）；本次 workflow 变更通过一次性直接推送完成。
3. 手动复跑命令：`gh run rerun <run-id> -R <owner>/<repo>`。

> 本文件不含 token、Cookie 或个人信息。
