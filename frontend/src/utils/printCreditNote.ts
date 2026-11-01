// Credit note print — ported from NCG application/views/sales_returns/print.php
// Opens a standalone A4 page and prints it.
import type { credit_note } from '../api/returns'
import type { CompanySettings } from '../api/company'

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const money = (v: unknown) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmy = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-') : ''
const qtyText = (q: unknown) => String(Number(q || 0))

// Indian numbering (Lakh/Crore), same as NCG inr_words
export function inrWords(n: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  const w = (x: number): string => {
    if (x < 20) return ones[x]
    if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : '')
    if (x < 1000) return ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + w(x % 100) : '')
    if (x < 100000) return w(Math.floor(x / 1000)) + ' Thousand' + (x % 1000 ? ' ' + w(x % 1000) : '')
    if (x < 10000000) return w(Math.floor(x / 100000)) + ' Lakh' + (x % 100000 ? ' ' + w(x % 100000) : '')
    return w(Math.floor(x / 10000000)) + ' Crore' + (x % 10000000 ? ' ' + w(x % 10000000) : '')
  }
  const rupees = Math.floor(n), paise = Math.round((n - rupees) * 100)
  return `Rupees ${rupees ? w(rupees) : 'Zero'}${paise ? ` and ${w(paise)} Paise` : ''} Only`
}

export function printCreditNote(r: credit_note, s: Partial<CompanySettings>) {
  const inter = r.is_interstate
  const logo = s.logo_path ? new URL(s.logo_path, window.location.origin).href : `${window.location.origin}/nutribay_logo.svg`
  const refund = r.refund_method === 'adjust'
    ? (Number(r.adjusted_amount) >= Number(r.total_amount) ? 'Adjust Outstanding' : `Adjust ₹${money(r.adjusted_amount)} + Cash`)
    : 'Cash Refund'

  const gstMap = new Map<string, { hsn: string; rate: number; taxable: number; cgst: number; sgst: number; igst: number }>()
  for (const it of r.items) {
    const key = `${it.gst_percent}_${it.hsn_code ?? ''}`
    const g = gstMap.get(key) ?? { hsn: it.hsn_code ?? '', rate: Number(it.gst_percent), taxable: 0, cgst: 0, sgst: 0, igst: 0 }
    g.taxable += Number(it.taxable_amt); g.cgst += Number(it.cgst_amount); g.sgst += Number(it.sgst_amount); g.igst += Number(it.igst_amount)
    gstMap.set(key, g)
  }

  const c = r.customer
  const rows = r.items.map((it, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td><strong>${esc(it.name)}</strong>${it.item_code ? `<br><small style="color:#888">${esc(it.item_code)}</small>` : ''}</td>
      <td class="center"><code>${esc(it.hsn_code || '—')}</code></td>
      <td class="center">${qtyText(it.qty)}</td>
      <td class="center">${esc(it.unit || '')}</td>
      <td class="right">₹ ${money(it.rate)}</td>
      <td class="right">₹ ${money(it.taxable_amt)}</td>
      ${inter
        ? `<td class="right">₹ ${money(it.igst_amount)} <small>(${Number(it.igst_percent)}%)</small></td>`
        : `<td class="right">₹ ${money(it.cgst_amount)} <small>(${Number(it.cgst_percent)}%)</small></td>
           <td class="right">₹ ${money(it.sgst_amount)} <small>(${Number(it.sgst_percent)}%)</small></td>`}
      <td class="right"><strong>₹ ${money(it.total)}</strong></td>
    </tr>`).join('')

  const gstRows = [...gstMap.values()].map(g => `
    <tr>
      <td>${esc(g.hsn)}</td><td>₹ ${money(g.taxable)}</td>
      ${inter ? `<td>${g.rate}%</td><td>₹ ${money(g.igst)}</td>`
              : `<td>${g.rate / 2}%</td><td>₹ ${money(g.cgst)}</td><td>${g.rate / 2}%</td><td>₹ ${money(g.sgst)}</td>`}
      <td><strong>₹ ${money(g.cgst + g.sgst + g.igst)}</strong></td>
    </tr>`).join('')

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Refund Bill - ${esc(r.invoice_no)}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Arial, sans-serif; font-size: 14px; color: #222; background: #f0f2f5; }
.page { background: #fff; position: relative; width: 210mm; min-height: 297mm; margin: 20px auto; padding: 10mm 12mm; box-shadow: 0 0 10px rgba(0,0,0,0.1); border-radius: 4px; }
.inv-header { display: flex; gap: 15px; align-items: center; border-bottom: 2px solid #b91c1c; padding-bottom: 8px; margin-bottom: 8px; }
.company-name { font-size: 20px; font-weight: bold; color: #1a1a1a; }
.company-sub  { font-size: 13px; color: #555; line-height: 1.5; margin-top: 3px; }
.inv-title    { text-align: right; flex-shrink: 0; }
.inv-title h2 { font-size: 20px; color: #b91c1c; text-transform: uppercase; letter-spacing: 2px; font-weight: 900; }
.inv-title p  { font-size: 12px; color: #555; margin-top: 2px; }
.inv-meta { display: flex; gap: 8px; margin-bottom: 8px; }
.meta-box { flex: 1; border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; font-size: 13px; }
.meta-box label { font-size:10px; color:#888; display:block; }
.meta-box span { font-weight: bold; }
.meta-box.highlight { border-color: #b91c1c; background: #fff5f5; }
.meta-box.highlight span { color: #b91c1c; }
.against-bar { background: #fff3cd; border: 1px solid #ffc107; border-left: 5px solid #ffc107; border-radius: 4px; padding: 7px 12px; margin-bottom: 8px; font-size: 13px; }
.against-bar strong { color: #856404; font-size: 14px; }
.parties { display: flex; gap: 8px; margin-bottom: 8px; }
.party-box { flex: 1; border: 1px solid #ddd; border-radius: 4px; padding: 8px 10px; }
.party-box h4 { font-size: 11px; text-transform: uppercase; color: #888; letter-spacing: .5px; margin-bottom: 4px; }
.party-box .name { font-size: 15px; font-weight: bold; margin-bottom: 2px; }
.party-box p { font-size: 13px; line-height: 1.5; color: #444; }
.reason-box { background: #fff9e6; border-left: 4px solid #e67e22; padding: 6px 10px; margin-bottom: 8px; font-size: 12px; border-radius: 0 4px 4px 0; }
.items-table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
.items-table th { background: #b91c1c; color: #fff; padding: 6px 5px; font-size: 12px; text-align: center; border: 1px solid #b91c1c; }
.items-table td { padding: 5px 5px; font-size: 13px; border: 1px solid #ddd; vertical-align: top; }
.items-table tr:nth-child(even) td { background: #fdf2f2; }
.right { text-align: right; } .center { text-align: center; }
.totals-section { display: flex; justify-content: flex-end; margin-top: 4px; }
.totals-table { width: 280px; border-collapse: collapse; font-size: 13px; }
.totals-table td { padding: 4px 8px; border: 1px solid #ddd; }
.totals-table td:last-child { text-align: right; font-weight: bold; }
.totals-table .grand { background: #b91c1c; color: #fff; font-size: 15px; }
.gst-table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 12px; }
.gst-table th { background: #f0f0f0; border: 1px solid #ccc; padding: 4px 6px; text-align: center; }
.gst-table td { border: 1px solid #ddd; padding: 4px 6px; text-align: center; }
.amt-words { border: 1px solid #ddd; border-radius: 4px; padding: 6px 10px; margin: 8px 0; font-size: 13px; }
.amt-words span { font-weight: bold; }
.inv-footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 12px; border-top: 1px solid #ddd; padding-top: 8px; font-size: 12px; }
.terms { flex: 1; color: #666; }
.signature { text-align: right; font-size: 11px; position: relative; }
.signature p { margin-top: 36px; border-top: 1px solid #333; padding-top: 4px; color: #333; }
.stamp { position:absolute; right:14px; bottom:4px; opacity:0.85; transform:rotate(-10deg); width:64px; height:64px; border:2.5px solid #b91c1c; border-radius:50%; color:#b91c1c; display:flex; align-items:center; justify-content:center; text-align:center; font-weight:800; font-size:8px; line-height:1.05; text-transform:uppercase; padding:4px; }
.cancelled { position:absolute; top:40%; left:15%; font-size:90px; color:rgba(185,28,28,.15); transform:rotate(-25deg); font-weight:900; pointer-events:none; }
.no-print { background:#f5f5f5; padding:10px 20px; display:flex; gap:10px; align-items:center; border-bottom:1px solid #ddd; }
.btn { padding:6px 18px; background:#b91c1c; color:#fff; border:none; border-radius:4px; cursor:pointer; font-size:13px; }
@media print {
  body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { display: none !important; }
  .page { width: 100%; min-height: auto; margin: 0; padding: 6mm 8mm; box-shadow: none; border-radius: 0; }
  @page { size: A4 portrait; margin: 10mm; }
}
</style></head><body>
<div class="no-print">
  <button class="btn" onclick="window.print()">&#128438; Print / Save PDF</button>
  <button class="btn" style="background:#666" onclick="window.close()">Close</button>
  <span style="color:#666;font-size:12px;">Refund Bill: <strong>${esc(r.invoice_no)}</strong></span>
</div>
<div class="page">
  ${r.status === 'cancelled' ? '<div class="cancelled">CANCELLED</div>' : ''}
  <div class="inv-header">
    ${logo ? `<div style="flex-shrink:0;"><img src="${esc(logo)}" alt="Logo" style="max-height:70px;max-width:150px;object-fit:contain;" onerror="this.remove()"></div>` : ''}
    <div style="flex-grow:1;">
      <div class="company-name">${esc(s.brand_name || 'nutribay')}</div>
      <div style="font-weight: bold; font-size: 11px; margin-bottom: 2px;">${esc(s.legal_name || 'Nutribay')}</div>
      <div class="company-sub">
        ${esc(s.ho_address || 'TR-311, 312, ALTF Mohan Cooperative Industrial Estate, South Delhi – 110076')}<br>
        Ph: ${esc(s.ho_phone || '74003 39365 / 82934 14222')} &nbsp;|&nbsp; Email: ${esc(s.ho_email || '')}${s.gstin ? ` &nbsp;|&nbsp; GSTIN: <strong>${esc(s.gstin)}</strong>` : ''}
      </div>
    </div>
    <div class="inv-title">
      <h2>&#8617; REFUND BILL</h2>
      <p>${inter ? 'Interstate (IGST)' : 'Intrastate (CGST+SGST)'}</p>
      <p style="font-size:10px;color:#888;margin-top:3px;">Credit Note / Sales Return</p>
    </div>
  </div>

  <div class="inv-meta">
    <div class="meta-box highlight"><label>Refund Bill No</label><span>${esc(r.invoice_no)}</span></div>
    <div class="meta-box"><label>Date</label><span>${dmy(r.invoice_date)}</span></div>
    <div class="meta-box"><label>Refund Method</label><span>${r.source === 'HO' ? refund : 'Outlet POS'}</span></div>
    ${r.outlet_name ? `<div class="meta-box"><label>Outlet</label><span>${esc(r.outlet_name)}</span></div>` : ''}
  </div>

  ${r.ref_invoice_no ? `<div class="against-bar">&#8617; Against Bill No: <strong>${esc(r.ref_invoice_no)}</strong>${r.ref_invoice_date ? ` &nbsp;|&nbsp; Bill Date: <strong>${dmy(r.ref_invoice_date)}</strong>` : ''}</div>` : ''}
  ${r.return_reason ? `<div class="reason-box"><strong>Return Reason:</strong> ${esc(r.return_reason)}</div>` : ''}

  <div class="parties">
    <div class="party-box">
      <h4>Refund To (Customer)</h4>
      <div class="name">${esc(c?.name || 'Walk-in Customer')}</div>
      <p>
        ${esc(c?.address)}${c?.city ? ', ' + esc(c.city) : ''}
        ${c?.state ? `<br>State: ${esc(c.state)}` : ''}
        ${c?.phone && c.phone !== '0' ? `<br>Ph: ${esc(c.phone)}` : ''}
        ${c?.gst_number ? `<br>GSTIN: <strong>${esc(c.gst_number)}</strong>` : ''}
      </p>
    </div>
    <div class="party-box">
      <h4>Refunded By (Seller)</h4>
      <div class="name">${esc(s.brand_name)}</div>
      <p>
        ${esc(s.ho_address)}<br>
        ${s.gstin ? `GSTIN: <strong>${esc(s.gstin)}</strong><br>` : ''}
        ${s.company_state ? `State: ${esc(s.company_state)}` : ''}
      </p>
    </div>
  </div>

  <table class="items-table">
    <thead><tr>
      <th style="width:4%">#</th><th style="width:30%">Product Description</th><th style="width:9%">HSN/SAC</th>
      <th style="width:6%">Qty</th><th style="width:6%">Unit</th><th style="width:9%">Rate (₹)</th><th style="width:9%">Taxable Amt</th>
      ${inter ? '<th style="width:9%">IGST</th>' : '<th style="width:7%">CGST</th><th style="width:7%">SGST</th>'}
      <th style="width:10%">Amount (₹)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="gst-table">
    <thead><tr>
      <th>HSN/SAC</th><th>Taxable Value</th>
      ${inter ? '<th>IGST Rate</th><th>IGST Amt</th>' : '<th>CGST Rate</th><th>CGST Amt</th><th>SGST Rate</th><th>SGST Amt</th>'}
      <th>Total Tax</th>
    </tr></thead>
    <tbody>${gstRows}</tbody>
  </table>

  <div class="totals-section"><table class="totals-table">
    <tr><td>Taxable Amount</td><td>₹ ${money(r.taxable_amount)}</td></tr>
    ${inter ? `<tr><td>IGST</td><td>₹ ${money(r.igst_amount)}</td></tr>`
            : `<tr><td>CGST</td><td>₹ ${money(r.cgst_amount)}</td></tr><tr><td>SGST</td><td>₹ ${money(r.sgst_amount)}</td></tr>`}
    <tr class="grand"><td>REFUND TOTAL</td><td>₹ ${money(r.total_amount)}</td></tr>
  </table></div>

  <div class="amt-words">Refund Amount in words: <span>${inrWords(Number(r.total_amount))}</span></div>

  <div class="inv-footer">
    <div class="terms">
      <strong>Note:</strong> This is a Refund Bill (Credit Note) against original Bill No.
      <strong>${esc(r.ref_invoice_no || 'N/A')}</strong>${r.ref_invoice_date ? ` dated ${dmy(r.ref_invoice_date)}` : ''}.<br>
      <span style="font-size:11px;color:#888;">For GSTR-1 → Section 9B (Credit Notes – Registered) / 9C (Unregistered).</span>
    </div>
    <div class="signature">
      <strong>For ${esc(s.brand_name)}</strong>
      <div class="stamp">${esc(s.brand_name)}</div>
      <p>Authorised Signatory</p>
    </div>
  </div>
</div>
<script>window.onload = function () { window.print(); };<\/script>
</body></html>`

  const win = window.open('', '_blank')
  if (!win) { alert('Allow pop-ups to print the credit note'); return }
  win.document.write(html)
  win.document.close()
}
