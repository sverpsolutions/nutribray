import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { purchases_api, type po_detail } from '../../api/purchases'
import { getCompanySettings, type CompanySettings } from '../../api/company'
import { QRCodeSVG } from 'qrcode.react'
import { NewItemRequest, PoEmailPanel } from '../retail/purchaseControls'

const STATUS_COLOR: Record<string, string> = {
  draft:            'bg-slate-100 text-slate-600 border-slate-300',
  pending_approval: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  approved:         'bg-green-100 text-green-800 border-green-300',
  partial:          'bg-blue-100 text-blue-800 border-blue-300',
  completed:        'bg-emerald-100 text-emerald-800 border-emerald-300',
  cancelled:        'bg-red-100 text-red-700 border-red-300',
}

function fmt_amt(n: number | string, dec = 2) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmt_date(s?: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmt_dt(s?: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function doh_class(doh: number | null) {
  if (doh === null || doh === undefined) return 'bg-slate-100 text-slate-400'
  if (doh < 3)  return 'bg-red-100 text-red-700 font-bold'
  if (doh <= 7) return 'bg-orange-100 text-orange-700 font-bold'
  return 'bg-green-100 text-green-700 font-bold'
}

export default function PODetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [po, set_po]           = useState<po_detail | null>(null)
  const [new_item, set_new_item] = useState(false)
  const [loading, set_loading] = useState(true)
  const [approving, set_approving] = useState(false)
  const [remarks, set_remarks]     = useState('')
  const [show_approve, set_show_approve] = useState(false)
  const [approve_action, set_approve_action] = useState<'approved' | 'rejected'>('approved')
  const [company, set_company] = useState<CompanySettings | null>(null)
  const [err, set_err] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    set_loading(true)
    Promise.all([
      purchases_api.get_po(Number(id)),
      getCompanySettings().catch(() => null)
    ])
      .then(([r, cRes]) => {
        set_po(r.data)
        if (cRes) set_company(cRes)
      })
      .catch(() => set_err('Failed to load PO'))
      .finally(() => set_loading(false))
  }, [id])

  async function do_approve() {
    if (!id) return
    set_approving(true)
    try {
      await purchases_api.approve_po(Number(id), approve_action, remarks)
      const r = await purchases_api.get_po(Number(id))
      set_po(r.data)
      set_show_approve(false)
      set_remarks('')
    } catch (e: any) {
      set_err(e?.response?.data?.detail || 'Action failed')
    } finally {
      set_approving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <i className="fas fa-spinner fa-spin mr-2 text-2xl"></i>
      </div>
    )
  }

  if (!po) {
    return (
      <div className="text-center py-20 text-slate-400">
        <div className="text-4xl mb-3">📋</div>
        {err || 'PO not found'}
        <div className="mt-4">
          <button onClick={() => navigate('/purchases/po')} className="text-blue-600 underline text-sm">
            ← Back to list
          </button>
        </div>
      </div>
    )
  }

  const grand_total = (po.items || []).reduce((s, i) => s + Number(i.order_qty) * Number(i.rate), 0)

  let is_igst = false
  const sup_gst = po.supplier_details?.gst_number || ''
  let del_gst = ''
  if (po.outlet_name && po.outlet_details?.gst_number) {
    del_gst = po.outlet_details.gst_number
  } else {
    del_gst = '07AAECN3440L1Z8' // HO GSTIN
  }
  if (sup_gst.length >= 2 && del_gst.length >= 2) {
    is_igst = sup_gst.substring(0, 2) !== del_gst.substring(0, 2)
  } else {
    const s_state = po.supplier_details?.state || ''
    const d_state = (po.outlet_name && po.outlet_details?.state) ? po.outlet_details.state : 'Delhi'
    is_igst = s_state.toLowerCase().trim() !== d_state.toLowerCase().trim()
  }

  const tax_summary: Record<string, { taxable: number, tax: number }> = {};
  let total_taxable = 0;
  let total_tax = 0;

  (po.items || []).forEach(item => {
    const qty = Number(item.order_qty)
    const rate = Number(item.rate)
    const gst_pct = Number(item.gst_percent) || 0
    const amt_with_tax = qty * rate
    
    const taxable = amt_with_tax / (1 + (gst_pct / 100))
    const tax_amt = amt_with_tax - taxable

    total_taxable += taxable
    total_tax += tax_amt

    if (gst_pct > 0) {
      const key = gst_pct.toString()
      if (!tax_summary[key]) tax_summary[key] = { taxable: 0, tax: 0 }
      tax_summary[key].taxable += taxable
      tax_summary[key].tax += tax_amt
    }
  })

  return (
    <div id="printable-po" className="space-y-4 pb-8 bg-white print:space-y-2 print:pb-8 print:pt-6 print:px-6">
      {/* ── PRINT HEADER (Hidden on Screen) ── */}
      <div className="hidden print:block mb-4">
        <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4 mb-4">
          <div>
            {company?.logo_path && (
              <img src={company.logo_path.startsWith('http') || company.logo_path.startsWith('/') ? company.logo_path : `/${company.logo_path}`} alt="Logo" className="h-16 mb-2 object-contain" />
            )}
            <h1 className="text-3xl font-black text-slate-800 uppercase tracking-widest">{company?.brand_name || 'NUTRIBRAY'}</h1>
            <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{company?.ho_address || 'Head Office'}</p>
            <p className="text-sm text-slate-600 mt-1">
              {company?.ho_email ? `Email: ${company.ho_email}` : ''}
              {company?.ho_email && company?.ho_phone ? ' | ' : ''}
              {company?.ho_phone ? `Phone: ${company.ho_phone}` : ''}
            </p>
            {company?.company_cin && <p className="text-sm text-slate-600">CIN: {company.company_cin}</p>}
          </div>
          <div className="text-right">
            <h2 className="text-2xl font-black text-blue-800 bg-blue-50 px-4 py-2 rounded-lg inline-block uppercase tracking-widest border border-blue-200">PURCHASE ORDER</h2>
            <div className="mt-4">
              <div className="text-sm font-bold text-slate-800">PO No: {po.po_no}</div>
              <div className="text-sm text-slate-600">Date: {fmt_date(po.po_date)}</div>
              <div className="text-sm text-slate-600">Expected: {fmt_date(po.expected_date)}</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-4">
          <div>
            <h3 className="text-xs font-bold text-blue-800 bg-blue-50 px-2 py-1.5 uppercase tracking-wider mb-2 rounded border border-blue-100">Supplier Details</h3>
            <div className="font-bold text-slate-800 text-lg">{po.supplier_name}</div>
            {po.supplier_details && (
              <div className="text-sm text-slate-600 mt-1">
                {po.supplier_details.address && <div>{po.supplier_details.address}</div>}
                {(po.supplier_details.city || po.supplier_details.state || po.supplier_details.pincode) && (
                  <div>{[po.supplier_details.city, po.supplier_details.state, po.supplier_details.pincode].filter(Boolean).join(', ')}</div>
                )}
                {po.supplier_details.gst_number && <div>GSTIN: {po.supplier_details.gst_number}</div>}
                {po.supplier_details.phone && <div>Phone: {po.supplier_details.phone}</div>}
                {po.supplier_details.email && <div>Email: {po.supplier_details.email}</div>}
              </div>
            )}
          </div>
          <div>
              <h3 className="text-xs font-bold text-emerald-800 bg-emerald-50 px-2 py-1.5 uppercase tracking-wider mb-2 rounded border border-emerald-100">Delivery To</h3>
              <div className="font-bold text-slate-800 text-lg">{po.is_master ? company?.ho_address || 'Head Office' : po.outlet_name || (company?.brand_name || 'NUTRIBRAY')}</div>
              {po.is_master ? (
                <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex gap-3 items-center">
                  <div className="bg-white p-1 rounded-lg border border-slate-200">
                    <QRCodeSVG value={`${window.location.origin}/po/guest/${po.id}`} size={64} />
                  </div>
                  <div>
                    <div className="font-black text-indigo-800 text-xs uppercase tracking-wide">MULTIPLE OUTLETS</div>
                    <p className="text-[10px] text-indigo-600 mt-0.5 leading-tight font-medium">Please scan the QR code to log into the<br/>Vendor Portal and view exact delivery<br/>locations & quantities.</p>
                  </div>
                </div>
              ) : (po.outlet_name && po.outlet_details && po.outlet_details.name) ? (
                <div className="text-sm text-slate-600 mt-1">
                  {po.outlet_details.address && <div>{po.outlet_details.address}</div>}
                  {(po.outlet_details.city || po.outlet_details.state || po.outlet_details.pincode) && (
                    <div>{[po.outlet_details.city, po.outlet_details.state, po.outlet_details.pincode].filter(Boolean).join(', ')}</div>
                  )}
                  {po.outlet_details.gst_number && <div>GSTIN: {po.outlet_details.gst_number}</div>}
                  {po.outlet_details.phone && <div>Phone: {po.outlet_details.phone}</div>}
                  {po.outlet_details.email && <div>Email: {po.outlet_details.email}</div>}
                </div>
              ) : (
                <div className="text-sm text-slate-600 mt-1">
                  {company?.ho_address && <div className="whitespace-pre-wrap">{company.ho_address}</div>}
                  {company?.company_cin && <div>CIN: {company.company_cin}</div>}
                  {company?.ho_phone && <div>Phone: {company.ho_phone}</div>}
                  {company?.ho_email && <div>Email: {company.ho_email}</div>}
                </div>
              )}
            </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex justify-between items-start print:hidden">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-black text-slate-800">{po.po_no}</h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${STATUS_COLOR[po.status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              {(po.status || '').replace('_', ' ')}
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase border ${
              po.approval_status === 'approved' ? 'bg-green-100 text-green-700 border-green-200' :
              po.approval_status === 'rejected' ? 'bg-red-100 text-red-600 border-red-200' :
              'bg-yellow-50 text-yellow-700 border-yellow-200'
            }`}>
              {po.approval_status}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Supplier: <b className="text-slate-600">{po.supplier_name}</b>
            {po.outlet_name && <> &nbsp;→&nbsp; <b className="text-slate-600">{po.outlet_name}</b></>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 border border-blue-200 text-blue-700 bg-blue-50 text-sm font-bold rounded-xl hover:bg-blue-100 transition-colors">
            <i className="fas fa-print mr-1.5"></i> Print / PDF
          </button>
          <button
            onClick={() => {
              const url = `${window.location.origin}/po/guest/${po.id}`;
              navigator.clipboard.writeText(url);
              alert('Guest Link copied to clipboard!\nYou can email this link to the supplier.');
            }}
            className="px-4 py-2 border border-slate-200 text-slate-600 bg-white text-sm font-semibold rounded-xl hover:bg-slate-50 transition-colors">
            <i className="fas fa-link mr-1.5"></i> Copy Share Link
          </button>

          {po.status === 'draft' && (
            <button
              onClick={() => navigate(`/purchases/po/edit/${po.id}`)}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-xl transition-colors">
              <i className="fas fa-edit mr-1.5"></i> Edit PO
            </button>
          )}
          {po.approval_status === 'pending' && (
            <>
              <button
                onClick={() => { set_approve_action('approved'); set_show_approve(true) }}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl transition-colors">
                <i className="fas fa-check mr-1.5"></i> Approve
              </button>
              <button
                onClick={() => { set_approve_action('rejected'); set_show_approve(true) }}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl transition-colors">
                <i className="fas fa-times mr-1.5"></i> Reject
              </button>
            </>
          )}
          {(po.approval_status === 'approved' || po.status === 'approved' || po.status === 'partial') && po.status !== 'cancelled' && (
            <button
              onClick={() => navigate(`/purchases/grn?action=new&po_id=${po.id}`)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-sm transition-colors flex items-center">
              <i className="fas fa-truck-loading mr-1.5"></i> Process Inward / GRN
            </button>
          )}
          <button onClick={() => set_new_item(true)} title="Item not in the master? Request it against this PO"
            className="px-4 py-2 border border-indigo-200 text-indigo-700 text-sm font-semibold rounded-xl hover:bg-indigo-50 transition-colors">
            <i className="fas fa-plus mr-1" /> New Item
          </button>
          <button
            onClick={() => navigate('/purchases/po')}
            className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-50 transition-colors">
            ← Back
          </button>
        </div>
      </div>

      {new_item && <NewItemRequest purchaseRef={po.po_no} supplierId={(po as any).supplier_id} onClose={() => set_new_item(false)} />}
      <div className="print:hidden"><PoEmailPanel poId={po.id} approved={po.approval_status === 'approved'} /></div>

      {/* Approve modal */}
      {show_approve && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h2 className="font-bold text-slate-800 mb-4">
              {approve_action === 'approved' ? '✅ Approve PO' : '❌ Reject PO'}
            </h2>
            <textarea
              value={remarks}
              onChange={e => set_remarks(e.target.value)}
              rows={3}
              placeholder="Remarks (optional for approval, required for rejection)…"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
            {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => set_show_approve(false)}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-sm rounded-xl hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={do_approve} disabled={approving}
                className={`px-5 py-2 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 ${
                  approve_action === 'approved' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-500 hover:bg-red-600'
                }`}>
                {approving ? '…' : approve_action === 'approved' ? 'Confirm Approve' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 print:hidden">
        {[
          { label: 'PO Date',        value: fmt_date(po.po_date) },
          { label: 'Expected',       value: fmt_date(po.expected_date) },
          { label: 'Lead Days',      value: `${po.delivery_days}d` },
          { label: 'Total Items',    value: (po.items || []).length },
          { label: 'Grand Total',    value: fmt_amt(grand_total) },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-slate-100 px-4 py-3 shadow-sm">
            <div className="text-[10px] uppercase text-slate-400 font-semibold">{c.label}</div>
            <div className="text-lg font-black text-slate-800 mt-0.5">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Items table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden print:shadow-none  print:rounded-none">
        <div className="bg-slate-800 text-white px-4 py-2.5 font-bold text-sm flex items-center gap-2 print:hidden">
          <span>📦</span> Order Items
          <span className="bg-white/20 text-xs px-2 py-0.5 rounded-full">{(po.items || []).length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-blue-600 border-b border-blue-700 text-white">
              <tr>
                <th className="px-4 py-2 text-left print:px-2 print:w-[5%]">#</th>
                <th className="px-4 py-2 text-left print:px-2 print:w-[45%]">Item</th>
                <th className="px-3 py-2 text-center print:hidden">SOH</th>
                <th className="px-3 py-2 text-center print:hidden">DOH</th>
                <th className="px-3 py-2 text-center print:hidden">7d Sale</th>
                <th className="px-3 py-2 text-center print:hidden">30d Sale</th>
                <th className="px-3 py-2 text-center print:hidden">Avg/Day</th>
                <th className="px-3 py-2 text-center print:hidden">Suggested</th>
                <th className="px-3 py-2 text-center font-bold print:px-2">Ordered</th>
                <th className="px-3 py-2 text-center print:px-2">GST%</th>
                <th className="px-3 py-2 text-right print:px-2">Rate</th>
                <th className="px-3 py-2 text-right font-bold print:px-2">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(po.items || []).map((item, idx) => {
                const amt = Number(item.order_qty) * Number(item.rate)
                return (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-400 font-mono print:px-2 ">{idx + 1}</td>
                    <td className="px-4 py-2.5 print:px-2 ">
                      <div className="font-semibold text-slate-800">{item.product_name}</div>
                      <div className="text-slate-400 font-mono text-[10px] ">
                        {item.item_code} {item.hsn_code ? ` | HSN: ${item.hsn_code}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center font-bold text-blue-700 bg-blue-50/30 print:hidden">
                      {Number(item.warehouse_stock).toFixed(0)}
                    </td>
                    <td className="px-3 py-2.5 text-center print:hidden">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${doh_class(item.doh_value ? Number(item.doh_value) : null)}`}>
                        {item.doh_value ? `${Number(item.doh_value).toFixed(1)}d` : 'N/A'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-500 print:hidden">{Number(item.sale_7d).toFixed(1)}</td>
                    <td className="px-3 py-2.5 text-center text-slate-500 print:hidden">{Number(item.sale_30d).toFixed(1)}</td>
                    <td className="px-3 py-2.5 text-center text-cyan-700 print:hidden">{Number(item.avg_daily_sale).toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-center text-amber-700 font-bold print:hidden">
                      {Number(item.suggested_qty).toFixed(0)}
                    </td>
                    <td className="px-3 py-2.5 text-center font-black text-slate-800 text-sm">
                      {Number(item.order_qty).toFixed(0)}
                    </td>
                    <td className="px-3 py-2.5 text-center text-slate-500">{Number(item.gst_percent)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-700">
                      {fmt_amt(Number(item.rate))}
                    </td>
                    <td className="px-3 py-2.5 text-right font-black font-mono text-slate-800">
                      {fmt_amt(amt)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-slate-50 border-t-2 border-slate-200 ">
              <tr>
                <td colSpan={11} className="px-4 py-2 text-right font-bold text-slate-500 print:hidden">Subtotal (Taxable):</td>
                <td colSpan={5} className="px-4 py-2 text-right font-bold text-slate-500 hidden print:table-cell ">Subtotal (Taxable):</td>
                <td className="px-3 py-2 text-right font-bold font-mono text-slate-600">
                  {fmt_amt(total_taxable)}
                </td>
              </tr>
              {Object.entries(tax_summary).map(([pct, vals]) => {
                if (is_igst) {
                  return (
                    <tr key={pct}>
                      <td colSpan={11} className="px-4 py-1 text-right text-xs text-slate-500 print:hidden">IGST @ {pct}%:</td>
                      <td colSpan={5} className="px-4 py-1 text-right text-xs text-slate-500 hidden print:table-cell ">IGST @ {pct}%:</td>
                      <td className="px-3 py-1 text-right font-mono text-slate-600">{fmt_amt(vals.tax)}</td>
                    </tr>
                  )
                } else {
                  return (
                    <tr key={pct}>
                      <td colSpan={11} className="px-4 py-1 text-right text-xs text-slate-500 print:hidden">
                        <div className="flex justify-end gap-4">
                          <span>CGST @ {Number(pct)/2}%: <span className="font-mono">{fmt_amt(vals.tax/2)}</span></span>
                          <span>SGST @ {Number(pct)/2}%: <span className="font-mono">{fmt_amt(vals.tax/2)}</span></span>
                        </div>
                      </td>
                      <td colSpan={5} className="px-4 py-1 text-right text-xs text-slate-500 hidden print:table-cell ">
                        <div className="flex justify-end gap-4">
                          <span>CGST @ {Number(pct)/2}%: <span className="font-mono">{fmt_amt(vals.tax/2)}</span></span>
                          <span>SGST @ {Number(pct)/2}%: <span className="font-mono">{fmt_amt(vals.tax/2)}</span></span>
                        </div>
                      </td>
                      <td className="px-3 py-1 text-right font-mono text-slate-600">{fmt_amt(vals.tax)}</td>
                    </tr>
                  )
                }
              })}
              <tr className="border-t border-slate-200">
                <td colSpan={11} className="px-4 py-2.5 text-right font-bold text-slate-800 print:hidden">Grand Total:</td>
                <td colSpan={5} className="px-4 py-2.5 text-right font-bold text-slate-800 hidden print:table-cell ">Grand Total:</td>
                <td className="px-3 py-2.5 text-right font-black text-lg text-red-600 font-mono ">
                  {fmt_amt(grand_total)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Distributions */}
      {po.is_master && po.distributions && po.distributions.length > 0 && (
        <div className="bg-white rounded-xl border border-indigo-200 shadow-sm overflow-hidden print:mt-6 print:border-slate-300 print:shadow-none print:break-inside-avoid">
          <div className="bg-indigo-50 text-indigo-800 px-4 py-2.5 font-bold text-sm flex items-center gap-2 border-b border-indigo-100 print:bg-slate-100 print:text-slate-800 print:border-slate-300">
            <span className="print:hidden">🏢</span> Outlet Distributions Allocation
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 print:grid-cols-2 print:gap-4">
            {po.distributions.map(dist => (
              <div key={dist.id} className="border border-slate-100 rounded-xl p-3 shadow-sm bg-slate-50 relative print:border-slate-300 print:bg-white print:shadow-none print:break-inside-avoid">
                <div className="absolute top-2 right-2 text-[10px] font-bold text-indigo-500 bg-indigo-100 px-2 py-0.5 rounded-full">
                  {dist.child_po_id ? 'PO Generated' : 'Pending'}
                </div>
                <div className="font-bold text-slate-700 text-sm">{dist.outlet_name}</div>
                <div className="text-xs text-slate-500 mt-1">
                  Child PO: {dist.child_po_id ? <Link to={`/purchases/po/${dist.child_po_id}`} className="text-indigo-600 hover:underline">View PO #{dist.child_po_id}</Link> : '—'}
                </div>
                <div className="mt-3">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">Item Allocation</div>
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1 print:max-h-none print:overflow-visible">
                    {dist.details.map((dtl: any) => {
                      const item = (po.items || []).find(i => i.product_id === dtl.product_id);
                      return (
                        <div key={dtl.id} className="flex justify-between text-xs bg-white border border-slate-100 px-2 py-1 rounded">
                          <span className="truncate pr-2">{item?.product_name || `Product #${dtl.product_id}`}</span>
                          <span className="font-bold">{dtl.qty}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Terms & Conditions */}
      {(po.terms_conditions || []).length > 0 && (
        <div className="bg-white rounded-xl border border-yellow-200 shadow-sm p-4">
          <div className="text-xs font-bold text-slate-500 uppercase mb-3">📋 Terms & Conditions</div>
          <div className="space-y-2">
            {[...(po.terms_conditions || [])]
              .sort((a, b) => a.sequence_no - b.sequence_no)
              .map(t => (
                <div key={t.id}
                  className={`border-l-4 px-3 py-2 rounded-r text-xs ${
                    t.term_type === 'FIXED'
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-green-400 bg-green-50'
                  }`}>
                  <b className={t.term_type === 'FIXED' ? 'text-blue-700' : 'text-green-700'}>
                    {t.term_type === 'FIXED' ? '🔒' : '✏️'} {t.title}
                  </b>
                  {t.description && <span className="text-slate-600 ml-1">— {t.description}</span>}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {po.notes && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4   print:mt-4">
          <div className="text-xs font-bold text-slate-500 uppercase mb-2 ">📝 Notes</div>
          <p className="text-sm text-slate-600 whitespace-pre-wrap ">{po.notes}</p>
        </div>
      )}

      {/* Audit log */}
      {(po.audit_logs || []).length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 print:hidden">
          <div className="text-xs font-bold text-slate-500 uppercase mb-3">🕐 Activity Log</div>
          <div className="relative pl-4">
            <div className="absolute left-0 top-0 bottom-0 w-px bg-slate-200"></div>
            {(po.audit_logs || []).map(log => (
              <div key={log.id} className="mb-3 relative">
                <div className="absolute -left-4 top-0.5 w-2 h-2 rounded-full bg-blue-400 border-2 border-white"></div>
                <div className="ml-2">
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-2">
                    {log.action}
                    {log.old_status && log.new_status && (
                      <span className="text-slate-400 font-normal">
                        {log.old_status} → {log.new_status}
                      </span>
                    )}
                  </div>
                  {log.description && (
                    <div className="text-xs text-slate-500 mt-0.5">{log.description}</div>
                  )}
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmt_dt(log.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
