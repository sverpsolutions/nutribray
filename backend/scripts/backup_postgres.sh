#!/bin/bash
# ==============================================================================
# GEOM365 - Automated PostgreSQL Cloud Backup Script for Hostinger VPS
# ==============================================================================
# Schedule via crontab:
# 0 2 * * * /opt/geom365/scripts/backup_postgres.sh >> /var/log/geom365_backup.log 2>&1
# ==============================================================================

set -e

# Configuration
DB_NAME="${DB_NAME:-geom365_db}"
DB_USER="${DB_USER:-postgres}"
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/geom365}"
RETENTION_DAYS=30

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/geom365_backup_${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting GEOM365 database backup for ${DB_NAME}..."

# Export compressed custom format dump
pg_dump -h "${DB_HOST}" -p "${DB_PORT}" -U "${DB_USER}" -F c -b -v -f "${BACKUP_FILE}" "${DB_NAME}"

BACKUP_SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "[$(date)] Backup completed successfully: ${BACKUP_FILE} (Size: ${BACKUP_SIZE})"

# Delete backups older than retention period
echo "[$(date)] Cleaning up backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -type f -name "geom365_backup_*.dump" -mtime +${RETENTION_DAYS} -delete

echo "[$(date)] Backup job finished."
