"""add sync tables

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = None   # set to previous revision id if chaining
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── unit_wise_purchases ───────────────────────────────────────────────────
    op.create_table(
        "unit_wise_purchases",
        sa.Column("id",           sa.Integer, primary_key=True),
        sa.Column("purchase_no",  sa.String(50), nullable=False),
        sa.Column("outlet_id",    sa.Integer, nullable=False),
        sa.Column("supplier_id",  sa.Integer, server_default="1"),
        sa.Column("invoice_no",   sa.String(50)),
        sa.Column("invoice_date", sa.Date),
        sa.Column("total_qty",    sa.Numeric(12, 3), server_default="0"),
        sa.Column("total_amount", sa.Numeric(12, 2), server_default="0"),
        sa.Column("status",       sa.String(20),     server_default="received"),
        sa.Column("created_by",   sa.Integer),
        sa.Column("created_at",   sa.DateTime,       server_default=sa.text("now()")),
    )

    # ── unit_wise_purchase_items ──────────────────────────────────────────────
    op.create_table(
        "unit_wise_purchase_items",
        sa.Column("id",               sa.Integer, primary_key=True),
        sa.Column("purchase_id",      sa.Integer, sa.ForeignKey("unit_wise_purchases.id"), nullable=False),
        sa.Column("product_id",       sa.Integer, nullable=False),
        sa.Column("qty",              sa.Numeric(12, 3), server_default="0"),
        sa.Column("unit",             sa.String(10),     server_default="PCS"),
        sa.Column("price",            sa.Numeric(10, 2), server_default="0"),
        sa.Column("basic_amount",     sa.Numeric(12, 2), server_default="0"),
        sa.Column("discount_percent", sa.Numeric(5,  2), server_default="0"),
        sa.Column("discount_amount",  sa.Numeric(12, 2), server_default="0"),
        sa.Column("taxable_amount",   sa.Numeric(12, 2), server_default="0"),
        sa.Column("gst_percent",      sa.Numeric(5,  2), server_default="0"),
        sa.Column("gst_amount",       sa.Numeric(12, 2), server_default="0"),
        sa.Column("total",            sa.Numeric(12, 2), server_default="0"),
    )

    # ── unit_wise_purchase_returns ────────────────────────────────────────────
    op.create_table(
        "unit_wise_purchase_returns",
        sa.Column("id",           sa.Integer, primary_key=True),
        sa.Column("prn_no",       sa.String(50), nullable=False),
        sa.Column("outlet_id",    sa.Integer, nullable=False),
        sa.Column("supplier_id",  sa.Integer, server_default="1"),
        sa.Column("return_date",  sa.Date),
        sa.Column("total_qty",    sa.Numeric(12, 3), server_default="0"),
        sa.Column("total_amount", sa.Numeric(12, 2), server_default="0"),
        sa.Column("reason",       sa.Text),
        sa.Column("created_by",   sa.Integer),
        sa.Column("created_at",   sa.DateTime, server_default=sa.text("now()")),
    )

    # ── unit_wise_purchase_return_items ───────────────────────────────────────
    op.create_table(
        "unit_wise_purchase_return_items",
        sa.Column("id",           sa.Integer, primary_key=True),
        sa.Column("prn_id",       sa.Integer, sa.ForeignKey("unit_wise_purchase_returns.id"), nullable=False),
        sa.Column("product_id",   sa.Integer, nullable=False),
        sa.Column("qty",          sa.Numeric(12, 3), server_default="0"),
        sa.Column("unit",         sa.String(10),     server_default="PCS"),
        sa.Column("price",        sa.Numeric(10, 2), server_default="0"),
        sa.Column("basic_amount", sa.Numeric(12, 2), server_default="0"),
        sa.Column("gst_percent",  sa.Numeric(5,  2), server_default="0"),
        sa.Column("gst_amount",   sa.Numeric(12, 2), server_default="0"),
        sa.Column("total",        sa.Numeric(12, 2), server_default="0"),
    )

    # ── unit_wise_stock_transfers ─────────────────────────────────────────────
    op.create_table(
        "unit_wise_stock_transfers",
        sa.Column("id",             sa.Integer, primary_key=True),
        sa.Column("transfer_no",    sa.String(50), nullable=False),
        sa.Column("from_outlet_id", sa.Integer, server_default="1"),
        sa.Column("to_outlet_id",   sa.Integer, server_default="1"),
        sa.Column("transfer_date",  sa.Date),
        sa.Column("type",           sa.String(10),  server_default="OUT"),
        sa.Column("status",         sa.String(20),  server_default="completed"),
        sa.Column("remarks",        sa.Text),
        sa.Column("created_by",     sa.Integer),
        sa.Column("created_at",     sa.DateTime, server_default=sa.text("now()")),
    )

    # ── unit_wise_stock_transfer_items ────────────────────────────────────────
    op.create_table(
        "unit_wise_stock_transfer_items",
        sa.Column("id",          sa.Integer, primary_key=True),
        sa.Column("transfer_id", sa.Integer, sa.ForeignKey("unit_wise_stock_transfers.id"), nullable=False),
        sa.Column("product_id",  sa.Integer, nullable=False),
        sa.Column("qty",         sa.Numeric(12, 3), server_default="0"),
        sa.Column("unit",        sa.String(10),     server_default="PCS"),
        sa.Column("cost_price",  sa.Numeric(10, 2), server_default="0"),
        sa.Column("mrp",         sa.Numeric(10, 2), server_default="0"),
        sa.Column("total_val",   sa.Numeric(12, 2), server_default="0"),
    )

    # ── outlet_stock ──────────────────────────────────────────────────────────
    op.create_table(
        "outlet_stock",
        sa.Column("id",            sa.Integer, primary_key=True),
        sa.Column("outlet_id",     sa.Integer, nullable=False),
        sa.Column("product_id",    sa.Integer, sa.ForeignKey("products.id"), nullable=False),
        sa.Column("current_stock", sa.Numeric(12, 3), server_default="0"),
        sa.Column("last_sync",     sa.DateTime),
    )
    op.create_unique_constraint("uq_outlet_stock", "outlet_stock", ["outlet_id", "product_id"])

    # ── sync_logs ─────────────────────────────────────────────────────────────
    op.create_table(
        "sync_logs",
        sa.Column("id",             sa.Integer, primary_key=True),
        sa.Column("outlet_id",      sa.Integer, nullable=False),
        sa.Column("sync_type",      sa.String(30), nullable=False),
        sa.Column("status",         sa.String(20), server_default="success"),
        sa.Column("message",        sa.Text),
        sa.Column("records_synced", sa.Integer, server_default="0"),
        sa.Column("created_at",     sa.DateTime, server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("sync_logs")
    op.drop_table("outlet_stock")
    op.drop_table("unit_wise_stock_transfer_items")
    op.drop_table("unit_wise_stock_transfers")
    op.drop_table("unit_wise_purchase_return_items")
    op.drop_table("unit_wise_purchase_returns")
    op.drop_table("unit_wise_purchase_items")
    op.drop_table("unit_wise_purchases")
