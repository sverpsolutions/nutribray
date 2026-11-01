"""Telegram Business Assistant: settings, linked accounts, one-time link codes, message log (update de-dup), alert delivery history.

Additive only. The bot token lives in the server .env (TELEGRAM_BOT_TOKEN), never in the database.

Revision ID: m7a9c1e3f5b8
Revises: l6f8b0d2e4a7
Create Date: 2026-10-29 14:00:00

"""
from typing import Sequence, Union
from alembic import op


revision: str = 'm7a9c1e3f5b8'
down_revision: Union[str, None] = 'l6f8b0d2e4a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS telegram_settings (
        id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        bot_username VARCHAR(100),
        alerts JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_ok_at TIMESTAMP,
        last_error TEXT,
        last_error_at TIMESTAMP,
        updated_by INT REFERENCES users(id),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW())""",
    "INSERT INTO telegram_settings (id) VALUES (1) ON CONFLICT DO NOTHING",
    """CREATE TABLE IF NOT EXISTS telegram_accounts (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id),
        chat_id BIGINT NOT NULL UNIQUE,
        tg_username VARCHAR(100),
        tg_name VARCHAR(200),
        status VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','REVOKED')),
        allow_financial BOOLEAN NOT NULL DEFAULT FALSE,
        blocked_reports TEXT[] NOT NULL DEFAULT '{}',
        alerts TEXT[] NOT NULL DEFAULT '{}',
        linked_at TIMESTAMP NOT NULL DEFAULT NOW(),
        linked_by INT REFERENCES users(id),
        revoked_at TIMESTAMP,
        revoked_by INT REFERENCES users(id),
        last_seen_at TIMESTAMP)""",
    "CREATE INDEX IF NOT EXISTS ix_telegram_accounts_user ON telegram_accounts (user_id)",
    """CREATE TABLE IF NOT EXISTS telegram_link_codes (
        id SERIAL PRIMARY KEY,
        code_hash VARCHAR(64) NOT NULL UNIQUE,
        user_id INT NOT NULL REFERENCES users(id),
        allow_financial BOOLEAN NOT NULL DEFAULT FALSE,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        used_chat_id BIGINT)""",
    """CREATE TABLE IF NOT EXISTS telegram_logs (
        id BIGSERIAL PRIMARY KEY,
        update_id BIGINT UNIQUE,
        at TIMESTAMP NOT NULL DEFAULT NOW(),
        chat_id BIGINT,
        account_id INT REFERENCES telegram_accounts(id),
        user_id INT REFERENCES users(id),
        request VARCHAR(200),
        report VARCHAR(40),
        status VARCHAR(20) NOT NULL DEFAULT 'received',
        ms INT,
        error VARCHAR(300))""",
    "CREATE INDEX IF NOT EXISTS ix_telegram_logs_at ON telegram_logs (at DESC)",
    """CREATE TABLE IF NOT EXISTS telegram_alerts_sent (
        id BIGSERIAL PRIMARY KEY,
        account_id INT NOT NULL REFERENCES telegram_accounts(id),
        alert VARCHAR(40) NOT NULL,
        period VARCHAR(40) NOT NULL,
        sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
        status VARCHAR(10) NOT NULL DEFAULT 'sent',
        error VARCHAR(300),
        UNIQUE (account_id, alert, period))""",
]


def upgrade() -> None:
    for s in STATEMENTS:
        op.execute(s)


def downgrade() -> None:
    pass
