import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { purchases_api, type po_detail } from '../../api/purchases'
import { getCompanySettings, type CompanySettings } from '../../api/company'
import { QRCodeSVG } from 'qrcode.react'

const STATUS_COLOR: Record<string, string> = {
  draft:            'bg-slate-100 text-slate-600 border-slate-300',
  pending_approval: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  approved:         'bg-green-100 text-green-800 border-green-300',
  partial:          'bg-blue-100 text-blue-800 border-blue-300',
  completed:        'bg-emerald-100 text-emerald-800 border-emerald-300',
  cancelled:        'bg-red-100 text-red-700 border-red-300',
  vendor_invoiced:  'bg-indigo-100 text-indigo-800 border-indigo-300',
}

function fmt_amt(n: number | string, dec = 2) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmt_date(s?: string | null) {
  if (!s) return '-'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmt_dt(s?: string | null) {
  if (!s) return '-'
  return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function POGuestDetail() {
  const { id } = useParams<{ id: string }>()

  const [po, set_po]           = useState<po_detail | null>(null)
  const [loading, set_loading] = useState(true)
  const [err, set_err] = useState('')
  const [company, set_company] = useState<CompanySettings | null>(null)
  const [activeTab, setActiveTab] = useState<'details' | 'allocations' | 'invoice'>('details')

  // Invoice Form State
  const [invNo, setInvNo] = useState('')
  const [invDate, setInvDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitMsg, setSubmitMsg] = useState('')

  useEffect(() => {
    if (!id) return
    fetchPO()
  }, [id])

  const fetchPO = () => {
    set_loading(true)
    Promise.all([
      purchases_api.get_guest_po(Number(id)),
      getCompanySettings().catch(() => null)
    ])
      .then(([r, cRes]) => {
        set_po(r.data)
        if (cRes) set_company(cRes)
      })
      .catch(() => set_err('Failed to load PO'))
      .finally(() => set_loading(false))
  }

  const handleInvoiceSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invNo || !invDate) {
      setSubmitMsg('Please provide invoice number and date')
      return
    }
    setSubmitting(true)
    setSubmitMsg('')
    try {
      await purchases_api.submit_vendor_invoice(Number(id), {
        vendor_invoice_no: invNo,
        vendor_invoice_date: invDate,
        vendor_invoice_file: null // Real file upload would go here
      })
      setSubmitMsg('Invoice submitted successfully! Head Office has been notified.')
      fetchPO() // Refresh PO to show updated status
    } catch (e: any) {
      setSubmitMsg(e.response?.data?.detail || 'Failed to submit invoice')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading && !po) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 text-slate-400">
        <i className="fas fa-spinner fa-spin mr-2 text-2xl"></i> Loading Vendor Portal...
      </div>
    )
  }

  if (!po) {
    return (
      <div className="text-center py-20 bg-slate-50 min-h-screen text-slate-400">
        <div className="text-4xl mb-3">⚠️</div>
        {err || 'PO not found'}
      </div>
    )
  }

  const grand_total = (po.items || []).reduce((s, i) => s + Number(i.order_qty) * Number(i.rate), 0)

  return (
    <div className="min-h-screen bg-slate-100 font-sans print:bg-white print:p-0">
      
      {/*  Navbar */}
      <header className="bg-slate-900 text-white sticky top-0 z-40 shadow-md print:hidden">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-500 rounded-lg flex items-center justify-center">
              <i className="fas fa-store text-white"></i>
            </div>
            <div>
              <p className="font-black text-sm tracking-widest">{company?.brand_name || 'NUTRIBRAY'}</p>
              <p className="text-[10px] text-indigo-300 font-medium tracking-widest uppercase">Vendor Portal</p>
            </div>
          </div>
          <div className="flex gap-4">
            <button onClick={() => window.print()} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-bold transition-colors">
              <i className="fas fa-print mr-2"></i>Print PO
            </button>
          </div>
        </div>
      </header>

      {/*  PRINT HEADER (Hidden on Screen) */}
      <div className="hidden print:block mb-6 p-8">
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

        {/* Print Only Order Table */}
        <div className="mt-8">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 border-y-2 border-slate-800">
              <tr>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Item Name</th>
                <th className="px-2 py-2 text-center">Ordered Qty</th>
                <th className="px-2 py-2 text-right">Rate</th>
                <th className="px-2 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(po.items || []).map((item, idx) => {
                const amt = Number(item.order_qty) * Number(item.rate)
                return (
                  <tr key={item.id}>
                    <td className="px-2 py-2">{idx + 1}</td>
                    <td className="px-2 py-2 font-semibold">{item.product_name}</td>
                    <td className="px-2 py-2 text-center font-bold">{Number(item.order_qty).toFixed(0)}</td>
                    <td className="px-2 py-2 text-right">{fmt_amt(Number(item.rate))}</td>
                    <td className="px-2 py-2 text-right font-bold">{fmt_amt(amt)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="border-t-2 border-slate-800">
              <tr>
                <td colSpan={4} className="px-2 py-2 text-right font-bold">Grand Total:</td>
                <td className="px-2 py-2 text-right font-black text-lg">{fmt_amt(grand_total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {po.is_master && (po.distributions || []).length > 0 && (
          <div className="mt-8 border border-slate-300 rounded-xl overflow-hidden print:break-inside-avoid">
            <div className="bg-slate-100 px-4 py-2 font-bold text-sm border-b border-slate-300">
              Outlet Distributions Allocation
            </div>
            <div className="p-4 grid grid-cols-2 gap-4">
              {(po.distributions || []).map(dist => (
                <div key={dist.id} className="border border-slate-300 rounded-lg p-3">
                  <div className="font-bold text-sm mb-2">{dist.outlet_name}</div>
                  {dist.details.map((dtl: any) => {
                    const item = (po.items || []).find(i => i.product_id === dtl.product_id);
                    return (
                      <div key={dtl.id} className="flex justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                        <span className="truncate pr-2">{item?.product_name}</span>
                        <span className="font-bold">{dtl.qty || dtl.allocated_qty}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>


      {/*  Main Dashboard Content */}
      <main className="max-w-6xl mx-auto px-4 py-8 print:hidden">
        
        {/* Banner */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-800 flex items-center gap-3">
              Purchase Order: {po.po_no}
            </h1>
            <p className="text-slate-500 text-sm mt-1">
              Welcome back, <b className="text-slate-700">{po.supplier_name}</b>. Please review your order details below.
            </p>
          </div>
          <div className="flex gap-2">
            <div className={`px-4 py-2 rounded-xl text-sm font-bold uppercase border ${STATUS_COLOR[po.status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              <i className="fas fa-circle text-[8px] mr-2 -translate-y-0.5"></i>
              {(po.status || '').replace('_', ' ')}
            </div>
            {po.vendor_invoice_no && (
              <div className="px-4 py-2 rounded-xl text-sm font-bold uppercase border bg-indigo-100 text-indigo-800 border-indigo-200">
                <i className="fas fa-check-circle mr-1.5"></i> Invoiced
              </div>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">PO Date</span>
            <span className="text-xl font-black text-slate-800">{fmt_date(po.po_date)}</span>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Expected By</span>
            <span className="text-xl font-black text-slate-800">{fmt_date(po.expected_date)}</span>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-center">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Total Items</span>
            <span className="text-xl font-black text-slate-800">{(po.items || []).length} Units</span>
          </div>
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-2xl p-5 shadow-sm shadow-indigo-200 text-white flex flex-col justify-center">
            <span className="text-xs font-bold text-indigo-200 uppercase tracking-wider mb-1">Grand Total</span>
            <span className="text-2xl font-black">{fmt_amt(grand_total)}</span>
          </div>
        </div>

        {/* Custom Tabs */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
          <div className="flex border-b border-slate-200 overflow-x-auto">
            <button 
              onClick={() => setActiveTab('details')}
              className={`px-6 py-4 text-sm font-bold whitespace-nowrap transition-colors ${activeTab === 'details' ? 'border-b-2 border-indigo-600 text-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:bg-slate-50'}`}>
              <i className="fas fa-box-open mr-2"></i>Order Details
            </button>
            {po.is_master && (
              <button 
                onClick={() => setActiveTab('allocations')}
                className={`px-6 py-4 text-sm font-bold whitespace-nowrap transition-colors ${activeTab === 'allocations' ? 'border-b-2 border-indigo-600 text-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:bg-slate-50'}`}>
                <i className="fas fa-map-marked-alt mr-2"></i>Delivery Allocations
              </button>
            )}
            <button 
              onClick={() => setActiveTab('invoice')}
              className={`px-6 py-4 text-sm font-bold whitespace-nowrap transition-colors ${activeTab === 'invoice' ? 'border-b-2 border-indigo-600 text-indigo-600 bg-indigo-50/50' : 'text-slate-500 hover:bg-slate-50'}`}>
              <i className="fas fa-file-invoice-dollar mr-2"></i>Submit Invoice (GRN)
            </button>
          </div>

          <div className="p-0">
            {/* TAB: Order Details */}
            {activeTab === 'details' && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">Item</th>
                      <th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase">Ordered Qty</th>
                      <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase">Rate</th>
                      <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(po.items || []).map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-800">{item.product_name}</div>
                          <div className="text-xs text-slate-400 font-mono mt-0.5">{item.item_code}</div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="inline-block px-3 py-1 bg-slate-100 text-slate-700 font-black rounded-lg">
                            {Number(item.order_qty).toFixed(0)}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-slate-600">{fmt_amt(Number(item.rate))}</td>
                        <td className="px-6 py-4 text-right font-black text-slate-800">{fmt_amt(Number(item.order_qty) * Number(item.rate))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* TAB: Allocations */}
            {activeTab === 'allocations' && po.is_master && (po.distributions || []).length > 0 && (
              <div className="p-6 bg-slate-50">
                <div className="mb-6 flex items-center gap-3 bg-blue-50 border border-blue-200 p-4 rounded-xl text-blue-800">
                  <i className="fas fa-info-circle text-xl"></i>
                  <p className="text-sm">This is a multi-outlet order. Please review the specific quantities to be delivered to each location below.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {(po.distributions || []).map(dist => (
                    <div key={dist.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                      <div className="bg-slate-800 px-5 py-3 text-white font-bold flex justify-between items-center">
                        <span className="truncate">{dist.outlet_name}</span>
                        <i className="fas fa-store opacity-50"></i>
                      </div>
                      <div className="p-5">
                        <div className="space-y-3">
                          {dist.details.map((dtl: any) => {
                            const item = (po.items || []).find(i => i.product_id === dtl.product_id);
                            return (
                              <div key={dtl.id} className="flex justify-between items-center text-sm border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                                <span className="text-slate-600 truncate pr-4">{item?.product_name}</span>
                                <span className="font-black text-slate-800 bg-slate-100 px-2 py-0.5 rounded">{dtl.qty || dtl.allocated_qty}</span>
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

            {/* TAB: Submit Invoice */}
            {activeTab === 'invoice' && (
              <div className="p-6 sm:p-10">
                {po.vendor_invoice_no ? (
                  <div className="text-center py-10">
                    <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                      <i className="fas fa-check text-4xl"></i>
                    </div>
                    <h3 className="text-2xl font-black text-slate-800 mb-2">Invoice Submitted</h3>
                    <p className="text-slate-500 mb-6">You have successfully submitted the invoice for this Purchase Order.</p>
                    <div className="inline-flex flex-col items-start bg-slate-50 border border-slate-200 rounded-xl p-5 text-left max-w-sm mx-auto">
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Invoice Number</div>
                      <div className="text-lg font-black text-slate-800 mb-4">{po.vendor_invoice_no}</div>
                      
                      <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Invoice Date</div>
                      <div className="text-lg font-black text-slate-800">{fmt_date(po.vendor_invoice_date)}</div>
                    </div>
                  </div>
                ) : (
                  <div className="max-w-2xl mx-auto">
                    <div className="mb-8">
                      <h3 className="text-2xl font-black text-slate-800 mb-2">Submit Invoice for GRN</h3>
                      <p className="text-slate-500 text-sm">Please provide your invoice details. Once submitted, Head Office will process your GRN (Goods Receipt Note) and proceed with payment clearance.</p>
                    </div>

                    <form onSubmit={handleInvoiceSubmit} className="space-y-6">
                      {submitMsg && (
                        <div className={`p-4 rounded-xl text-sm font-bold ${submitMsg.includes('success') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                          {submitMsg}
                        </div>
                      )}
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">Invoice Number <span className="text-red-500">*</span></label>
                          <input 
                            type="text" 
                            required
                            value={invNo}
                            onChange={(e) => setInvNo(e.target.value)}
                            placeholder="e.g. INV-2026-001"
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-bold text-slate-700 mb-2">Invoice Date <span className="text-red-500">*</span></label>
                          <input 
                            type="date" 
                            required
                            value={invDate}
                            onChange={(e) => setInvDate(e.target.value)}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-bold text-slate-700 mb-2">Upload Bill / Invoice (Optional)</label>
                        <div className="border-2 border-dashed border-slate-300 bg-slate-50 rounded-xl p-8 text-center hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer transition-colors">
                          <i className="fas fa-cloud-upload-alt text-4xl text-slate-400 mb-3"></i>
                          <p className="text-slate-600 font-semibold text-sm">Click to browse or drag file here</p>
                          <p className="text-slate-400 text-xs mt-1">PDF, JPG or PNG (Max 5MB)</p>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-slate-200 flex justify-end">
                        <button 
                          type="submit" 
                          disabled={submitting || po.status === 'draft'}
                          className={`px-8 py-3 rounded-xl font-bold text-white transition-all shadow-sm ${submitting || po.status === 'draft' ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-md'}`}>
                          {submitting ? (
                            <><i className="fas fa-spinner fa-spin mr-2"></i>Submitting...</>
                          ) : (
                            <><i className="fas fa-paper-plane mr-2"></i>Submit Invoice</>
                          )}
                        </button>
                      </div>
                      {po.status === 'draft' && (
                        <p className="text-xs text-red-500 text-right mt-2">Invoices can only be submitted for approved orders.</p>
                      )}
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
