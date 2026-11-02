"""Telegram Business Assistant: webhook (public, secret header) + administrator settings, linking, logs."""
import hmac
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.dependencies import require_role
from app.services import telegram_bot as tb
from app.services.auth_service import write_audit

hook = APIRouter(prefix="/telegram", tags=["telegram"])
router = APIRouter(prefix="/telegram", tags=["telegram"], dependencies=[Depends(require_role("admin", "superadmin"))])


@hook.post("/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Answers Telegram at once; the report runs in the background. Unknown callers get the same 200 and nothing else."""
    sent = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if not tb.token() or not hmac.compare_digest(sent, tb.webhook_secret()):
        raise HTTPException(401, "unauthorised")
    try:
        upd = await request.json()
        uid = int(upd["update_id"])
    except Exception:
        return {"ok": True}
    on = (await db.execute(text("SELECT enabled FROM telegram_settings WHERE id = 1"))).scalar()
    chat = ((upd.get("message") or (upd.get("callback_query") or {}).get("message") or {}).get("chat") or {}).get("id")
    log_id = (await db.execute(text("""INSERT INTO telegram_logs (update_id, chat_id, status) VALUES (:u, :c, :s)
        ON CONFLICT (update_id) DO NOTHING RETURNING id"""), {"u": uid, "c": chat, "s": "received" if on else "disabled"})).scalar()
    await db.commit()
    if log_id and on:            # a repeated update_id (Telegram retry) is processed once
        tb.spawn(tb.process_update(upd, log_id))
    return {"ok": True}


def _public_base() -> str:
    o = [x for x in get_settings().origins_list if x.startswith("https://") and "localhost" not in x]
    if not o:
        raise HTTPException(400, "No public HTTPS address configured (ALLOWED_ORIGINS).")
    return o[0].rstrip("/")


async def _tg(method: str, **kw):
    try:
        return await tb.api(method, **kw)
    except tb.TgError as ex:
        await tb._record_error(str(ex))
        raise HTTPException(400, str(ex))


@router.get("/status")
async def status(db: AsyncSession = Depends(get_db)):
    st = dict((await db.execute(text("SELECT enabled, bot_username, alerts, last_ok_at, last_error, last_error_at FROM telegram_settings WHERE id = 1"))).mappings().first())
    out = {**st, "token_configured": bool(tb.token()), "alerts": {**tb.ALERT_DEFAULTS, **(st["alerts"] or {})}, "webhook": None,
           "webhook_expected": f"{_public_base()}/api/v1/telegram/webhook" if tb.token() else None}
    if tb.token():
        try:
            w = await tb.api("getWebhookInfo")
            out["webhook"] = {"url": w.get("url"), "pending": w.get("pending_update_count"), "last_error": w.get("last_error_message"),
                              "last_error_date": w.get("last_error_date")}
        except tb.TgError as ex:
            out["webhook_error"] = str(ex)
    out["counts"] = dict((await db.execute(text("""SELECT
        (SELECT COUNT(*) FROM telegram_accounts WHERE status = 'ACTIVE') AS active_accounts,
        (SELECT COUNT(*) FROM telegram_logs WHERE at > NOW() - INTERVAL '24 hours') AS messages_24h,
        (SELECT COUNT(*) FROM telegram_logs WHERE at > NOW() - INTERVAL '24 hours' AND status IN ('error','send_failed')) AS errors_24h,
        (SELECT COUNT(*) FROM telegram_logs WHERE at > NOW() - INTERVAL '24 hours' AND status IN ('unlinked','link_failed','denied')) AS refused_24h"""))).mappings().first())
    out["reports"] = [{"key": k, "title": v[0], "group": v[1], "financial": v[2]} for k, v in tb.REPORTS.items()]
    out["alert_types"] = [{"key": k, "title": v[0], "financial": v[1]} for k, v in tb.ALERTS.items()]
    return out


class settings_in(BaseModel):
    enabled: bool
    alerts: Optional[dict] = None


@router.put("/settings")
async def save_settings(b: settings_in, db: AsyncSession = Depends(get_db), user=Depends(require_role("admin", "superadmin"))):
    alerts = None
    if b.alerts is not None:
        alerts = {}
        for k, v in b.alerts.items():
            if k in ("discount_pct", "return_pct"):
                alerts[k] = max(0.0, min(100.0, float(v or 0)))
            elif k in tb.ALERTS:
                slots = [s.strip() for s in str(v or "").split(",") if s.strip()]
                bad = [s for s in slots if not tb.re.match(r"^([01]\d|2[0-3]):[0-5]\d$", s)]
                if bad:
                    raise HTTPException(400, f"{tb.ALERTS[k][0]}: use HH:MM times separated by commas ({', '.join(bad)})")
                alerts[k] = ",".join(slots)
    await db.execute(text("""UPDATE telegram_settings SET enabled = :e, alerts = COALESCE(CAST(:a AS JSONB), alerts), updated_by = :u, updated_at = NOW()
        WHERE id = 1"""), {"e": b.enabled, "a": json.dumps(alerts) if alerts is not None else None, "u": user.user_id})
    await write_audit(db=db, module="telegram", action="settings", record_id=1, record_no="telegram",
                      description=f"Telegram assistant {'enabled' if b.enabled else 'disabled'}", new_data=json.dumps({"enabled": b.enabled, "alerts": alerts}),
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"ok": True}


@router.post("/verify")
async def verify(db: AsyncSession = Depends(get_db)):
    me = await _tg("getMe")
    await db.execute(text("UPDATE telegram_settings SET bot_username = :n, last_ok_at = NOW() WHERE id = 1"), {"n": me.get("username")})
    await db.commit()
    return {"ok": True, "bot_username": me.get("username"), "bot_name": me.get("first_name")}


@router.post("/webhook/register")
async def register_webhook(db: AsyncSession = Depends(get_db), user=Depends(require_role("admin", "superadmin"))):
    url = f"{_public_base()}/api/v1/telegram/webhook"
    await _tg("setWebhook", url=url, secret_token=tb.webhook_secret(), allowed_updates=["message", "callback_query"], max_connections=20)
    await _tg("setMyCommands", commands=[{"command": k, "description": v[0][:60]} for k, v in
                                         [("menu", ("Main menu",)), ("status", ("My access",))] + list(tb.REPORTS.items())][:100])
    await write_audit(db=db, module="telegram", action="webhook", record_id=1, record_no="telegram", description=f"Webhook set to {url}",
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"ok": True, "url": url}


@router.delete("/webhook")
async def remove_webhook(db: AsyncSession = Depends(get_db), user=Depends(require_role("admin", "superadmin"))):
    await _tg("deleteWebhook")
    await write_audit(db=db, module="telegram", action="webhook", record_id=1, record_no="telegram", description="Webhook removed",
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"ok": True}


@router.get("/accounts")
async def accounts(db: AsyncSession = Depends(get_db)):
    return [dict(r) for r in (await db.execute(text("""SELECT a.id, a.user_id, u.name AS user_name, u.username, u.role, a.chat_id, a.tg_username, a.tg_name,
            a.status, a.allow_financial, a.blocked_reports, a.alerts, a.linked_at, a.revoked_at, a.last_seen_at, lb.name AS linked_by_name
        FROM telegram_accounts a JOIN users u ON u.id = a.user_id LEFT JOIN users lb ON lb.id = a.linked_by
        ORDER BY a.status, u.name"""))).mappings()]


class code_in(BaseModel):
    user_id: int
    allow_financial: bool = False


@router.post("/link-code")
async def link_code(b: code_in, db: AsyncSession = Depends(get_db), user=Depends(require_role("admin", "superadmin"))):
    """One-time code (15 min). Shown once; only its hash is stored."""
    u = (await db.execute(text("SELECT id, name, status FROM users WHERE id = :i"), {"i": b.user_id})).mappings().first()
    if not u or not u["status"]:
        raise HTTPException(400, "Choose an active user.")
    code, exp = await tb.new_link_code(db, b.user_id, b.allow_financial, user.user_id)
    await write_audit(db=db, module="telegram", action="link_code", record_id=b.user_id, record_no=u["name"],
                      description=f"Telegram link code issued for {u['name']}" + (" (financial reports allowed)" if b.allow_financial else ""),
                      user_id=user.user_id, user_name=user.username)
    await db.commit()
    bot = (await db.execute(text("SELECT bot_username FROM telegram_settings WHERE id = 1"))).scalar()
    return {"code": code, "expires_at": exp, "minutes": tb.CODE_TTL_MIN, "link": f"https://t.me/{bot}?start={code}" if bot else None}


class account_in(BaseModel):
    allow_financial: Optional[bool] = None
    blocked_reports: Optional[list[str]] = None
    alerts: Optional[list[str]] = None
    status: Optional[str] = Field(None, pattern="^(ACTIVE|REVOKED)$")


@router.patch("/accounts/{aid}")
async def update_account(aid: int, b: account_in, db: AsyncSession = Depends(get_db), user=Depends(require_role("admin", "superadmin"))):
    a = (await db.execute(text("SELECT * FROM telegram_accounts WHERE id = :i"), {"i": aid})).mappings().first()
    if not a:
        raise HTTPException(404, "Account not found")
    if b.blocked_reports is not None and set(b.blocked_reports) - set(tb.REPORTS):
        raise HTTPException(400, "Unknown report")
    if b.alerts is not None and set(b.alerts) - set(tb.ALERTS):
        raise HTTPException(400, "Unknown alert")
    if b.status == "ACTIVE" and a["status"] == "REVOKED":
        raise HTTPException(400, "A revoked account must be linked again with a new code.")
    await db.execute(text("""UPDATE telegram_accounts SET allow_financial = COALESCE(:f, allow_financial),
            blocked_reports = COALESCE(CAST(:br AS TEXT[]), blocked_reports), alerts = COALESCE(CAST(:al AS TEXT[]), alerts),
            status = COALESCE(:s, status), revoked_at = CASE WHEN :s = 'REVOKED' THEN NOW() ELSE revoked_at END,
            revoked_by = CASE WHEN :s = 'REVOKED' THEN :u ELSE revoked_by END WHERE id = :i"""),
        {"f": b.allow_financial, "br": b.blocked_reports, "al": b.alerts, "s": b.status, "u": user.user_id, "i": aid})
    await write_audit(db=db, module="telegram", action="revoke" if b.status == "REVOKED" else "account", record_id=aid, record_no=f"chat {a['chat_id']}",
                      description="Telegram access revoked" if b.status == "REVOKED" else "Telegram access changed",
                      new_data=json.dumps(b.model_dump(exclude_none=True)), user_id=user.user_id, user_name=user.username)
    await db.commit()
    return {"ok": True}


@router.post("/accounts/{aid}/test")
async def test_message(aid: int, db: AsyncSession = Depends(get_db)):
    a = (await db.execute(text("SELECT chat_id FROM telegram_accounts WHERE id = :i AND status = 'ACTIVE'"), {"i": aid})).scalar()
    if not a:
        raise HTTPException(404, "Active account not found")
    await _tg("sendMessage", chat_id=a, text="✅ Test message from Nutribray Business Assistant. Send /menu to see your reports.")
    return {"ok": True}


@router.get("/logs")
async def logs(status: Optional[str] = None, limit: int = 200, db: AsyncSession = Depends(get_db)):
    return [dict(r) for r in (await db.execute(text("""SELECT l.id, l.at, l.chat_id, l.request, l.report, l.status, l.ms, l.error, u.name AS user_name
        FROM telegram_logs l LEFT JOIN users u ON u.id = l.user_id WHERE (CAST(:s AS TEXT) IS NULL OR l.status = :s)
        ORDER BY l.id DESC LIMIT :n"""), {"s": status, "n": max(1, min(limit, 1000))})).mappings()]


@router.get("/alerts-sent")
async def alerts_sent(db: AsyncSession = Depends(get_db)):
    return [dict(r) for r in (await db.execute(text("""SELECT s.id, s.alert, s.period, s.status, s.error, s.sent_at, u.name AS user_name
        FROM telegram_alerts_sent s JOIN telegram_accounts a ON a.id = s.account_id JOIN users u ON u.id = a.user_id
        ORDER BY s.id DESC LIMIT 200"""))).mappings()]
