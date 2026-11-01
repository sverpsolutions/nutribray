# Deploy GEOM Retail to the Hostinger VPS

Server: `srv2064696.hstgr.cloud` · `72.60.236.218` (Ubuntu + Docker)
Stack: `db` PostgreSQL 16 (private) · `api` FastAPI · `web` Caddy (frontend + HTTPS + proxy `/api`, `/uploads`)

## 1. One-time server setup
```bash
ssh root@72.60.236.218
apt update && apt -y upgrade
docker --version || curl -fsSL https://get.docker.com | sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
git clone https://github.com/sverpsolutions/geom365.git /opt/geom
cd /opt/geom/deploy && cp .env.example .env && nano .env   # set DB_PASSWORD, SECRET_KEY, DOMAIN
```
Generate secrets: `openssl rand -hex 32`

## 2. DNS
Add an **A record** `geom365` → `72.60.236.218` for `sverpsolutions.com`. Until it resolves, use `SITE_ADDRESS=:80` and open `http://72.60.236.218`.

## 3. Start
```bash
cd /opt/geom/deploy
docker compose up -d --build
docker compose ps && docker compose logs -f api
```

## 4. Load the data
```bash
# from your PC: copy the dump
scp modernbazaar.dump root@72.60.236.218:/opt/geom/deploy/backups/
# on the server
docker compose exec db pg_restore -U geom -d modernbazaar --no-owner --no-privileges --clean --if-exists /backups/modernbazaar.dump
docker compose restart api
```

## 5. Update to a new version
```bash
cd /opt/geom && git pull && cd deploy && docker compose up -d --build
```

## 6. Daily backup (cron on the server)
```bash
0 2 * * * cd /opt/geom/deploy && docker compose exec -T db pg_dump -U geom -Fc modernbazaar > backups/geom_$(date +\%F).dump && find backups -name 'geom_*.dump' -mtime +14 -delete
```
