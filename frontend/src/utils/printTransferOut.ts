// Stock transfer-out note (A4 portrait). Several transfers print in one window, one per page.
import type { CompanySettings } from '../api/company'

interface trf_location { name: string; code?: string | null; address?: string | null; city?: string | null; state?: string | null; gst_number?: string | null }
export interface transfer_print {
  transfer_no: string
  transfer_date: string
  status: string
  remarks?: string | null
  from: trf_location | null
  to: trf_location | null
  received_at?: string | null
  items: { id?: number; name: string; item_code?: string | null; barcode?: string | null; hsn_code?: string | null
           qty: string; received_qty?: string | null; unit?: string | null; cost_price: string; mrp: string; total_val: string
           batch_no?: string | null; expiry_date?: string | null }[]
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const n2 = (v: unknown) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (v: unknown) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })
const dmy = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-') : ''

const locBox = (title: string, l: trf_location | null) => `
  <div class="box"><div class="box-title">${title}</div><div class="box-content">
    <strong>${esc(l?.name)}</strong>${l?.code ? ` <span class="muted">(${esc(l.code)})</span>` : ''}<br>
    ${l?.address ? esc(l.address) + '<br>' : ''}
    ${[l?.city, l?.state].filter(Boolean).map(esc).join(', ')}
    ${l?.gst_number ? `<br><strong>GSTIN:</strong> ${esc(l.gst_number)}` : ''}
  </div></div>`

function page(t: transfer_print, s: Partial<CompanySettings>, logo: string) {
  let tq = 0, tmrp = 0, tval = 0
  const rows = t.items.map((it, i) => {
    const q = Number(it.qty)
    tq += q; tmrp += q * Number(it.mrp); tval += Number(it.total_val)
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>
        <strong>${esc(it.name)}</strong>
        ${it.batch_no ? `<div style="font-size:9px;color:#0E5C63;font-weight:bold;margin-top:2px">Batch: ${esc(it.batch_no)}${it.expiry_date ? ` · Exp: ${esc(it.expiry_date)}` : ''}</div>` : ''}
      </td>
      <td>${esc(it.item_code || '-')}</td>
      <td>${esc(it.barcode || '')}</td>
      <td class="c">${esc(it.hsn_code || '')}</td>
      <td class="c b">${qty(q)} ${esc(it.unit || '')}</td>
      <td class="r">${n2(it.cost_price)}</td>
      <td class="r">${n2(it.mrp)}</td>
      <td class="r b">${n2(it.total_val)}</td>
    </tr>`
  }).join('')
  return `<section class="sheet">
  <div class="header">
    <div style="display: flex; gap: 12px; align-items: center;">
      ${logo ? `<img src="${esc(logo)}" class="logo" alt="" onerror="this.remove()">` : ''}
      <div>
        <h2>${esc(s.brand_name || 'nutribay')}</h2>
        <p style="font-weight: bold; margin-bottom: 2px;">${esc(s.legal_name || 'Nutribay')}</p>
        <p>${esc(s.ho_address || 'TR-311, 312, ALTF Mohan Cooperative Industrial Estate, South Delhi – 110076')}</p>
        <p>Ph: ${esc(s.ho_phone || '74003 39365 / 82934 14222')} &nbsp;|&nbsp; Email: ${esc(s.ho_email || '')}${s.gstin ? ` &nbsp;|&nbsp; <strong>GSTIN:</strong> ${esc(s.gstin)}` : ''}</p>
      </div>
    </div>
    <div class="title">
      <h1>Stock Transfer Out</h1>
      <p>No: ${esc(t.transfer_no)}</p>
      <p>Date: ${dmy(t.transfer_date)}</p>
      <p class="muted">Status: ${esc(t.status).toUpperCase()}</p>
    </div>
  </div>
  <div class="meta">${locBox('From (Dispatch)', t.from)}${locBox('To (Receive)', t.to)}</div>
  ${t.remarks?.trim() ? `<div class="remarks"><strong>Remarks:</strong> ${esc(t.remarks)}</div>` : ''}
  <table class="items">
    <thead><tr><th>#</th><th style="text-align:left">Item</th><th>Code</th><th>Barcode</th><th>HSN</th>
      <th>Qty</th><th class="r">Cost ₹</th><th class="r">MRP ₹</th><th class="r">Value ₹</th></tr></thead>
    <tbody>${rows}
      <tr class="tot"><td colspan="5" class="r">TOTAL (${t.items.length} items)</td>
        <td class="c">${qty(tq)}</td><td></td><td class="r">${n2(tmrp)}</td><td class="r">${n2(tval)}</td></tr>
    </tbody>
  </table>
  <div class="footer">
    <div class="sig"><div class="line">Dispatched By</div></div>
    <div class="sig"><div class="line">Driver / Carrier</div></div>
    <div class="sig"><div class="line">Received By (Sign &amp; Stamp)</div></div>
  </div>
</section>`
}

export function printTransferOut(transfers: transfer_print[], s: Partial<CompanySettings>) {
  if (!transfers.length) return
  const logo = s.logo_path ? new URL(s.logo_path, window.location.origin).href : `${window.location.origin}/nutribay_logo.svg`
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Stock Transfer Out - ${esc(transfers.map(t => t.transfer_no).join(', '))}</title>
<style>
  @page { size: A4 portrait; margin: 10mm; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11px; margin: 0; padding: 10px; color: #000; }
  .sheet { page-break-after: always; } .sheet:last-child { page-break-after: auto; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #0E5C63; padding-bottom: 6px; margin-bottom: 10px; }
  .logo { max-height: 48px; max-width: 150px; object-fit: contain; }
  h2 { margin: 2px 0; font-size: 17px; color: #0E5C63; text-transform: uppercase; }
  .header p { margin: 1px 0; font-size: 11px; color: #333; }
  .title { text-align: right; } .title h1 { margin: 0 0 4px; font-size: 20px; white-space: nowrap; color: #0E5C63; text-transform: uppercase; }
  .title p { margin: 1px 0; font-size: 12px; font-weight: bold; }
  .muted { color: #666; font-weight: normal !important; }
  .meta { display: flex; gap: 2%; margin-bottom: 8px; } .box { width: 49%; }
  .box-title { background: #0E5C63; color: #fff; padding: 3px 6px; font-weight: bold; font-size: 11px; text-transform: uppercase; }
  .box-content { border: 1px solid #0E5C63; border-top: none; padding: 6px; min-height: 48px; line-height: 1.5; }
  .remarks { border-left: 4px solid #0E5C63; background: #EEF7F7; padding: 4px 8px; margin-bottom: 8px; }
  table.items { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.items th, table.items td { border: 1px solid #999; padding: 3px 4px; }
  table.items th { background: #EEF7F7; color: #0E5C63; text-transform: uppercase; text-align: center; }
  .r { text-align: right; } .c { text-align: center; } .b { font-weight: bold; }
  tr.tot td { font-weight: bold; background: #EEF7F7; color: #0E5C63; }
  .footer { margin-top: 50px; display: flex; justify-content: space-between; gap: 20px; }
  .sig { flex: 1; text-align: center; } .line { border-top: 1px solid #000; padding-top: 4px; font-weight: bold; font-size: 11px; text-transform: uppercase; }
  .no-print { text-align: right; margin-bottom: 10px; }
  .no-print button { padding: 6px 15px; color: #fff; border: 0; cursor: pointer; font-size: 14px; font-weight: bold; border-radius: 3px; background: #0E5C63; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style></head><body>
<div class="no-print"><button onclick="window.print()">Print</button> <button style="background:#666" onclick="window.close()">Close</button></div>
${transfers.map(t => page(t, s, logo)).join('')}
<script>window.onload = function () { window.print(); };<\/script>
</body></html>`
  const win = window.open('', '_blank')
  if (!win) { alert('Allow pop-ups to print the transfer note'); return }
  win.document.write(html)
  win.document.close()
}
