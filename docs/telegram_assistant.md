# Telegram Business Assistant

Read-only live reports on Telegram for linked GEOM365 users. Settings → **Telegram Assistant** (administrators).

## What the codebase uses (inspected, not assumed)

| Area | Existing piece reused |
|---|---|
| Stack | FastAPI + async SQLAlchemy (PostgreSQL), React; Docker on the VPS behind Traefik (HTTPS) → **webhook** mode, no long polling |
| Permissions | `core/access.py` — outlet / category scope + module-action permissions, applied by every report endpoint |
| Sales | `/reports/sales`, `/reports/hourly`, `/reports/top-items`, `/reports/category-sales`, `/reports/payments`, `/billing/returns` |
| Inventory | `/stock-reports/summary` (outlet stock ledger: sales, returns, GRN, transfers, adjustments), `/reports/item-velocity`, `/expiry/summary` |
| Purchase / accounts | `/reports/purchase`, `/accounts/aging`, `/accounts/receivables`, `/reports/outstanding`, `/accounts/dashboard` (cash, banks, dues), `/cash/entries`, `/reports/gst`, `/reports/pl`, `/approvals` |

**Design:** the bot never has its own SQL. Each request calls the existing endpoint *in-process as the linked user*
(short-lived token that never leaves the server), so the same outlet / category / role rules and the same approved
calculations apply as on screen. An outlet the user cannot see is refused by name, and the endpoints filter it anyway.

Fix made on the way: sales, dashboard, hourly, top items, category, GST and P&L reports counted **cancelled bills** as
sales. They now exclude them, the same rule shift and day close already used.

## Set up

1. Create a bot with **@BotFather**, copy its token.
2. On the server put `TELEGRAM_BOT_TOKEN=...` in `/opt/geom/deploy/.env` and run `docker compose up -d api`.
3. Settings → Telegram Assistant → **Verify connection** → **Register webhook** → tick **Enabled**.
4. Accounts → **Link a user** → choose the software user (and whether financial reports are allowed) → give the user the
   one-time link (15 minutes, single use). The user opens it in Telegram (or sends `/start CODE` to the bot).
5. Optional: Accounts → Access → block reports, choose alerts; Alerts tab → times and thresholds.

## Commands

General `/start /help /menu /status`. Sales `/today_sales /yesterday_sales /running_sales /month_sales /sales_outlet
/top_items /hourly_sales /sales_category /sales_comparison /sales_return`. Inventory `/stock /stock_item /low_stock
/zero_stock /negative_stock /stock_value /stock_outlet /stock_category /fast_moving /non_moving /near_expiry`.
Purchase & accounts (🔒 financial) `/today_purchase /month_purchase /supplier_outstanding /customer_outstanding
/cash_balance /bank_balance /today_expense /payment_due /gst_summary /profit_summary`.

Arguments: a date (`yesterday`, `this month`, `last month`, `last 7 days`, `01-10-2026 to 15-10-2026`, up to 92 days),
an outlet (`outlet Adchini`), `top 20`, an item code or name for `/stock_item`. Plain questions work too
("How much is today's sales?", "Show stock of item 10025", "Show pending supplier payments"). Ambiguous outlet or item →
the bot asks with buttons.

Natural language is a fixed keyword matcher (no AI provider is configured). It can only choose one of the reports above.

## Security

- Token only in the server `.env`; scrubbed from errors; never shown in the UI or logs.
- Webhook requires Telegram's secret header (derived from `SECRET_KEY` + token); duplicates (same `update_id`) are processed once.
- Private chats only; group membership grants nothing. Linking only by one-time code (stored hashed, expires, single use).
- Every message re-checks the account and the user (active, validity dates). Revoke = immediate.
- Financial reports need a per-account switch and the user's own module permission.
- 20 messages / minute per chat. Read-only: only GET report endpoints are called.

## Alerts

Daily sales summary, running-sales snapshots, low stock, out of stock (selling items), pending approvals, supplier payment
due (🔒), unusual discount / returns (% of gross sales). Times in IST, each alert is claimed once per account and slot
(`telegram_alerts_sent` unique key), sent only when there is something to report. History on the Alerts tab.

## Labels and limits

- Profit summary is **provisional**: purchases booked in the period stand in for the cost of goods sold; stock change and
  expenses are not deducted.
- GST summary is output GST on sales (credit notes not netted), not a return-filing figure.
- Sales totals do not deduct returns; returns are shown separately.

## Future enhancements (not built)

- Sales target achievement: no sales-target module exists in the software yet.
- Category-level limits per Telegram account beyond the user's own categories.
- Write actions (approvals from Telegram): need their own authorisation design and confirmation step.
- AI-assisted question parsing if a provider is configured; it must still map only to this fixed list of reports.
