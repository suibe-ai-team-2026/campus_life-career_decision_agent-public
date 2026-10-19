# 验收记录

状态：**部分完成**。已执行项附 `docs/evidence/` 证据；未执行项保持未勾选。当前代码在 `feat/career-cloud-wizard`，Supabase/worker/Vercel Preview 已上线，生产域名未主动部署。

## A. 用户旅程

- [x] 新游客从首页走完五步，全程无注册；刷新可恢复；「重新开始」说明重置范围并执行（本地浏览器实测；云端 plan 见 `cloud-e2e.json`）。
- [x] 跳过轻测仍可选方向；不生成虚构画像；未答保持 unknown（本地 E2E + scoring 单测）。
- [x] 改变方向后旧方案标 stale、保留历史（前端本地实测；服务端版本由 `worker_save_plan` 生成新版本）。
- [x] Step 4 的 actions 含 action_id/依据/证据/规则版本/状态；credits=null 显示「资料未就绪」（`cloud-e2e.json` plan 结果）。
- [x] 用户手改字段与机器字段分开存；PATCH 带 expected_version，冲突 409（代码 + 本地流程验证；未做并发人工测试）。
- [x] 390px 移动端 7 页无横向溢出；键盘/加载/失败/空态由前端 E2E 自查（见 web-dev 报告）。
- [x] 本地演示模式保留进度并禁用云端生成；已实测。
- [x] PDF 已生成并下载（9049 bytes，sha256 记录）；中文排版/分页需人工打开抽检；链接 60 秒过期。

## B. 权限

- [x] A 的 profile/run 被 B 读取 → 404（`cloud-e2e.json`）；plan/event/source/artifact 同类 RLS 待补测。
- [ ] 猜文件路径、signed URL 端点、检索 filter、引用 chunk_id 不可绕过。
- [x] 未认证与 anonymous 用户分离；anonymous Auth 已启用，RLS 将其视为 authenticated。
- [x] 仓库 secret 扫描无命中；service key 只在 server/worker env；未在源码出现。
- [x] 两个 bucket private（`database-state.json`）；上传越权策略待端到端上传测试。

## C. 数据

- [x] pilot 2+7 映射到 unified，不重复计数（`database-state.json` import batch）。
- [x] 319/243/115/250/34 与 7 类 record_type 计数一致（`database-state.json`）。
- [x] 导入脚本设计为 upsert；本次仅执行一次，重复 apply 幂等性待复跑确认。excluded/social/product-v2 未升级。
- [ ] 不同学校/届别/学历/分母不混合算率；17/600 口径说明可见。

## D. 向量与 RAG

- [x] 真实探针：4096 维、有限、非零、norm=1（`model-probe.json`）。
- [x] 只有一个 active profile（4096 维）；未创建 ANN 索引；未混入 BGE。
- [ ] 未记录 P50/P95；单次 plan 检索 12 段、ask 1 段。
- [ ] 仅做了 1 条有证据问题与 1 条跨届别缺口问题；完整题集与指标未跑。
- [ ] 未做 10 条人工抽查。
- [ ] 旧 PR #7 的 38/38 不作为本版验收记录。

## E. 规则与任务

- [x] 规则引擎单测覆盖缺数据/credits=null/确定性；课程/竞赛真实数据缺失，返回 `data_unavailable`。
- [ ] 合成 fixtures 与正式数据隔离；缺规则返回 null/data_unavailable。
- [x] 幂等 202/409、取消、旧 worker fencing 已实现并实测部分（`cloud-e2e.json`）；kill worker 恢复待演练。
- [ ] OpenRouter 401/402/429/超时正确提示且不无限重试；额度不足不静默退回 BGE。

## F. 部署

- [x] Preview 已指向正确项目；`/api/health` 返回 351 sources/764 chunks；production 未主动部署。
- [x] 匿名 Auth 在云端 Preview/BFF 实测；关闭开发电脑后 worker 仍可运行（已由 VM 承担）。
- [ ] 未做 VM 重启演练。
- [ ] 回滚未演练；文档已写步骤。
- [ ] `npm run typecheck/lint/test/build`、worker pytest、原仓库 site-check/validate_research/unified-research-check 实际运行记录。
