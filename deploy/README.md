# Deploy Nutribay Manufacturing ERP

Stack: `db` PostgreSQL 16 (private) · `api` FastAPI · `web` Caddy (frontend + proxy `/api`, `/uploads`).
Standalone project (compose name `nutribay`, database `nutribay_erp`, user `nutribay`) — shares nothing with any other app.

## 1. Server setup
```bash
docker --version || curl -fsSL https://get.docker.com | sh
git clone https://github.com/sverpsolutions/nutribray.git /opt/nutribay
cd /opt/nutribay/deploy && cp .env.example .env && nano .env   # DOMAIN, DB_PASSWORD, SECRET_KEY
```
Secrets: `openssl rand -hex 32`. Point the domain's A record to the server IP.

## 2. Start
```bash
cd /opt/nutribay/deploy && docker compose up -d --build
docker compose ps && docker compose logs -f api
```

## 3. Import the database backup
Backups are NOT in git. Copy `nutribay_erp.dump` (from `deploy/backups/` on the PC) to the server's `deploy/backups/`:
```bash
scp nutribay_erp.dump root@SERVER:/opt/nutribay/deploy/backups/
docker compose exec db pg_restore -U nutribay -d nutribay_erp --no-owner --no-privileges --clean --if-exists /backups/nutribay_erp.dump
docker compose restart api
```
Plain-SQL alternative (`nutribay_erp.sql`): `docker compose exec -T db psql -U nutribay -d nutribay_erp < backups/nutribay_erp.sql`

Without Docker (own PostgreSQL): `createdb nutribay_erp`, then `pg_restore -d nutribay_erp --no-owner nutribay_erp.dump` (or `psql -d nutribay_erp -f nutribay_erp.sql`), and set `database_url` in `backend/.env`.

## 4. Update
```bash
cd /opt/nutribay && git pull && cd deploy && docker compose up -d --build
```

## 5. Daily backup (cron)
```bash
0 2 * * * cd /opt/nutribay/deploy && docker compose exec -T db pg_dump -U nutribay -Fc nutribay_erp > backups/nutribay_$(date +\%F).dump && find backups -name 'nutribay_*.dump' -mtime +14 -delete
```
