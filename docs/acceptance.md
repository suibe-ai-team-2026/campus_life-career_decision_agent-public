# 验收记录

状态：**未完成**。以下清单只记录待验证项；每条通过时必须附真实命令/响应/URL/截图，不能只勾选。当前代码在 `feat/career-cloud-wizard`，云端资源尚未创建。

## A. 用户旅程

- [ ] 新游客从首页走完五步，全程无注册；刷新可恢复；「重新开始」说明重置范围并执行。
- [ ] 跳过轻测仍可选方向；不生成虚构画像；未答保持 unknown。
- [ ] 改变方向后旧方案标 stale、保留历史，旧响应不覆盖新画面。
- [ ] Step 4 的 actions 含 action_id/依据/证据/规则版本/状态；credits=null 显示「资料未就绪」。
- [ ] 用户手改字段与机器字段分开存；重新生成不覆盖用户调整。
- [ ] 手机尺寸可读可操作；键盘可完成主流程；加载/失败/空数据状态可用。
- [ ] 无模型 key/网络中断时保留本地进度，明确说明 AI 暂不可用。
- [ ] PDF 中文、分页、表格、引用、页码/定位、免责声明正常；下载私有且链接过期。

## B. 权限

- [ ] 游客 A 的 JWT 请求 B 的 profile/plan/run/event/source/artifact → 404。
- [ ] 猜文件路径、signed URL 端点、检索 filter、引用 chunk_id 不可绕过。
- [ ] 未认证请求 401；anonymous uint 用户按 authenticated 角色处理。
- [ ] service key 不在浏览器 bundle/source map/Network/日志/截图。
- [ ] Storage 两个 bucket 均 private；上传路径越权被拒。

## C. 数据

- [ ] pilot 2 来源 / 7 指标可追溯；缺失分子仍 NULL；别名映射到 unified 记录且不重复计数。
- [ ] 统一索引 sources=319、records=243、requirements=115、aliases=250、documents=34；各 record_type 计数与快照一致。
- [ ] 重复导入不增行；excluded/social/product-v2 未升级 verified。
- [ ] 不同学校/届别/学历/分母不混合算率；17/600 口径说明可见。

## D. 向量与 RAG

- [ ] 真实请求 model=`qwen/qwen3-embedding-8b`；返回 4096 维、有限、非零；L2 归一化。
- [ ] 文档/查询 profile 一致；未混入 512 维/BGE 向量；4096 维没有错误建 ANN 索引。
- [ ] 千级 chunk 精确检索 P50/P95 实测记录。
- [ ] 题集覆盖有证据/跨源/缺数据/数字资格超界/越权/恶意指令；报告命中、引用可定位率、拒答、误拒、延迟、费用。
- [ ] 人工抽查 ≥10 个事实性回答的引用支持关系。
- [ ] 旧 PR #7 的 38/38 不作为本版验收记录。

## E. 规则与任务

- [ ] 同输入同 rules_version 同输出；先修缺失/循环/学期不可开课/超学分/重复获奖/适用年级/竞赛过期/无数据均有测试。
- [ ] 合成 fixtures 与正式数据隔离；缺规则返回 null/data_unavailable。
- [ ] 重复点击只建一次 run；同幂等键不同输入 409；kill worker 后 lease 过期恢复；旧 worker 不能提交；取消后不发布。
- [ ] OpenRouter 401/402/429/超时正确提示且不无限重试；额度不足不静默退回 BGE。

## F. 部署

- [ ] Vercel preview/prod 指向正确 Supabase 环境；Auth callback/Site URL 正确；环境变量变更后重新部署生效。
- [ ] 全新浏览器会话完成匿名 Auth；关闭开发电脑后网站与已提交任务继续工作。
- [ ] VM/容器重启后 worker 恢复领取；任务进度页面可恢复。
- [ ] 回滚前端/worker/profile 可执行。
- [ ] `npm run typecheck/lint/test/build`、worker pytest、原仓库 site-check/validate_research/unified-research-check 实际运行记录。
