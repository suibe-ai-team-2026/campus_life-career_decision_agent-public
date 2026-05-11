# Genote Cloud Deployment

This guide prepares a small cloud VM for a Genote preview deployment.

## Minimum VM

- Preview: 4 vCPU, 8 GB RAM, 100 GB SSD
- Beta: 8 vCPU, 16 GB RAM, 200+ GB SSD plus object storage
- OS: Ubuntu 22.04 or 24.04 LTS
- Public ports: 80 and 443 for HTTPS, or 8502 for a private preview
- Keep SurrealDB private. The compose file does not expose port 8000.

## First Deploy

```bash
git clone --single-branch --branch open-notebook-genote https://github.com/turtojian520/genote.git genote-open-notebook
cd genote-open-notebook

cp .env.example .env
openssl rand -hex 32
openssl rand -base64 24
openssl rand -base64 32
```

Edit `.env`:

- `OPEN_NOTEBOOK_ENCRYPTION_KEY`: output from `openssl rand -hex 32`
- `OPEN_NOTEBOOK_PASSWORD`: output from `openssl rand -base64 24`
- `SURREAL_PASSWORD`: output from `openssl rand -base64 32`
- `CORS_ORIGINS`: your final HTTPS origin, for example `https://genote.example.com`
- `WEB_PORT`: keep `8502` unless a reverse proxy maps to another local port

Start:

```bash
docker compose build open_notebook
docker compose up -d
docker compose ps
./scripts/cloud-smoke-test.sh http://127.0.0.1:8502
```

Open `http://SERVER_IP:8502` for a private preview, or put HTTPS in front before sharing.

## HTTPS Reverse Proxy

Recommended Caddy example:

```caddyfile
genote.example.com {
  encode zstd gzip
  reverse_proxy 127.0.0.1:8502
}
```

When using a reverse proxy:

- expose only ports 80 and 443 in the cloud firewall
- keep Docker's API port bound to `127.0.0.1`
- leave `API_URL=` empty so the frontend uses same-origin `/api/*`
- set `CORS_ORIGINS=https://genote.example.com`

## Data And Backups

Persistent data lives in:

- `surreal_data/`: SurrealDB database
- `notebook_data/`: uploads, checkpoints, and app data

Simple cold backup:

```bash
docker compose down
tar -czf genote-backup-$(date +%Y%m%d-%H%M%S).tgz surreal_data notebook_data .env
docker compose up -d
```

For production, ship backups to object storage and test restore on a separate VM.

## Health Checks

```bash
docker compose ps
curl -fsS http://127.0.0.1:8502 >/dev/null
curl -fsS http://127.0.0.1:5055/health
```

The frontend proxies browser API calls through `/api/*`, so users do not need direct access to port `5055`.

## Known Preview Limits

- The Genote dashboard and flashcard review UI still use some mock data.
- Large file processing runs in the same deployment and can consume CPU/RAM.
- Uploaded files are stored on the VM filesystem; use external object storage before public launch.
- Add monitoring and automated backups before inviting real users.
