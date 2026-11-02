// 80mm thermal POS receipt — ported from NCG application/views/billing/print.php (thermal-3in).
import type { invoice_out } from '../api/billing'
import type { CompanySettings } from '../api/company'

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const n2 = (v: unknown) => Number(v || 0).toFixed(2)
const modeLabel = (m: string) => m === 'upi' ? 'UPI' : m.charAt(0).toUpperCase() + m.slice(1)

export interface receipt_extra {
  customer_name?: string
  customer_phone?: string
  cashier?: string
  mrp?: Record<number, number>          // product_id -> MRP per unit (for "You Saved")
  tendered?: number                      // cash handed over
}

export function printReceipt(inv: invoice_out, s: Partial<CompanySettings>, x: receipt_extra = {}) {
  const logo = s.logo_path ? new URL(s.logo_path, window.location.origin).href : `${window.location.origin}/nutribay_logo.svg`
  const totalQty = inv.items.reduce((a, it) => a + Number(it.qty), 0)
  const itemsTotal = inv.items.reduce((a, it) => a + Number(it.total), 0)
  const ratio = itemsTotal > 0 ? (Number(inv.total_amount) - Number(inv.round_off || 0)) / itemsTotal : 1  // spreads CD into lines (bills saved before CD moved into lines)
  const cdInLines = Math.abs(ratio - 1) < 0.0005 ? Number(inv.cd_amount || 0) : 0  // newer bills: line totals are already after CD
  const mrpTotal = inv.items.reduce((a, it) => a + (x.mrp?.[it.product_id] ?? Number(it.total) / Number(it.qty)) * Number(it.qty), 0)
  const saved = Math.round((mrpTotal - Number(inv.total_amount)) * 100) / 100
  const change = x.tendered ? Math.max(0, x.tendered - Number(inv.paid_amount)) : 0
  const time = new Date(inv.created_at || Date.now()).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  const date = new Date(inv.invoice_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-')
  const walkIn = !x.customer_name || /walk-?in|cash/i.test(x.customer_name)
  const phone = x.customer_phone && x.customer_phone.length > 4 ? 'X'.repeat(x.customer_phone.length - 4) + x.customer_phone.slice(-4) : x.customer_phone

  const lines = inv.items.map(it => {
    const q = Number(it.qty), lineTotal = Number(it.total) * ratio, unit = lineTotal / q
    const mrp = x.mrp?.[it.product_id]
    const sd = mrp ? mrp - unit : 0
    const gst = (Number(it.cgst_amount) + Number(it.sgst_amount) + Number(it.igst_amount)) * ratio
    return `<tr style="border-bottom:1px dotted #ddd;">
      <td style="padding:4px 0;line-height:1.3;">
        <div style="font-weight:bold;">${esc(String(it.name || '').toUpperCase())}</div>
        <div style="font-size:9px;">
          ${mrp ? `<span style="font-size:8px;">MRP-${mrp.toFixed(0)}</span>${sd > 0.004 ? ` <span style="font-size:8px;">S.D &#8377;${sd.toFixed(2)}</span>` : ''} ` : ''}
          ${q} ${esc(it.unit)} &times; &#8377;${unit.toFixed(2)}
          <br><span style="font-size:8.5px;">${it.hsn_code ? `HSN: ${esc(it.hsn_code)}` : ''}${it.hsn_code && Number(it.gst_percent) > 0 ? ' | ' : ''}${Number(it.gst_percent) > 0 ? `GST: ${Number(it.gst_percent)}% (&#8377;${gst.toFixed(2)})` : ''}</span>
        </div>
      </td>
      <td style="text-align:right;padding:4px 0;vertical-align:top;font-weight:bold;">&#8377;${lineTotal.toFixed(2)}</td>
    </tr>`
  }).join('')

  const groups = new Map<string, { hsn: string; rate: number; taxable: number; gst: number }>()
  for (const it of inv.items) {
    const k = `${it.gst_percent}_${it.hsn_code ?? ''}`
    const g = groups.get(k) ?? { hsn: it.hsn_code ?? '—', rate: Number(it.gst_percent), taxable: 0, gst: 0 }
    g.taxable += Number(it.taxable_amt) * ratio
    g.gst += (Number(it.cgst_amount) + Number(it.sgst_amount) + Number(it.igst_amount)) * ratio
    groups.set(k, g)
  }
  const gstSummary = [...groups.values()].filter(g => g.rate > 0).map(g => `<div style="margin-bottom:3px;">
      HSN: ${esc(g.hsn)} | TaxVal: &#8377;${g.taxable.toFixed(2)}<br>
      ${inv.is_interstate ? `IGST (${g.rate}%): &#8377;${g.gst.toFixed(2)}`
        : `CGST (${g.rate / 2}%): &#8377;${(g.gst / 2).toFixed(2)} | SGST (${g.rate / 2}%): &#8377;${(g.gst / 2).toFixed(2)}`}
    </div>`).join('')

  const row = (l: string, v: string, style = '') => `<tr style="${style}"><td style="padding:2px 0;">${l}</td><td style="text-align:right;padding:2px 0;">${v}</td></tr>`
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Bill ${esc(inv.invoice_no)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; background:#f0f2f5; color:#000; }
  .page { width:80mm; margin:12px auto; padding:4mm; background:#fff; font-size:12.5px; line-height:1.35; position:relative; box-shadow:0 0 8px rgba(0,0,0,.12); }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  .stamp { position:absolute; top:15mm; right:4mm; font-size:26px; font-weight:900; border:2px solid #000; padding:0 6px; transform:rotate(-12deg); opacity:.18; }
  .no-print { text-align:center; padding:10px; }
  .no-print button { padding:6px 16px; margin:0 4px; border:none; border-radius:4px; cursor:pointer; color:#fff; background:#1D2D3D; }
  @media print { body { background:#fff; } .no-print { display:none; } .page { width:72mm; margin:0 auto; padding:1mm 1mm 20mm; box-shadow:none; } }
  @page { size:80mm auto; margin:0 4mm; }
</style></head><body>
<div class="no-print"><button onclick="window.print()">Print</button><button style="background:#666" onclick="window.close()">Close</button></div>
<div class="page">
  ${inv.status === 'paid' ? '<div class="stamp">PAID</div>' : inv.status === 'partial' ? '<div class="stamp">PARTIAL</div>' : ''}
  ${logo ? `<div style="text-align:center;margin-bottom:6px;"><img src="${esc(logo)}" style="max-height:48px;max-width:100%;object-fit:contain;" onerror="this.remove()"></div>` : ''}
  <div style="text-align:center;margin-bottom:6px;">
    <div style="font-size:14px;font-weight:bold;text-transform:uppercase;">${esc(s.brand_name || 'nutribray')}</div>
    <div style="font-size:9.5px;font-weight:bold;">${esc(s.legal_name || 'Nutribray')}</div>
    <div style="font-size:9.5px;line-height:1.35;margin-top:2px;">
      ${esc(s.ho_address || 'TR-311, 312, ALTF Mohan Cooperative Industrial Estate, South Delhi – 110076')}<br>
      Ph: ${esc(s.ho_phone || '74003 39365 / 82934 14222')}${s.gstin ? `<br>GSTIN: <strong>${esc(s.gstin)}</strong>` : ''}${s.fssai_no ? `<br>FSSAI Lic. No: <strong>${esc(s.fssai_no)}</strong>` : ''}
    </div>
  </div>
  <div style="border-top:1px dashed #000;border-bottom:1px dashed #000;padding:4px 0;margin-bottom:6px;font-size:9.5px;">
    <div style="text-align:center;font-weight:bold;text-transform:uppercase;margin-bottom:2px;font-size:10.5px;">Tax Invoice</div>
    <table style="font-size:9.5px;">
      <tr><td>Bill No: <strong>${esc(inv.invoice_no)}</strong></td><td style="text-align:right;">Date: <strong>${date}</strong></td></tr>
      ${x.cashier ? `<tr><td colspan="2">Cashier: <strong>${esc(x.cashier)}</strong></td></tr>` : ''}
      <tr><td>Pay: ${esc(modeLabel(inv.payment_mode))}</td><td style="text-align:right;">Time: <strong>${time}</strong></td></tr>
    </table>
  </div>
  ${walkIn ? '' : `<div style="font-size:9.5px;margin-bottom:6px;padding-bottom:4px;border-bottom:1px dashed #ccc;">
    <strong>Bill To:</strong> ${esc(x.customer_name)}${phone ? `<br>Ph: ${esc(phone)}` : ''}</div>`}
  <table style="font-size:9.5px;border-bottom:1px dashed #000;margin-bottom:6px;">
    <thead><tr style="border-bottom:1px dashed #000;border-top:1px dashed #000;font-weight:bold;">
      <th style="text-align:left;padding:4px 0;">Item Description</th><th style="text-align:right;padding:4px 0;width:70px;">Amount</th></tr></thead>
    <tbody>${lines}</tbody>
  </table>
  <table style="font-size:9.5px;margin-bottom:6px;line-height:1.4;">
    ${row(`Subtotal (Qty: ${Number.isInteger(totalQty) ? totalQty : totalQty.toFixed(3)})`, `&#8377;${(itemsTotal + cdInLines).toFixed(2)}`)}
    ${Number(inv.cd_percent) > 0 ? row(`CD (${Number(inv.cd_percent)}%)`, `- &#8377;${n2(inv.cd_amount)}`) : ''}
    ${row('Taxable Amount', `&#8377;${n2(inv.taxable_amount)}`)}
    ${inv.is_interstate ? row('IGST', `&#8377;${n2(inv.igst_amount)}`)
      : row('CGST', `&#8377;${n2(inv.cgst_amount)}`) + row('SGST', `&#8377;${n2(inv.sgst_amount)}`)}
    ${Number(inv.round_off || 0) !== 0 ? row('Round Off', `${Number(inv.round_off) > 0 ? '+' : '-'} &#8377;${Math.abs(Number(inv.round_off)).toFixed(2)}`) : ''}
    ${row('GRAND TOTAL', `&#8377;${n2(inv.total_amount)}`, 'font-weight:bold;font-size:11.5px;border-top:1px dashed #000;border-bottom:1px dashed #000;')}
    ${saved > 0 ? row('&#127881; You Saved', `&#8377;${saved.toFixed(2)}`, 'font-size:11.5px;font-weight:600;') : ''}
    ${change > 0.004 ? row('Cash Tendered', `&#8377;${x.tendered!.toFixed(2)}`) + row('Change Returned', `&#8377;${change.toFixed(2)}`, 'font-weight:bold;') : ''}
    ${(inv.payments || []).map(p => row(`Paid by ${esc(modeLabel(p.payment_mode))}`, `&#8377;${n2(p.amount)}`)).join('')}
    ${row('Paid Amount', `&#8377;${n2(inv.paid_amount)}`, (inv.payments || []).length ? 'font-weight:bold;' : '')}
    ${row('Balance Due', `&#8377;${n2(inv.due_amount)}`, 'font-weight:bold;')}
  </table>
  ${gstSummary ? `<div style="font-size:8.5px;border-bottom:1px dashed #000;padding:4px 0 6px;margin-bottom:6px;line-height:1.35;">
    <div style="font-weight:bold;text-transform:uppercase;margin-bottom:2px;border-bottom:1px dotted #ccc;">GST Tax Summary</div>${gstSummary}</div>` : ''}
  ${s.invoice_terms ? `<div style="font-size:8px;line-height:1.3;margin-top:4px;">${esc(s.invoice_terms).split('\n').join('<br>')}</div>` : ''}
  <div style="text-align:center;font-size:10px;margin-top:6px;">${esc(s.invoice_footer || 'Thank you for your visit!')}</div>
</div>
<script>window.onload = function () { window.print(); };<\/script>
</body></html>`

  const win = window.open('', '_blank', 'width=420,height=700')
  if (!win) { alert('Allow pop-ups to print the bill'); return }
  win.document.write(html)
  win.document.close()
}
