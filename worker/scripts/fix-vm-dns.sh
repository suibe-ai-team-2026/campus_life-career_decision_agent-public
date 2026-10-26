#!/usr/bin/env bash
# Freestyle VM DNS 修复：只用 DNS-over-TLS，并让 Docker 容器走宿主的 systemd-resolved。
#
# 背景（2026-10-25 实测）：
# - Freestyle VM 的 /etc/resolv.conf 把 IPv6 DNS（Cloudflare/Google）排在前面；
# - 该 VM 出站 UDP/53 被阻断，DNS 查询要先等 IPv6/UDP 超时才回退，冷查询 5–17 秒，
#   甚至间歇性 "Temporary failure in name resolution"；
# - worker 因此出现 claim_failed / heartbeat_failed / usage_record_failed，
#   一次 ask 检索卡 4–6 分钟，用户侧表现为“问答不出结果”。
# - 出站 TCP/853（DoT）可用，Docker 容器可以通过宿主 127.0.0.53 走 DoT。
#
# 执行后：宿主和容器解析通常 <1 秒；配合 WORKER_IDLE_PAUSE_SECONDS>=1800，
# 问答冷启动从数分钟降到数十秒。
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "请用 root/sudo 运行：sudo bash worker/scripts/fix-vm-dns.sh" >&2
  exit 1
fi

cp -n /etc/resolv.conf /etc/resolv.conf.freestyle.bak 2>/dev/null || true
mkdir -p /etc/systemd/resolved.conf.d
mv /etc/systemd/resolved.conf.d/60-freestyle-vms.conf /etc/systemd/resolved.conf.d/60-freestyle-vms.conf.disabled 2>/dev/null || true

cat > /etc/systemd/resolved.conf.d/70-dot.conf <<'CONF'
[Resolve]
DNS=1.1.1.1#cloudflare-dns.com 8.8.8.8#dns.google
FallbackDNS=1.0.0.1#cloudflare-dns.com 9.9.9.9#dns.quad9.net
DNSOverTLS=yes
DNSSEC=no
CONF

printf 'nameserver 127.0.0.53\noptions edns0 trust-ad\n' > /etc/resolv.conf
systemctl restart systemd-resolved
sleep 2
resolvectl flush-caches

echo "--- resolved status ---"
resolvectl status | sed -n '1,10p'
echo "--- 解析耗时（应 < 1s）---"
for host in example.com api.deepseek.com openrouter.ai; do
  start=$(date +%s%N)
  addr=$(getent hosts "${host}" | head -1 || true)
  end=$(date +%s%N)
  echo "${host} $(( (end - start) / 1000000 ))ms ${addr}"
done

echo "--- 重建容器以刷新 /etc/resolv.conf ---"
cd /opt/campus-pathway/build-worker
docker compose up -d --force-recreate
sleep 5
docker exec campus-pathway-worker cat /etc/resolv.conf | sed -n '1,12p'
