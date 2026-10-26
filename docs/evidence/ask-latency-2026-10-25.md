# 资料问答慢 / 不出结果的定位与修复（2026-10-25）

状态：**已修复并实测**。用户反馈「知识库问答好几次没有成功、完整规划也很慢，
但方案 PDF 能生成」。实测从提交到答案 4–7 分钟，失败时前端停在排队/检索。

## 1. 现象与证据

- 线上 `app_runs`：ask 的 `queue_s` 45–346 秒、`run_s` 185–418 秒；
  export 只在首次慢（196 秒），后续 4–7 秒；plan 46 秒。
- worker 日志：`job_claimed` 与 `retrieval_done` 之间 3–6 分钟；
  `claim_failed`、`heartbeat_failed`、`usage_record_failed` 的 `error_code` 均为
  `DatabaseError`。
- 容器内 Python `getaddrinfo` 间歇报
  `socket.gaierror: [Errno -3] Temporary failure in name resolution`；
  同一时刻宿主 `dig @127.0.0.53` 正常（48–152ms）。

## 2. 根因（三层叠加）

1. **VM DNS**：Freestyle VM 的 `/etc/resolv.conf` 把 IPv6 DNS（Cloudflare/Google）
   排在前面，而该 VM 出站 **UDP/53 被阻断**。冷查询要 5–17 秒，并会间歇性解析失败。
   Docker 内嵌 DNS 又把这层故障放大：Supabase / DeepSeek / OpenRouter 的每次冷解析
   都可能卡住或报错，worker 的 claim、心跳、检索、usage 写入随机失败。
   `systemd-resolved` 日志还反复出现 `Clock change detected. Flushing caches.`，
   进一步让 DNS 缓存长期处于冷状态。
2. **空闲暂停太激进**：线上 `WORKER_IDLE_PAUSE_SECONDS=60`，几乎每次问答都要先
   `/start` 唤醒 VM（30–90 秒），而旧 BFF 还要 `exec-await` 重启容器，
   该调用经常在 VM 启动中超时，run 只能排队。
3. **重试放大延迟**：`MODEL_MAX_RETRIES=3` × 60 秒超时，单次模型调用最坏 4 分钟，
   ask 还有校验重试，容易超过前端 8 分钟等待上限。
4. **IPv6 出口不稳定**：VM 是 dual-stack，DNS 默认返回 IPv6 在前。实测
   `curl -6 openrouter.ai` 7.6 秒（IPv4 2.0 秒），`curl -6 api.deepseek.com`
   直接失败；worker 的 httpx 先试 IPv6，connect timeout 15 秒后才回退，
   embedding/chat 因此出现 15–60 秒超时并触发整任务重试。

## 3. 修复

VM（已生效）：

- 用 DoT 替代被阻断的 UDP/53：`worker/scripts/fix-vm-dns.sh` 停用
  `60-freestyle-vms.conf`，写入 `70-dot.conf`（1.1.1.1 / 8.8.8.8 DoT），
  `/etc/resolv.conf` 指向 `127.0.0.53`。
- 容器改为 `network_mode: host`，直接用宿主 systemd-resolved，避开 Docker
  内嵌 DNS 的转发故障（worker 无入站端口，不增加暴露面）。
- `/etc/campus-pathway/worker.env`：`WORKER_IDLE_PAUSE_SECONDS=1800`、
  `MODEL_MAX_RETRIES=1`，并重建容器。
- 用 `/etc/hosts` 把 `supabase.co / openrouter.ai / api.deepseek.com` 固定到
  IPv4 A 记录（`worker/scripts/pin-vm-ipv4.sh`），并用 systemd timer 每 30 分钟
  重新解析、自动更新，避免 IP 轮换后失效；`/etc/gai.conf` 的 precedence 在本机
  未生效，所以最终用 hosts 固定。
- 验证：容器内反复解析稳定在 167–796ms（此前 5–17s 或失败），且只返回 IPv4；
  改完网络配置后需要 `docker restart campus-pathway-worker`，否则旧进程仍持有
  失效连接（实测重启后同类 ask 从超时变成 28.6 秒）。

代码（本仓库）：

- `worker/app/runtime/worker.py`：启动时预热 Supabase/OpenRouter/DeepSeek 的 DNS；
  claim 失败退避上限 60s → 15s；`idle_pause` 默认 1800s。
- `worker/docker-compose.yml` + `worker/scripts/fix-vm-dns.sh`：固化上述 VM 配置。
- BFF：`wakeWorker` 不再等待 `exec-await` 重启容器（run 先入库，VM 恢复后会先
  claim 队列）；`/api/health` 返回真实 VM 状态与队列深度，不再硬编码
  `queue_polling`；新增 `POST /api/runs/:id/wake`。
- 前端：polling 对排队超过 20 秒的 run 每 30 秒重试唤醒；资料库问答在排队时显示
  「云端 worker 正在唤醒（首次约 30–90 秒）」。
- `worker/worker.env.example` 与 README/deployment 文档同步默认值与 DNS 步骤。

## 4. 实测结果

| 场景 | 修复前 | 修复后 |
|---|---|---|
| ask 检索阶段 | 3–6 分钟 | 约 23 秒 |
| ask 端到端（worker 已运行） | 185–418 秒，且常失败 | **39 秒** |
| ask 端到端（VM 已 pause，含唤醒） | 5–7 分钟 | **48 秒**（21 秒排队→唤醒提示→检索→生成） |
| 容器 DNS | 5–17 秒 / 间歇失败 | 0.17–0.8 秒 |
| 生产站 https://zhitu.quest 单次 ask | 4–7 分钟或失败 | 48 秒（修复后首测）、28.6 秒（重启 worker 后） |

复跑命令：`npm run check`、`cd worker && .venv/bin/python -m pytest -q`（137 passed）、
`curl -s localhost:3000/api/health`。证据不含密钥、Cookie 或学生个人信息。
