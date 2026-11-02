"""Generic Excel export for the manufacturing report screens: company logo + name + address heading, title, details, then the table."""
import io
import os
from datetime import datetime

from openpyxl import Workbook
from openpyxl.drawing.image import Image as XlImage
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import text

_FALLBACK = os.path.join(os.path.dirname(__file__), "..", "static_logo.png")


def _fallback_logo() -> str:
    """Raster copy of public/nutribay_logo.svg (Excel cannot embed SVG), drawn once."""
    if not os.path.exists(_FALLBACK):
        im = Image.new("RGBA", (240, 240), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        d.rounded_rectangle((0, 0, 239, 239), 48, fill="#0f766e")
        d.ellipse((76, 52, 164, 140), outline="#ccfbf1", width=12)
        d.arc((96, 78, 144, 114), 200, 340, fill="#ccfbf1", width=10)
        for fn in ("segoeuib.ttf", "arialbd.ttf", "arial.ttf"):
            try:
                f = ImageFont.truetype(fn, 34)
                break
            except OSError:
                f = ImageFont.load_default()
        d.text((120, 190), "NUTRIBRAY", fill="white", font=f, anchor="mm")
        im.save(_FALLBACK)
    return _FALLBACK


async def company_head(db) -> dict:
    r = (await db.execute(text("""SELECT logo_path, COALESCE(NULLIF(mfg_company_name, ''), legal_name, brand_name) AS name, reg_address, reg_city, ho_address, ho_phone, gstin
        FROM company_settings ORDER BY id LIMIT 1"""))).mappings().first() or {}
    lp = r.get("logo_path") or ""
    local = os.path.join(*lp.strip("/").split("/")) if lp.startswith("/uploads/") else ""
    logo = local if local and os.path.exists(local) and local.lower().endswith((".png", ".jpg", ".jpeg")) else _fallback_logo()
    addr = " · ".join(x for x in [r.get("reg_address") or r.get("ho_address"), r.get("reg_city"), r.get("ho_phone") and f"Ph: {r['ho_phone']}",
                                  r.get("gstin") and f"GSTIN: {r['gstin']}"] if x)
    return {"name": r.get("name") or "Nutribray", "address": addr, "logo": logo}


def build(head: dict, title: str, meta: list, cols: list[str], rows: list[list]) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = (title[:28] or "Report").replace("/", "-").replace(":", "-")
    try:
        img = XlImage(head["logo"])
        img.width = img.height = 70
        ws.add_image(img, "A1")
    except Exception:
        pass
    ws.row_dimensions[1].height = 30
    ws.row_dimensions[2].height = 22
    ws.row_dimensions[3].height = 18
    ws["C1"], ws["C1"].font = head["name"], Font(bold=True, size=16)
    ws["C2"], ws["C2"].font = head["address"], Font(size=10, color="555555")
    ws["C3"], ws["C3"].font = title, Font(bold=True, size=13)
    ws["C4"], ws["C4"].font = "Generated " + datetime.now().strftime("%d-%m-%Y %H:%M"), Font(size=9, color="777777")
    r = 6
    for k, v in meta:
        ws.cell(row=r, column=1, value=k).font = Font(bold=True)
        ws.cell(row=r, column=3, value=v)
        r += 1
    r += 1
    thin = Side(style="thin", color="BBBBBB")
    for i, c in enumerate(cols, 1):
        h = ws.cell(row=r, column=i, value=c)
        h.font, h.fill = Font(bold=True, color="FFFFFF"), PatternFill("solid", fgColor="4F46E5")
        h.alignment, h.border = Alignment(horizontal="center", vertical="center", wrap_text=True), Border(top=thin, bottom=thin, left=thin, right=thin)
    first = r + 1
    for row in rows:
        r += 1
        for i, v in enumerate(row, 1):
            c = ws.cell(row=r, column=i, value=v)
            c.border, c.alignment = Border(top=thin, bottom=thin, left=thin, right=thin), Alignment(vertical="top", wrap_text=True)
    for i, c in enumerate(cols, 1):
        longest = max([len(str(c))] + [len(str(x[i - 1])) for x in rows if i - 1 < len(x)])
        ws.column_dimensions[get_column_letter(i)].width = min(max(12, longest + 2), 60)
    ws.freeze_panes = ws.cell(row=first, column=1)
    b = io.BytesIO()
    wb.save(b)
    return b.getvalue()
