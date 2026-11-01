"""Vendor GSTIN check: format + checksum + state / PAN always (offline); taxpayer details only from an authorised GST data
provider configured in the server .env (GST_API_URL with {gstin}, GST_API_KEY, GST_API_KEY_HEADER). The GST portal is never
scraped. A vendor is marked VERIFIED only when the provider confirmed the GSTIN."""
import os
from typing import Optional

import httpx

from app.utils.gst_validators import STATE_CODE_MAP, validate_gstin


def _addr(a: dict) -> str:
    keys = ("bno", "bnm", "flno", "st", "loc", "city", "dst", "stcd", "pncd")
    return ", ".join(str(a[k]) for k in keys if a.get(k)) or a.get("adr") or ""


def parse(j: dict) -> Optional[dict]:
    """Common GSTN taxpayer-search shape (lgnm / tradeNam / sts / dty / pradr) used by most GSP providers, plus camelCase variants."""
    d = j.get("data") or j.get("result") or j.get("taxpayerInfo") or j
    if not isinstance(d, dict):
        return None
    legal = d.get("lgnm") or d.get("legalName") or d.get("legal_name")
    if not legal:
        return None
    pr = d.get("pradr") or d.get("principalPlaceOfBusiness") or {}
    addr = pr.get("addr") if isinstance(pr, dict) and isinstance(pr.get("addr"), dict) else pr if isinstance(pr, dict) else {}
    return {"legal_name": legal, "trade_name": d.get("tradeNam") or d.get("tradeName") or d.get("trade_name"),
            "reg_status": d.get("sts") or d.get("status"), "taxpayer_type": d.get("dty") or d.get("taxpayerType") or d.get("ctb"),
            "address": _addr(addr) if isinstance(addr, dict) else str(addr or ""), "registered_on": d.get("rgdt")}


async def lookup(gstin: str) -> dict:
    g = (gstin or "").strip().upper()
    ok, why = validate_gstin(g)
    base = {"gstin": g, "format_ok": ok and bool(g), "format_error": why or (None if g else "Enter a GSTIN"),
            "state": STATE_CODE_MAP.get(g[:2]) if len(g) >= 2 else None, "pan": g[2:12] if len(g) == 15 else None}
    if not base["format_ok"]:
        return {**base, "status": "INVALID", "message": base["format_error"]}
    url = os.getenv("GST_API_URL", "").strip()
    if not url:
        return {**base, "status": "UNAVAILABLE", "source": None,
                "message": "Online GST lookup is not configured (ask the administrator to add an authorised GST API). Enter the details manually."}
    headers = {os.getenv("GST_API_KEY_HEADER", "x-api-key"): os.getenv("GST_API_KEY", "")} if os.getenv("GST_API_KEY") else {}
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url.replace("{gstin}", g), headers=headers)
    except httpx.HTTPError as e:
        return {**base, "status": "UNAVAILABLE", "source": "GST API", "message": f"GST service not reachable: {type(e).__name__}"}
    if r.status_code == 404:
        return {**base, "status": "NOT_FOUND", "source": "GST API", "message": "GSTIN not found in the GST records."}
    if r.status_code >= 400:
        return {**base, "status": "UNAVAILABLE", "source": "GST API", "message": f"GST service error {r.status_code}"}
    try:
        info = parse(r.json())
    except ValueError:
        info = None
    if not info:
        return {**base, "status": "NOT_FOUND", "source": "GST API", "message": "The GST service returned no taxpayer details."}
    return {**base, **info, "status": "VERIFIED", "source": "GST API"}


if __name__ == "__main__":
    s = parse({"data": {"lgnm": "ABC FOODS PVT LTD", "tradeNam": "ABC", "sts": "Active", "dty": "Regular",
                        "pradr": {"addr": {"bno": "12", "st": "MG Road", "loc": "Delhi", "stcd": "Delhi", "pncd": "110001"}}}})
    assert s["legal_name"] == "ABC FOODS PVT LTD" and s["reg_status"] == "Active" and "110001" in s["address"]
    assert parse({"error": "x"}) is None
    print("vendor_gst OK")
