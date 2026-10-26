#!/usr/bin/env bash
# 让 worker 依赖的关键域名只解析到 IPv4，并定期刷新。
#
# 背景（2026-10-25 实测）：Freestyle VM 是 dual-stack，DNS 默认返回 IPv6 在前；
# 但该 VM 的 IPv6 出口不稳定（OpenRouter 7.6s，DeepSeek 直接连不上），
# Python/httpx 会先试 IPv6 再回退，表现为 embedding/chat 的 15–60 秒超时。
# /etc/gai.conf 的 precedence 在本机未生效，最终用 /etc/hosts 固定 A 记录。
#
# 用法：sudo bash worker/scripts/pin-vm-ipv4.sh [--install-timer]
set -euo pipefail

HOSTS=(cvohcdzfscoxytmpbwsk.supabase.co openrouter.ai api.deepseek.com)
BEGIN_MARK="# >>> campus-pathway pinned ipv4 >>>"
END_MARK="# <<< campus-pathway pinned ipv4 <<<"
TARGET_HOSTS=/etc/hosts

if [[ "${EUID}" -ne 0 ]]; then
  echo "请用 root/sudo 运行" >&2
  exit 1
fi

tmp=$(mktemp)
# 保留旧文件（去掉本脚本维护的块）
awk -v b="${BEGIN_MARK}" -v e="${END_MARK}" '
  $0 == b { skip = 1; next }
  $0 == e { skip = 0; next }
  !skip { print }
' "${TARGET_HOSTS}" > "${tmp}"

{
  echo "${BEGIN_MARK}"
  for host in "${HOSTS[@]}"; do
    ip=$(dig +short +time=4 +tries=2 A "${host}" @127.0.0.53 | tail -1)
    if [[ -n "${ip}" ]]; then
      echo "${ip} ${host}"
    else
      echo "# WARN: ${host} 解析失败，保留既有多解析结果" >&2
    fi
  done
  echo "${END_MARK}"
} >> "${tmp}"

install -m 644 "${tmp}" "${TARGET_HOSTS}"
rm -f "${tmp}"
grep -A4 "campus-pathway pinned" "${TARGET_HOSTS}"

if [[ "${1:-}" == "--install-timer" ]]; then
  cat > /etc/systemd/system/campus-pathway-pin-hosts.service <<'UNIT'
[Unit]
Description=Refresh campus-pathway pinned IPv4 hosts
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/pin-vm-ipv4.sh
UNIT
  cat > /etc/systemd/system/campus-pathway-pin-hosts.timer <<'UNIT'
[Unit]
Description=Refresh campus-pathway pinned IPv4 hosts every 30 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload
  systemctl enable --now campus-pathway-pin-hosts.timer
  echo "systemd timer 已安装（每 30 分钟刷新）"
fi
