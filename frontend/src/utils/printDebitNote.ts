// Debit note print — ported from NCG application/views/purchase_returns/print.php
// (landscape "PURCHASE RETURN NOTE"). Opens a standalone page and prints it.
import type { debit_note } from '../api/purchaseReturns'
import type { CompanySettings } from '../api/company'
import { inrWords } from './printCreditNote'

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const n2 = (v: unknown) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dmy = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-') : ''

export function printDebitNote(r: debit_note, s: Partial<CompanySettings>) {
  const inter = r.is_interstate
  const logo = s.logo_path ? new URL(s.logo_path, window.location.origin).href : `${window.location.origin}/nutribay_logo.svg`
  const sum = { qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, mrpVal: 0 }
  const gst = new Map<number, { taxable: number; cgst: number; sgst: number; igst: number }>()

  const rows = r.items.map((it, i) => {
    const q = Number(it.qty), mrp = Number(it.mrp || 0), sp = Number(it.selling_price || 0)
    sum.qty += q; sum.taxable += Number(it.taxable_amt); sum.cgst += Number(it.cgst_amount); sum.sgst += Number(it.sgst_amount)
    sum.igst += Number(it.igst_amount); sum.total += Number(it.total); sum.mrpVal += q * mrp
    const g = gst.get(Number(it.gst_percent)) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 }
    g.taxable += Number(it.taxable_amt); g.cgst += Number(it.cgst_amount); g.sgst += Number(it.sgst_amount); g.igst += Number(it.igst_amount)
    gst.set(Number(it.gst_percent), g)
    return `<tr>
      <td>${i + 1}</td>
      <td style="text-align:left;font-weight:600;">${esc(it.name)}</td>
      <td>${esc(it.item_code || '-')}</td>
      <td class="text-center">${esc(it.hsn_code || '')}</td>
      <td class="text-right">${n2(it.price)}</td>
      <td class="text-center">${Number(it.gst_percent)}%</td>
      <td class="text-right">${n2(it.taxable_amt)}</td>
      ${inter ? `<td class="text-right">${n2(it.igst_amount)} <small>(${Number(it.igst_percent)}%)</small></td>`
              : `<td class="text-right">${n2(it.cgst_amount)} <small>(${Number(it.cgst_percent)}%)</small></td>
                 <td class="text-right">${n2(it.sgst_amount)} <small>(${Number(it.sgst_percent)}%)</small></td>`}
      <td class="text-right">${mrp > 0 ? n2(mrp) : '-'}</td>
      <td class="text-right">${sp > 0 ? n2(sp) : '-'}</td>
      <td class="text-center" style="font-weight:bold;">${q} ${esc(it.unit || '')}</td>
      <td class="text-right" style="font-weight:bold;">${n2(it.total)}</td>
    </tr>`
  }).join('')

  const gstRows = [...gst.entries()].map(([rate, v]) => `<tr>
      <td>${rate}%</td><td>₹${n2(v.taxable)}</td><td>₹${n2(v.cgst)}</td><td>₹${n2(v.sgst)}</td><td>₹${n2(v.igst)}</td>
      <td>₹${n2(v.cgst + v.sgst + v.igst)}</td></tr>`).join('')

  const sp = r.supplier
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Purchase Return Note - ${esc(r.prn_no)}</title>
<style>
  @page { size: landscape; margin: 5mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 10px; margin: 0; padding: 10px; color: #000; }
  .print-wrap { width: 100%; margin: 0 auto; position: relative; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0055a5; padding-bottom: 5px; margin-bottom: 10px; }
  .company-logo { max-height: 50px; max-width: 150px; object-fit: contain; margin-bottom: 4px; }
  .company-info h2 { margin: 0 0 2px 0; font-size: 18px; text-transform: uppercase; color: #0055a5; }
  .company-info p { margin: 2px 0; font-size: 11px; color: #333; }
  .doc-title { text-align: right; }
  .doc-title h1 { margin: 0 0 2px 0; font-size: 20px; color: #0055a5; text-transform: uppercase; }
  .doc-title p { margin: 2px 0; font-size: 12px; font-weight: bold; }
  .meta-row { display: flex; justify-content: space-between; margin-bottom: 10px; }
  .supplier-box, .purchase-box { width: 49%; }
  .box-title { background: #0055a5; color: #fff; padding: 3px 5px; font-weight: bold; border: 1px solid #0055a5; font-size: 11px; text-transform: uppercase; }
  .box-content { border: 1px solid #0055a5; border-top: none; padding: 5px; min-height: 50px; font-size: 11px; line-height: 1.5; }
  table.items-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9px; }
  table.items-table th, table.items-table td { border: 1px solid #999; padding: 2px 3px; text-align: left; white-space: nowrap; }
  table.items-table th { background: #f0f4f8; color: #0055a5; font-weight: bold; text-align: center; text-transform: uppercase; }
  .text-right { text-align: right !important; } .text-center { text-align: center !important; }
  .totals-box { width: 280px; border: 1px solid #0055a5; padding: 4px; }
  .totals-table { width: 100%; border-collapse: collapse; }
  .totals-table td { padding: 2px 3px; font-size: 10px; }
  .totals-table td:nth-child(2) { text-align: right; font-weight: bold; }
  .grand-total-row { border-top: 1px solid #0055a5; font-size: 13px !important; color: #0055a5; }
  .reason-box { border-left: 4px solid #0055a5; background: #f0f4f8; padding: 4px 8px; margin-bottom: 8px; font-size: 10px; }
  .gst-section { border: 1px solid #0055a5; padding: 5px; margin-bottom: 8px; }
  .gst-section-title { color: #0055a5; font-weight: bold; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; }
  table.gst-table { width: 100%; border-collapse: collapse; font-size: 9px; }
  table.gst-table th { background: #f0f4f8; color: #0055a5; padding: 2px 4px; border: 1px solid #ccc; text-align: center; }
  table.gst-table td { padding: 2px 4px; border: 1px solid #ccc; text-align: right; }
  table.gst-table td:first-child { text-align: center; }
  .footer { margin-top: 30px; display: flex; justify-content: space-between; padding: 0 40px; }
  .signature-box { text-align: center; width: 180px; }
  .signature-line { border-top: 1px solid #000; margin-top: 50px; padding-top: 4px; font-weight: bold; font-size: 11px; text-transform: uppercase; color: #0055a5; }
  .note-box { background: #f0f4f8; border: 1px solid #cce; padding: 5px 8px; font-size: 9px; color: #444; margin-bottom: 8px; }
  .cancelled { position:absolute; top:35%; left:25%; font-size:90px; color:rgba(0,85,165,.12); transform:rotate(-20deg); font-weight:900; pointer-events:none; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style></head><body>
<div style="text-align:right;margin-bottom:10px;" class="no-print">
  <button onclick="window.print()" style="padding:6px 15px;background:#0055a5;color:#fff;border:1px solid #004080;cursor:pointer;font-size:14px;font-weight:bold;border-radius:2px;">Print Document</button>
  <button onclick="window.close()" style="padding:6px 15px;background:#666;color:#fff;border:none;cursor:pointer;font-size:14px;border-radius:2px;">Close</button>
</div>
<div class="print-wrap">
  ${r.status === 'cancelled' ? '<div class="cancelled">CANCELLED</div>' : ''}
  <div class="header">
    <div class="company-info">
      ${logo ? `<img src="${esc(logo)}" class="company-logo" alt="Logo" onerror="this.remove()">` : ''}
      <h2>${esc(s.brand_name || 'nutribray')}</h2>
      <p style="font-weight: bold; margin-bottom: 2px;">${esc(s.legal_name || 'Nutribray')}</p>
      <p>${esc(s.ho_address || 'TR-311, 312, ALTF Mohan Cooperative Industrial Estate, South Delhi – 110076')}</p>
      <p>Ph: ${esc(s.ho_phone || '74003 39365 / 82934 14222')} &nbsp;|&nbsp; Email: ${esc(s.ho_email || '')} &nbsp;|&nbsp; <strong>GSTIN:</strong> ${esc(s.gstin || '07AAACG1234F1Z5')}</p>
    </div>
    <div class="doc-title">
      <h1>PURCHASE RETURN NOTE</h1>
      <p>Debit Note No: ${esc(r.prn_no)}</p>
      <p>Date: ${dmy(r.return_date)}</p>
      ${r.ref_purchase_no ? `<p style="font-size:11px;color:#555;">Against GRN: ${esc(r.ref_purchase_no)}</p>` : ''}
    </div>
  </div>

  <div class="meta-row">
    <div class="supplier-box">
      <div class="box-title">Supplier Details (Return To)</div>
      <div class="box-content">
        <strong>${esc(sp?.name || '')}</strong><br>
        ${sp?.address ? esc(sp.address) + '<br>' : ''}
        <strong>GSTIN:</strong> ${esc(sp?.gst_number || 'N/A')} &nbsp;|&nbsp; State: ${esc(sp?.state || 'N/A')}
      </div>
    </div>
    <div class="purchase-box">
      <div class="box-title">Return Details</div>
      <div class="box-content">
        <strong>Return No:</strong> ${esc(r.prn_no)} &nbsp;&nbsp; <strong>Return Date:</strong> ${dmy(r.return_date)}<br>
        <strong>Supply Type:</strong> ${inter ? 'Interstate (IGST)' : 'Intrastate (CGST+SGST)'}
        ${r.ref_purchase_no ? `<br><strong>Against GRN:</strong> ${esc(r.ref_purchase_no)}` : ''}
        ${r.grn_invoice_no ? ` &nbsp;|&nbsp; <strong>Supplier Inv:</strong> ${esc(r.grn_invoice_no)}${r.grn_invoice_date ? ' dt ' + dmy(r.grn_invoice_date) : ''}` : ''}
      </div>
    </div>
  </div>

  ${r.reason ? `<div class="reason-box"><strong>Return Reason:</strong> ${esc(r.reason)}</div>` : ''}

  <table class="items-table">
    <thead><tr>
      <th>SI</th><th style="text-align:left;">Product</th><th>Item Code</th><th>HSN</th><th class="text-right">Rate (₹)</th>
      <th>Tax %</th><th class="text-right">Taxable Amt</th>
      ${inter ? '<th class="text-right">IGST ₹</th>' : '<th class="text-right">CGST ₹</th><th class="text-right">SGST ₹</th>'}
      <th class="text-right">MRP</th><th class="text-right">SP</th><th class="text-center">Qty</th><th class="text-right">Total ₹</th>
    </tr></thead>
    <tbody>${rows}
      <tr style="font-weight:bold;background:#f0f4f8;color:#0055a5;">
        <td colspan="6" class="text-right" style="text-transform:uppercase;">Grand Totals:</td>
        <td class="text-right">${n2(sum.taxable)}</td>
        ${inter ? `<td class="text-right">${n2(sum.igst)}</td>` : `<td class="text-right">${n2(sum.cgst)}</td><td class="text-right">${n2(sum.sgst)}</td>`}
        <td class="text-right">${n2(sum.mrpVal)}</td><td></td>
        <td class="text-center">${sum.qty}</td>
        <td class="text-right">${n2(sum.total)}</td>
      </tr>
    </tbody>
  </table>

  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div style="width:55%;">
      <div class="gst-section">
        <div class="gst-section-title">GST Summary</div>
        <table class="gst-table">
          <thead><tr><th>GST Rate</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total GST</th></tr></thead>
          <tbody>${gstRows}</tbody>
        </table>
      </div>
      <div class="note-box">This Debit Note has been issued for goods returned to supplier. ITC on returned goods must be reversed in GSTR-3B Table 4(B)(2).</div>
      <div class="note-box"><strong>Amount in words:</strong> ${inrWords(Number(r.total_amount))}</div>
      ${Number(r.adjusted_amount) > 0 ? `<div class="note-box">₹${n2(r.adjusted_amount)} adjusted against GRN ${esc(r.ref_purchase_no)} payable.</div>` : ''}
    </div>
    <div class="totals-box">
      <table class="totals-table">
        <tr><td>Taxable Amount:</td><td>₹ ${n2(r.taxable_amount)}</td></tr>
        ${Number(r.cgst_amount) > 0 ? `<tr><td>CGST:</td><td>₹ ${n2(r.cgst_amount)}</td></tr><tr><td>SGST:</td><td>₹ ${n2(r.sgst_amount)}</td></tr>` : ''}
        ${Number(r.igst_amount) > 0 ? `<tr><td>IGST:</td><td>₹ ${n2(r.igst_amount)}</td></tr>` : ''}
        <tr class="grand-total-row"><td style="padding-top:5px;"><strong>DEBIT NOTE TOTAL:</strong></td>
          <td style="padding-top:5px;font-size:14px;">₹ ${n2(r.total_amount)}</td></tr>
      </table>
    </div>
  </div>

  <div class="footer">
    <div class="signature-box"><div class="signature-line">Supplier Acknowledgement</div></div>
    <div class="signature-box"><div class="signature-line">Authorized Signatory</div></div>
  </div>
</div>
<script>window.onload = function () { window.print(); };<\/script>
</body></html>`

  const win = window.open('', '_blank')
  if (!win) { alert('Allow pop-ups to print the debit note'); return }
  win.document.write(html)
  win.document.close()
}
