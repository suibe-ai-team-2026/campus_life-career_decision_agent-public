# 团队基础设施与资源归属

更新：2026-10-19。只登记资源与权限，不记录密钥、卡号或恢复码。正式比赛资源归比赛专用组织/团队；成员各自账号接受邀请，不共享登录。

## 1. 资源登记

| 平台 | 资源 | 标识 | 用途/环境 | Owner | 管理员/邀请状态 | 套餐/费用 | 赛后维护 |
|---|---|---|---|---|---|---|---|
| GitHub | Organization | `suibe-ai-team-2026` | 三个私有仓库 | @turtojian520 | 成员 @Jade-soleil、@cactusye79（Write） | 免费 | 团队 |
| GitHub | 产品仓库 | `suibe-ai-team-2026/campus_life-career_decision_agent` | 比赛主项目 | @turtojian520 | PR 分支 `feat/career-cloud-wizard` | 免费 | 团队 |
| Supabase | Organization | `suibeAIproductcompe`（ID `lvzbgmhzlqcklcqsfwna`） | 比赛专用 | @turtojian520 | 当前单人账号资产 | Free | 待团队约定 |
| Supabase | 项目 | `campus_life-career_decision_agent`（ref `cvohcdzfscoxytmpbwsk`） | dev/demo；Free，us-east-2 | @turtojian520 | Owner；成员未邀请 | Free | 待团队约定 |
| Vercel | Team | 个人 Hobby `turtojian520s-projects` | 公开副本可免费部署；非比赛专用 Team | @turtojian520 | 单人 | Hobby（免费） | 待团队约定 |
| Vercel | 项目 | `campus_life-career_decision_agent` | 公开 Production：https://campuslife-careerdecisionagent.vercel.app ；另有受保护 Preview | @turtojian520 | 单人；未连接 Git（GitHub App org 安装需 sudo/2FA） | Hobby | 待团队约定 |
| Freestyle | Team | 个人账号（API key 绑定个人团队） | worker 执行面（demo） | @turtojian520 | 单人 | 按实际用量 | 待团队约定 |
| Freestyle | VM | `campus-pathway-worker-dev`（`vm-7f674dd9ed5d422b880f5bec7fe9f734`） | 单 worker 演示；空闲 60s 自动 pause，pause 只计存储；BFF 点生成时 start | @turtojian520 | 单人 | 按实际用量（暂停时仅存储） | 待团队约定 |
| OpenRouter | API Key | 用户受保护文件 | 仅 embedding `qwen/qwen3-embedding-8b` | 用户 | 仅 worker secret | 按用量；用户预算 | 用户 |
| DeepSeek 官方 | API Key | 用户受保护文件 | chat `deepseek-flash`（V4.1-Flash，low effort） | 用户 | 仅 worker secret | 按官方用量；用户预算 | 用户 |

## 2. 角色分工（建议，待用户确认）

- 资源 Owner：秦翰 @turtojian520（Supabase Org Owner / Vercel Team Owner / Freestyle 负责人）。
- 数据/代码开发：按需 Developer；需要改项目设置再给 Administrator。Developer 仍可接触项目内容与敏感资源，不是受限只读角色。
- 账单/预算负责人：用户指定；每次新增付费资源前记录套餐、单价、席位、预算、付款/报销方式。
- 生产迁移、密钥轮换、环境变量、域名变更必须有可追溯记录（日期、操作人、影响、回滚）。

## 3. 变更流程

1. 新增/删除资源：在本文档登记，说明用途、环境、Owner、费用。
2. 权限变更：平台内操作后更新邀请状态；人员退出时撤销成员权限与专用令牌，并评估轮换共享密钥。
3. 环境变量：只写变量名和用途；值通过平台 secret 或受保护文件注入。
4. 不因比赛结束自动删除数据库或停止付费资源；下线/移交按届时明确授权执行。

## 4. 赛后约定（待团队确认）

继续维护还是下线、费用承担、数据保留与删除期限、域名与账单接收人、资源/账号移交、代码与合规数据备份。个人实验数据未经审核不合入正式比赛库；正式学生数据不复制到个人试验环境。
