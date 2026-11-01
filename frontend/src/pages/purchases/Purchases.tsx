import { useEffect, useState, useRef } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import {
  purchases_api,
  type purchase_list_item,
  type purchase_detail,
  type purchase_create_payload,
  type purchase_item_payload,
  type po_list_item,
} from '../../api/purchases'
import { suppliers_api } from '../../api/suppliers'
import { masters_api } from '../../api/masters'
import { products_api, type product_search_item } from '../../api/products'
import { getCompanySettings, type CompanySettings } from '../../api/company'

const PAYMENT_BADGE: Record<string, string> = {
  cash:   'bg-green-100 text-green-700 border-green-200',
  credit: 'bg-blue-100 text-blue-700 border-blue-200',
  upi:    'bg-purple-100 text-purple-700 border-purple-200',
  cheque: 'bg-amber-100 text-amber-700 border-amber-200',
  bank:   'bg-cyan-100 text-cyan-700 border-cyan-200',
}

function fmt(n: number | string, dec = 2) {
  return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

function fmt_date(s?: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

interface InwardItemRow extends purchase_item_payload {
  product_name: string
  mrp?: number
}

export default function Purchases() {
  const navigate = useNavigate()
  const location = useLocation()
  const { id: paramId } = useParams<{ id?: string }>()

  // List state
  const [rows, set_rows] = useState<purchase_list_item[]>([])
  const [loading, set_loading] = useState(true)
  const [total, set_total] = useState(0)
  const [page, set_page] = useState(1)
  const [err, set_err] = useState('')
  const [search, set_search] = useState('')
  const [statusFilter, set_statusFilter] = useState('')
  const per_page = 20

  // Masters
  const [suppliers, set_suppliers] = useState<{ id: number; name: string }[]>([])
  const [outlets, set_outlets] = useState<{ id: number; outlet_name: string }[]>([])
  const [company, set_company] = useState<CompanySettings | null>(null)

  // New Inward modal state
  const [showNewModal, set_showNewModal] = useState(false)
  const [submitting, set_submitting] = useState(false)
  const [selectedSupplierId, set_selectedSupplierId] = useState<number | ''>('')
  const [selectedOutletId, set_selectedOutletId] = useState<number | ''>('')
  const [invoiceNo, set_invoiceNo] = useState('')
  const [invoiceDate, set_invoiceDate] = useState(new Date().toISOString().slice(0, 10))
  const [paymentMode, set_paymentMode] = useState('credit')
  const [headerDiscount, set_headerDiscount] = useState('0')
  const [paidAmount, set_paidAmount] = useState('0')
  const [inwardNotes, set_inwardNotes] = useState('')
  const [inwardItems, set_inwardItems] = useState<InwardItemRow[]>([])

  // Invoice validation state
  const [invoiceError, setInvoiceError] = useState<string | null>(null)
  const [checkingInvoice, setCheckingInvoice] = useState(false)
  const invoiceInputRef = useRef<HTMLInputElement>(null)

  // Check duplicate invoice for supplier
  const handleCheckInvoice = async (val: string, suppId?: number | '') => {
    const raw = (val || '').trim()
    const sid = suppId !== undefined ? suppId : selectedSupplierId
    if (!raw) {
      setInvoiceError('Supplier Invoice # is mandatory. Blank invoice numbers are not allowed.')
      return false
    }
    if (!sid) {
      setInvoiceError(null)
      return true
    }
    try {
      setCheckingInvoice(true)
      const res = await purchases_api.check_invoice(Number(sid), raw)
      if (res.data?.is_duplicate) {
        setInvoiceError(res.data.message || 'This invoice number already exists for this supplier!')
        return false
      }
      setInvoiceError(null)
      return true
    } catch {
      return true
    } finally {
      setCheckingInvoice(false)
    }
  }

  // PO Import state
  const [approvedPOs, set_approvedPOs] = useState<po_list_item[]>([])
  const [loadingPOs, set_loadingPOs] = useState(false)
  const [selectedPOId, set_selectedPOId] = useState<number | ''>('')

  // Product search state for Inward
  const [searchQuery, set_searchQuery] = useState('')
  const [searchResults, set_searchResults] = useState<product_search_item[]>([])
  const [searchingProducts, set_searchingProducts] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // GRN View modal state
  const [viewingGrn, set_viewingGrn] = useState<purchase_detail | null>(null)
  const [loadingGrnDetail, set_loadingGrnDetail] = useState(false)

  // 1. Initial Load of Masters & Company
  useEffect(() => {
    suppliers_api.list({ per_page: 500 })
      .then(r => set_suppliers((r.data.data || []).map((s: any) => ({ id: s.id, name: s.name }))))
      .catch(() => {})

    masters_api.get_outlets()
      .then(r => set_outlets(r.data || []))
      .catch(() => {})

    getCompanySettings()
      .then(r => set_company(r))
      .catch(() => {})
  }, [])

  // 2. Load GRN list
  const loadList = () => {
    set_loading(true)
    purchases_api.list_grn({ page, per_page, status: statusFilter || undefined, search: search.trim() || undefined })
      .then(r => {
        set_rows(r.data.data || [])
        set_total(r.data.total || 0)
      })
      .catch(() => set_err('Failed to load GRN registry'))
      .finally(() => set_loading(false))
  }

  useEffect(() => {
    const t = setTimeout(loadList, search ? 350 : 0)   // server search: GRN no / last 4 digits / supplier / PO / item
    return () => clearTimeout(t)
  }, [page, statusFilter, search])

  // 3. Handle query params (e.g. ?action=new or ?po_id=...) or route :id
  useEffect(() => {
    const qParams = new URLSearchParams(location.search)
    if (qParams.get('action') === 'new') {
      set_showNewModal(true)
      const poId = qParams.get('po_id')
      if (poId) {
        handleLoadFromPO(Number(poId))
      }
    }

    const qId = qParams.get('id')
    if (qId) {
      openGrnDetail(Number(qId))
    }

    if (paramId) {
      openGrnDetail(Number(paramId))
    }
  }, [location.search, paramId, location.pathname])

  // 4. Fetch approved POs when supplier changes
  useEffect(() => {
    if (!selectedSupplierId) {
      set_approvedPOs([])
      return
    }
    set_loadingPOs(true)
    purchases_api.list_pos({ supplier_id: Number(selectedSupplierId), status: 'approved', per_page: 50 })
      .then(r => set_approvedPOs(r.data.data || []))
      .catch(() => set_approvedPOs([]))
      .finally(() => set_loadingPOs(false))
  }, [selectedSupplierId])

  // 5. Product instant search
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      set_searchResults([])
      return
    }
    const t = setTimeout(() => {
      set_searchingProducts(true)
      products_api.search(searchQuery.trim(), 15)
        .then(r => set_searchResults(r.data || []))
        .catch(() => set_searchResults([]))
        .finally(() => set_searchingProducts(false))
    }, 250)
    return () => clearTimeout(t)
  }, [searchQuery])

  // Add product to inward list
  const addProductToInward = (p: product_search_item) => {
    const exists = inwardItems.find(i => i.product_id === p.id)
    if (exists) {
      set_inwardItems(inwardItems.map(i =>
        i.product_id === p.id ? { ...i, qty: Number(i.qty) + 1 } : i
      ))
      toast.success(`Increased qty for ${p.name}`)
    } else {
      const price = Number(p.mrp || 0) > 0 ? (Number(p.mrp) * 0.8) : 100 // fallback default cost
      const gst = Number(p.gst_percent || 0)
      set_inwardItems(prev => [
        ...prev,
        {
          product_id: p.id,
          product_name: p.name,
          item_code: p.item_code || '',
          qty: 1,
          pcs: 0,
          unit: p.unit || 'PCS',
          price: Math.round(price * 100) / 100,
          disc_val: 0,
          disc_type: 'INR',
          gst_percent: gst,
          hsn_code: p.hsn_code || '',
          mrp: Number(p.mrp || 0),
        }
      ])
      toast.success(`Added ${p.name}`)
    }
    set_searchQuery('')
    set_searchResults([])
    searchInputRef.current?.focus()
  }

  // Handle loading lines from an approved PO
  const handleLoadFromPO = async (poId: number) => {
    try {
      toast.loading('Fetching PO details…', { id: 'po-fetch' })
      const res = await purchases_api.get_po(poId)
      const po = res.data
      toast.dismiss('po-fetch')

      if (po.supplier_id) set_selectedSupplierId(po.supplier_id)
      if (po.outlet_id) set_selectedOutletId(po.outlet_id)
      if (po.vendor_invoice_no) set_invoiceNo(po.vendor_invoice_no)
      if (po.vendor_invoice_date) set_invoiceDate(po.vendor_invoice_date)
      set_inwardNotes(`Inward against PO #${po.po_no}`)
      set_selectedPOId(po.id)

      const items: InwardItemRow[] = (po.items || []).map(it => ({
        product_id: it.product_id,
        product_name: it.product_name || `Item #${it.product_id}`,
        item_code: it.item_code || '',
        qty: Math.max(0, Number(it.order_qty) - Number(it.received_qty || 0)) || Number(it.order_qty) || 1,
        pcs: 0,
        unit: it.base_unit || 'PCS',
        price: Number(it.rate || 0),
        disc_val: 0,
        disc_type: 'INR',
        gst_percent: Number(it.gst_percent || 0),
        hsn_code: it.hsn_code || '',
        mrp: Number(it.mrp || 0),
      }))

      set_inwardItems(items)
      toast.success(`Imported ${items.length} items from PO ${po.po_no}`)
    } catch (err: any) {
      toast.dismiss('po-fetch')
      toast.error('Failed to import PO details')
    }
  }

  // Update item field in Inward grid
  const updateItem = (index: number, field: keyof InwardItemRow, value: any) => {
    set_inwardItems(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const removeItem = (index: number) => {
    set_inwardItems(prev => prev.filter((_, i) => i !== index))
  }

  // Computed Totals for New Inward
  const subtotal = inwardItems.reduce((acc, it) => {
    const basic = Math.max(0, (Number(it.qty) * Number(it.price)) - Number(it.disc_val || 0))
    return acc + basic
  }, 0)

  const totalGst = inwardItems.reduce((acc, it) => {
    const basic = Math.max(0, (Number(it.qty) * Number(it.price)) - Number(it.disc_val || 0))
    const gstAmt = (basic * Number(it.gst_percent || 0)) / 100
    return acc + gstAmt
  }, 0)

  const discountNum = Number(headerDiscount || 0)
  const taxableAmount = Math.max(0, subtotal - discountNum)
  const grandTotal = Math.round((taxableAmount + totalGst) * 100) / 100
  const paidNum = Number(paidAmount || 0)
  const dueAmount = Math.max(0, grandTotal - paidNum)

  // Submit Inward Form
  const handleSubmitInward = async (e: React.FormEvent) => {
    e.preventDefault()

    const cleanInvoice = invoiceNo.trim()
    if (!cleanInvoice) {
      setInvoiceError('Supplier Invoice # is mandatory. Blank invoice numbers are not allowed.')
      toast.error('Supplier Invoice # is mandatory. Blank invoices are not allowed.')
      invoiceInputRef.current?.focus()
      return
    }

    if (!selectedSupplierId) {
      toast.error('Please select a supplier')
      return
    }

    if (inwardItems.length === 0) {
      toast.error('Please add at least one item to inward')
      return
    }
    for (const it of inwardItems) {
      if (Number(it.qty) <= 0) {
        toast.error(`Quantity for "${it.product_name}" must be greater than 0`)
        return
      }
      if (Number(it.price) < 0) {
        toast.error(`Price for "${it.product_name}" cannot be negative`)
        return
      }
    }

    // Pre-check duplicate against backend before submitting
    try {
      const chk = await purchases_api.check_invoice(Number(selectedSupplierId), cleanInvoice)
      if (chk.data?.is_duplicate) {
        setInvoiceError(chk.data.message || 'Duplicate invoice detected for this supplier!')
        toast.error(chk.data.message || 'Duplicate invoice detected for this supplier!')
        invoiceInputRef.current?.focus()
        return
      }
    } catch {
      // If check endpoint errors, let the backend POST enforce it
    }

    set_submitting(true)
    try {
      const payload: purchase_create_payload = {
        supplier_id: Number(selectedSupplierId),
        outlet_id: selectedOutletId ? Number(selectedOutletId) : undefined,
        invoice_no: cleanInvoice,
        invoice_date: invoiceDate,
        discount: discountNum,
        paid_amount: paidNum,
        payment_mode: paymentMode,
        notes: inwardNotes.trim() || undefined,
        items: inwardItems.map(it => ({
          product_id: it.product_id,
          item_code: it.item_code,
          qty: Number(it.qty),
          pcs: Number(it.pcs || 0),
          unit: it.unit || 'PCS',
          price: Number(it.price),
          disc_val: Number(it.disc_val || 0),
          disc_type: it.disc_type || 'INR',
          gst_percent: Number(it.gst_percent || 0),
          hsn_code: it.hsn_code,
        }))
      }

      const res = await purchases_api.create_grn(payload)
      toast.success(`GRN ${res.data.purchase_no} created successfully! Stock updated.`)
      
      // Reset form
      set_showNewModal(false)
      set_inwardItems([])
      set_invoiceNo('')
      setInvoiceError(null)
      set_headerDiscount('0')
      set_paidAmount('0')
      set_inwardNotes('')
      set_selectedPOId('')

      // Reload registry
      loadList()

      // Open detail of newly created GRN
      if (res.data.purchase_id) {
        openGrnDetail(res.data.purchase_id)
      }
    } catch (err: any) {
      const msg = err.response?.data?.detail || err.message || 'Failed to create GRN'
      toast.error(msg)
      if (typeof msg === 'string' && (msg.toLowerCase().includes('invoice') || msg.toLowerCase().includes('duplicate'))) {
        setInvoiceError(msg)
        invoiceInputRef.current?.focus()
      }
    } finally {
      set_submitting(false)
    }
  }

  // Open GRN Details
  const openGrnDetail = async (grnId: number) => {
    set_loadingGrnDetail(true)
    try {
      const res = await purchases_api.get_grn(grnId)
      set_viewingGrn(res.data)
    } catch (err: any) {
      toast.error('Failed to load GRN details')
    } finally {
      set_loadingGrnDetail(false)
    }
  }

  // Filtered rows for client search
  const filteredRows = rows   // filtered on the server (GRN no / last digits / supplier / PO / item)

  const total_pages = Math.ceil(total / per_page)

  return (
    <div className="p-4 space-y-4">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2 text-slate-800">
            <span className="bg-slate-900 text-white p-2 rounded-lg flex items-center justify-center">
              <i className="fas fa-truck-loading text-sm"></i>
            </span>
            Goods Receipt Note (GRN) — Inward Registry
          </h1>
          <p className="text-xs text-slate-500 font-medium mt-1">
            Receive stock from suppliers, record vendor bills, and update inventory
          </p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <button
            onClick={() => navigate('/purchases/po')}
            className="flex-1 sm:flex-none border border-slate-200 text-slate-700 font-semibold py-2 px-4 rounded-xl text-xs hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 shadow-sm"
          >
            <i className="fas fa-file-invoice text-xs"></i> Purchase Orders
          </button>
          <button
            onClick={() => navigate('/purchases/grn/new')}
            className="flex-1 sm:flex-none bg-blue-700 hover:bg-blue-800 text-white font-bold py-2 px-5 rounded-xl shadow transition-colors text-xs flex items-center justify-center gap-1.5"
          >
            <i className="fas fa-plus text-xs"></i> + New Purchase Entry (GRN)
          </button>
        </div>
      </div>

      {/* ── Filters & Search ── */}
      <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {['', 'received', 'partial', 'draft'].map(st => (
            <button
              key={st}
              onClick={() => { set_statusFilter(st); set_page(1) }}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                statusFilter === st
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {st === '' ? 'All Status' : st.toUpperCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 w-full sm:w-72">
          <div className="relative w-full">
            <i className="fas fa-search absolute left-3 top-2.5 text-slate-400 text-xs"></i>
            <input
              type="text"
              placeholder="GRN # or last 4 digits, supplier, PO, item…"
              value={search}
              onChange={e => set_search(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={loadList}
            title="Refresh List"
            className="p-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-50 text-xs"
          >
            <i className={`fas fa-sync-alt ${loading ? 'animate-spin' : ''}`}></i>
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-xs px-4 py-2.5 rounded-xl flex items-center justify-between">
          <span>{err}</span>
          <button onClick={loadList} className="underline font-bold text-xs">Retry</button>
        </div>
      )}

      {/* ── Registry Table ── */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#1e293b] text-white uppercase text-[11px] tracking-wider">
              <tr>
                <th className="px-4 py-3">GRN #</th>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Invoice #</th>
                <th className="px-4 py-3">Invoice Date</th>
                <th className="px-4 py-3 text-right">Subtotal</th>
                <th className="px-4 py-3 text-right">GST</th>
                <th className="px-4 py-3 text-right">Grand Total</th>
                <th className="px-4 py-3 text-right">Due Balance</th>
                <th className="px-4 py-3 text-center">Payment</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-slate-400">
                    <i className="fas fa-spinner fa-spin mr-2 text-lg"></i> Loading GRN registry…
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-16 text-center text-slate-400">
                    <div className="text-4xl mb-2">📦</div>
                    <p className="font-semibold text-slate-600 text-sm">No GRN Inward records found</p>
                    <p className="text-xs text-slate-400 mt-1">Click "New Inward" above to receive goods into stock.</p>
                    <button
                      onClick={() => navigate('/purchases/grn/new')}
                      className="mt-3 bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-4 rounded-lg text-xs"
                    >
                      <i className="fas fa-plus mr-1"></i> Create Inward Entry
                    </button>
                  </td>
                </tr>
              ) : (
                filteredRows.map(p => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td
                      onClick={() => openGrnDetail(p.id)}
                      className="px-4 py-3 font-bold text-blue-600 hover:underline cursor-pointer font-mono"
                    >
                      {p.purchase_no}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">{p.supplier_name}</td>
                    <td className="px-4 py-3 text-slate-600 font-mono">{p.invoice_no || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{fmt_date(p.invoice_date)}</td>
                    <td className="px-4 py-3 text-right font-mono text-slate-600">{fmt(p.subtotal)}</td>
                    <td className="px-4 py-3 text-right font-mono text-orange-600 font-semibold">{fmt(p.total_gst)}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-slate-900">{fmt(p.total_amount)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-bold ${Number(p.due_amount) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {fmt(p.due_amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase border ${PAYMENT_BADGE[p.payment_mode] || 'bg-slate-100 text-slate-500'}`}>
                        {p.payment_mode}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        p.status === 'received' || p.status === 'paid' ? 'bg-green-100 text-green-700' :
                        p.status === 'partial'  ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-500'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center gap-1.5">
                        <button
                          onClick={() => openGrnDetail(p.id)}
                          className="p-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md transition-colors"
                          title="View GRN Note"
                        >
                          <i className="fas fa-eye text-xs"></i>
                        </button>
                        <button
                          onClick={() => window.open(`/purchases/grn/print/${p.id}`, '_blank')}
                          className="p-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md transition-colors"
                          title="Print GRN Slip (A4 Landscape)"
                        >
                          <i className="fas fa-print text-xs"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {total_pages > 1 && (
          <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>
              Showing {(page - 1) * per_page + 1}–{Math.min(page * per_page, total)} of {total} records
            </span>
            <div className="flex gap-1">
              <button
                disabled={page === 1}
                onClick={() => set_page(p => p - 1)}
                className="px-2.5 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
              >
                ‹ Prev
              </button>
              <span className="px-3 py-1 font-semibold text-slate-700">{page} / {total_pages}</span>
              <button
                disabled={page >= total_pages}
                onClick={() => set_page(p => p + 1)}
                className="px-2.5 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
              >
                Next ›
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── NEW INWARD MODAL / FULL WORKFLOW ─────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {showNewModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-5xl my-auto flex flex-col max-h-[95vh] overflow-hidden">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white px-5 py-3.5 flex justify-between items-center shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="bg-blue-600 text-white w-7 h-7 rounded-lg flex items-center justify-center text-xs">
                  <i className="fas fa-truck-loading"></i>
                </span>
                <div>
                  <h2 className="font-bold text-sm leading-tight">Stock Inward Entry (Create GRN)</h2>
                  <p className="text-[11px] text-slate-400">Receive goods into inventory and generate Goods Receipt Note</p>
                </div>
              </div>
              <button
                onClick={() => set_showNewModal(false)}
                className="text-slate-400 hover:text-white transition-colors w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10"
              >
                <i className="fas fa-times text-sm"></i>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmitInward} className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Header Fields Grid */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                {/* Supplier */}
                <div className="lg:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">
                    Supplier <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={selectedSupplierId}
                    onChange={e => {
                      const newSid = e.target.value ? Number(e.target.value) : ''
                      set_selectedSupplierId(newSid)
                      set_selectedPOId('')
                      if (invoiceNo.trim() && newSid) {
                        handleCheckInvoice(invoiceNo, newSid)
                      }
                    }}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="">-- Select Supplier --</option>
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>

                {/* Pull from approved PO */}
                <div className="lg:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1 flex items-center justify-between">
                    <span>Pull From Approved PO (Optional)</span>
                    {loadingPOs && <span className="text-[10px] text-blue-600 font-normal">Loading POs…</span>}
                  </label>
                  <select
                    value={selectedPOId}
                    onChange={e => {
                      if (e.target.value) handleLoadFromPO(Number(e.target.value))
                    }}
                    disabled={!selectedSupplierId || approvedPOs.length === 0}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">
                      {!selectedSupplierId ? 'Select supplier first' : approvedPOs.length === 0 ? 'No approved POs for this supplier' : '-- Select PO to Auto-Fill Items --'}
                    </option>
                    {approvedPOs.map(po => (
                      <option key={po.id} value={po.id}>
                        {po.po_no} ({fmt_date(po.po_date)}) — {fmt(po.total_amount)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Invoice No */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1 flex items-center justify-between">
                    <span>
                      Supplier Invoice # <span className="text-red-500">*</span>
                    </span>
                    {checkingInvoice && <span className="text-[10px] text-blue-500 font-normal">Checking...</span>}
                  </label>
                  <input
                    ref={invoiceInputRef}
                    type="text"
                    required
                    placeholder="e.g. INV-2026-904"
                    value={invoiceNo}
                    onChange={e => {
                      set_invoiceNo(e.target.value)
                      if (invoiceError) setInvoiceError(null)
                    }}
                    onBlur={e => handleCheckInvoice(e.target.value)}
                    className={`w-full bg-white border rounded-lg px-3 py-2 text-xs focus:ring-2 focus:outline-none ${
                      invoiceError ? 'border-red-500 focus:ring-red-400 bg-red-50/40 text-red-900' : 'border-slate-300 focus:ring-blue-500'
                    }`}
                  />
                  {invoiceError && (
                    <div className="mt-1 text-[11px] font-semibold text-red-600 flex items-start gap-1 leading-tight">
                      <i className="fas fa-exclamation-triangle mt-0.5 shrink-0"></i>
                      <span>{invoiceError}</span>
                    </div>
                  )}
                </div>

                {/* Invoice Date */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Invoice Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={invoiceDate}
                    onChange={e => set_invoiceDate(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>

                {/* Outlet / Store */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Receiving Location</label>
                  <select
                    value={selectedOutletId}
                    onChange={e => set_selectedOutletId(e.target.value ? Number(e.target.value) : '')}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  >
                    <option value="">Head Office / Central Warehouse</option>
                    {outlets.map(o => (
                      <option key={o.id} value={o.id}>{o.outlet_name}</option>
                    ))}
                  </select>
                </div>

                {/* Payment Mode */}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Payment Terms</label>
                  <select
                    value={paymentMode}
                    onChange={e => set_paymentMode(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none font-semibold"
                  >
                    <option value="credit">Credit / Payable</option>
                    <option value="cash">Cash</option>
                    <option value="bank">Bank Transfer / NEFT</option>
                    <option value="upi">UPI</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
              </div>

              {/* ── Product Search Bar ── */}
              <div className="relative">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <i className="fas fa-barcode absolute left-3.5 top-3 text-slate-400 text-sm"></i>
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Scan barcode or search product name / code to add items…"
                      value={searchQuery}
                      onChange={e => set_searchQuery(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 bg-white border-2 border-slate-300 focus:border-blue-600 rounded-xl text-xs font-medium focus:outline-none shadow-xs"
                    />
                    {searchingProducts && (
                      <i className="fas fa-spinner fa-spin absolute right-3.5 top-3 text-slate-400 text-sm"></i>
                    )}
                  </div>
                </div>

                {/* Search Results Dropdown */}
                {searchResults.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-60 overflow-y-auto divide-y divide-slate-100">
                    {searchResults.map(p => (
                      <div
                        key={p.id}
                        onClick={() => addProductToInward(p)}
                        className="p-3 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-colors text-xs"
                      >
                        <div>
                          <p className="font-bold text-slate-800">{p.name}</p>
                          <p className="text-[11px] text-slate-400 font-mono">
                            Code: {p.item_code || '—'} | Barcode: {p.barcode || '—'} | GST: {p.gst_percent || 0}%
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-slate-900">{fmt(p.selling_price || p.mrp || 0)}</p>
                          <span className="text-[10px] text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded font-semibold">
                            + Add Item
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Received Items Table ── */}
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                <div className="bg-slate-100 px-4 py-2 border-b border-slate-200 flex justify-between items-center text-xs font-bold text-slate-700">
                  <span>Received Items ({inwardItems.length})</span>
                  {inwardItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => set_inwardItems([])}
                      className="text-red-600 hover:text-red-700 text-[11px] font-semibold"
                    >
                      Clear All Items
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
                  <table className="w-full text-left text-xs min-w-[750px]">
                    <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold border-b border-slate-200 sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 w-10">#</th>
                        <th className="px-3 py-2">Item Description</th>
                        <th className="px-2 py-2 w-20">Unit</th>
                        <th className="px-2 py-2 w-24 text-right">Qty Received</th>
                        <th className="px-2 py-2 w-28 text-right">Price (Excl. Tax)</th>
                        <th className="px-2 py-2 w-20 text-right">Disc (₹)</th>
                        <th className="px-2 py-2 w-20 text-center">GST %</th>
                        <th className="px-3 py-2 w-28 text-right">Taxable</th>
                        <th className="px-3 py-2 w-28 text-right font-bold">Line Total</th>
                        <th className="px-2 py-2 w-12 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {inwardItems.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-slate-400">
                            <i className="fas fa-boxes text-2xl mb-1 block"></i>
                            No items added yet. Scan or search items above, or pull from an approved PO.
                          </td>
                        </tr>
                      ) : (
                        inwardItems.map((it, idx) => {
                          const basic = Math.max(0, (Number(it.qty) * Number(it.price)) - Number(it.disc_val || 0))
                          const gstAmt = (basic * Number(it.gst_percent || 0)) / 100
                          const lineTotal = basic + gstAmt

                          return (
                            <tr key={`${it.product_id}-${idx}`} className="hover:bg-slate-50">
                              <td className="px-3 py-2 text-slate-400 font-mono text-[11px]">{idx + 1}</td>
                              <td className="px-3 py-2">
                                <div className="font-semibold text-slate-800">{it.product_name}</div>
                                <div className="text-[10px] text-slate-400 font-mono">{it.item_code}</div>
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  type="text"
                                  value={it.unit}
                                  onChange={e => updateItem(idx, 'unit', e.target.value)}
                                  className="w-full border border-slate-200 rounded px-1.5 py-1 text-center text-xs uppercase"
                                />
                              </td>
                              <td className="px-2 py-2 text-right">
                                <input
                                  type="number"
                                  step="any"
                                  min="0.001"
                                  value={it.qty}
                                  onChange={e => updateItem(idx, 'qty', e.target.value)}
                                  className="w-full border border-slate-300 rounded px-2 py-1 text-right text-xs font-bold text-slate-800 focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-2 py-2 text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={it.price}
                                  onChange={e => updateItem(idx, 'price', e.target.value)}
                                  className="w-full border border-slate-300 rounded px-2 py-1 text-right text-xs font-mono focus:ring-1 focus:ring-blue-500"
                                />
                              </td>
                              <td className="px-2 py-2 text-right">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={it.disc_val}
                                  onChange={e => updateItem(idx, 'disc_val', e.target.value)}
                                  className="w-full border border-slate-200 rounded px-1.5 py-1 text-right text-xs font-mono"
                                />
                              </td>
                              <td className="px-2 py-2 text-center">
                                <select
                                  value={it.gst_percent}
                                  onChange={e => updateItem(idx, 'gst_percent', Number(e.target.value))}
                                  className="border border-slate-200 rounded px-1.5 py-1 text-xs"
                                >
                                  <option value={0}>0%</option>
                                  <option value={5}>5%</option>
                                  <option value={12}>12%</option>
                                  <option value={18}>18%</option>
                                  <option value={28}>28%</option>
                                </select>
                              </td>
                              <td className="px-3 py-2 text-right font-mono text-slate-600">
                                {fmt(basic)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">
                                {fmt(lineTotal)}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => removeItem(idx)}
                                  className="text-slate-300 hover:text-red-500 p-1"
                                  title="Remove Item"
                                >
                                  <i className="fas fa-trash-alt text-xs"></i>
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ── Summary & Settlement ── */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Left: Notes */}
                <div className="space-y-2">
                  <label className="block font-semibold text-slate-700">Inward Remarks / Notes</label>
                  <textarea
                    rows={3}
                    placeholder="Enter delivery vehicle number, receiving notes, condition of goods, etc.…"
                    value={inwardNotes}
                    onChange={e => set_inwardNotes(e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none resize-none"
                  />
                </div>

                {/* Right: Financial Totals */}
                <div className="bg-white p-3.5 rounded-lg border border-slate-200/80 space-y-2">
                  <div className="flex justify-between text-slate-600">
                    <span>Subtotal (Taxable):</span>
                    <span className="font-mono font-semibold">{fmt(subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600">
                    <span>Header Discount (₹):</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={headerDiscount}
                      onChange={e => set_headerDiscount(e.target.value)}
                      className="w-24 border border-slate-200 rounded px-2 py-0.5 text-right font-mono text-xs"
                    />
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Total GST:</span>
                    <span className="font-mono font-semibold text-orange-600">{fmt(totalGst)}</span>
                  </div>
                  <div className="border-t border-slate-100 pt-2 flex justify-between text-slate-900 font-bold text-sm">
                    <span>Grand Total:</span>
                    <span className="font-mono text-blue-700">{fmt(grandTotal)}</span>
                  </div>
                  <div className="flex justify-between items-center text-slate-600 pt-1">
                    <span>Paid Amount (₹):</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={paidAmount}
                      onChange={e => set_paidAmount(e.target.value)}
                      className="w-24 border border-slate-200 rounded px-2 py-0.5 text-right font-mono text-xs"
                    />
                  </div>
                  <div className="flex justify-between text-slate-700 font-semibold border-t border-slate-100 pt-1">
                    <span>Balance Due:</span>
                    <span className={`font-mono ${dueAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                      {fmt(dueAmount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Modal Footer Buttons */}
              <div className="pt-2 flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => set_showNewModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-xl text-xs hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || inwardItems.length === 0}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-md transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submitting ? (
                    <>
                      <i className="fas fa-spinner fa-spin"></i> Processing…
                    </>
                  ) : (
                    <>
                      <i className="fas fa-check"></i> Save & Confirm GRN
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* ── GRN DETAIL & PRINT SLIP MODAL ───────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {(viewingGrn || loadingGrnDetail) && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl my-auto flex flex-col max-h-[95vh] overflow-hidden">
            {/* Header / Actions */}
            <div className="bg-slate-900 text-white px-5 py-3.5 flex justify-between items-center shrink-0 print:hidden">
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">Goods Receipt Note: {viewingGrn?.purchase_no || 'Loading…'}</span>
                {viewingGrn?.status && (
                  <span className="bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded-full uppercase font-bold">
                    {viewingGrn.status}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {viewingGrn?.id && (
                  <button
                    onClick={() => window.open(`/purchases/grn/print/${viewingGrn.id}`, '_blank')}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow cursor-pointer"
                    title="Open exact SUPERPROMPT A4 Landscape GRN Print"
                  >
                    <i className="fas fa-print"></i> 🖨 Print GRN (A4)
                  </button>
                )}
                <button
                  onClick={() => window.print()}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow cursor-pointer"
                >
                  <i className="fas fa-print"></i> Quick Print
                </button>
                <button
                  onClick={() => set_viewingGrn(null)}
                  className="text-slate-400 hover:text-white transition-colors w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/10"
                >
                  <i className="fas fa-times text-sm"></i>
                </button>
              </div>
            </div>

            {/* Printable Content */}
            <div className="p-6 overflow-y-auto print:p-0 print:m-0" id="grn-print-slip">
              {loadingGrnDetail ? (
                <div className="py-20 text-center text-slate-400">
                  <i className="fas fa-spinner fa-spin text-2xl mr-2"></i> Loading GRN details…
                </div>
              ) : viewingGrn ? (
                <div className="space-y-5 text-slate-800 text-xs">
                  {/* Top Company & GRN title */}
                  <div className="border-b-2 border-slate-800 pb-4 flex justify-between items-start">
                    <div>
                      {company?.logo_path && (
                        <img
                          src={company.logo_path.startsWith('http') || company.logo_path.startsWith('/') ? company.logo_path : `/${company.logo_path}`}
                          alt="Logo"
                          className="h-12 mb-2 object-contain"
                        />
                      )}
                      <h1 className="text-2xl font-black text-slate-900 tracking-wide uppercase">
                        {company?.brand_name || 'NUTRIBAY'}
                      </h1>
                      <p className="text-slate-500 mt-0.5">{company?.ho_address || 'Central Warehouse & Head Office'}</p>
                      {company?.gstin && <p className="text-slate-500">GSTIN: <span className="font-mono font-bold text-slate-700">{company.gstin}</span></p>}
                    </div>
                    <div className="text-right">
                      <div className="inline-block bg-slate-900 text-white font-black text-sm px-3 py-1 rounded-md uppercase tracking-wider mb-2">
                        GOODS RECEIPT NOTE (GRN)
                      </div>
                      <p className="font-mono font-black text-base text-blue-700">{viewingGrn.purchase_no}</p>
                      <p className="text-slate-500 mt-0.5">Date: <span className="font-semibold text-slate-700">{fmt_date(viewingGrn.created_at)}</span></p>
                    </div>
                  </div>

                  {/* Supplier & Invoice metadata */}
                  <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Supplier Details</p>
                      <p className="font-bold text-sm text-slate-800 mt-0.5">{viewingGrn.supplier_name}</p>
                      <p className="text-slate-500 mt-1">Payment Mode: <span className="font-semibold uppercase">{viewingGrn.payment_mode}</span></p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Vendor Bill Details</p>
                      <p className="font-mono font-bold text-sm text-slate-800 mt-0.5">Invoice: {viewingGrn.invoice_no || '—'}</p>
                      <p className="text-slate-500 mt-1">Invoice Date: <span className="font-semibold">{fmt_date(viewingGrn.invoice_date)}</span></p>
                    </div>
                  </div>

                  {/* Items Table */}
                  <table className="w-full text-left border border-slate-200 text-xs">
                    <thead className="bg-slate-100 text-slate-700 font-bold border-b border-slate-200 uppercase text-[10px]">
                      <tr>
                        <th className="px-3 py-2 w-8">#</th>
                        <th className="px-3 py-2">Item Name & Code</th>
                        <th className="px-3 py-2 w-20 text-center">Unit</th>
                        <th className="px-3 py-2 w-24 text-center">LP Date</th>
                        <th className="px-3 py-2 w-20 text-right">LP Qty</th>
                        <th className="px-3 py-2 w-20 text-right">Sales / LP</th>
                        <th className="px-3 py-2 w-24 text-right">Received Qty</th>
                        <th className="px-3 py-2 w-24 text-right">Rate (₹)</th>
                        <th className="px-3 py-2 w-20 text-center">GST %</th>
                        <th className="px-3 py-2 w-24 text-right">GST (₹)</th>
                        <th className="px-3 py-2 w-28 text-right font-bold">Total (₹)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(viewingGrn.items || []).map((it, idx) => (
                        <tr key={it.id || idx}>
                          <td className="px-3 py-2 text-slate-400 font-mono">{idx + 1}</td>
                          <td className="px-3 py-2">
                            <span className="font-bold text-slate-800">{it.product_name}</span>
                            {it.product_code && <span className="text-slate-400 font-mono block text-[10px]">{it.product_code}</span>}
                            {it.batch_no && (
                              <span className="inline-block mt-0.5 px-1.5 py-0.2 rounded text-[10px] bg-amber-50 text-amber-800 border border-amber-200 font-mono">
                                Batch: {it.batch_no} {it.expiry_date ? `(Exp: ${it.expiry_date})` : ''}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center text-slate-600">{it.unit}</td>
                          <td className="px-3 py-2 text-center font-mono text-[11px] text-blue-700 font-medium">{it.lp_date || '—'}</td>
                          <td className="px-3 py-2 text-right font-mono text-blue-700">{it.lp_qty && it.lp_qty > 0 ? it.lp_qty : '—'}</td>
                          <td className="px-3 py-2 text-right font-mono text-orange-600">{it.sales_since_lp && it.sales_since_lp > 0 ? it.sales_since_lp : (it.sales_lp && it.sales_lp > 0 ? it.sales_lp : '—')}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">{it.qty}</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(it.price)}</td>
                          <td className="px-3 py-2 text-center text-slate-600">{it.gst_percent}%</td>
                          <td className="px-3 py-2 text-right font-mono text-slate-600">{fmt(it.gst_amount)}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{fmt(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 border-t border-slate-200 font-semibold">
                      <tr>
                        <td colSpan={9} className="px-3 py-1.5 text-right text-slate-600">Subtotal:</td>
                        <td colSpan={2} className="px-3 py-1.5 text-right font-mono">{fmt(viewingGrn.subtotal)}</td>
                      </tr>
                      {Number(viewingGrn.discount || 0) > 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-1.5 text-right text-slate-600">Discount:</td>
                          <td colSpan={2} className="px-3 py-1.5 text-right font-mono text-red-600">- {fmt(viewingGrn.discount)}</td>
                        </tr>
                      )}
                      <tr>
                        <td colSpan={6} className="px-3 py-1.5 text-right text-slate-600">Total GST:</td>
                        <td colSpan={2} className="px-3 py-1.5 text-right font-mono text-orange-600">{fmt(viewingGrn.total_gst)}</td>
                      </tr>
                      <tr className="border-t-2 border-slate-800 text-slate-900 font-black text-sm">
                        <td colSpan={6} className="px-3 py-2 text-right">Grand Total:</td>
                        <td colSpan={2} className="px-3 py-2 text-right font-mono text-blue-700">{fmt(viewingGrn.total_amount)}</td>
                      </tr>
                      <tr>
                        <td colSpan={6} className="px-3 py-1.5 text-right text-slate-600">Paid Amount:</td>
                        <td colSpan={2} className="px-3 py-1.5 text-right font-mono text-green-700">{fmt(viewingGrn.paid_amount)}</td>
                      </tr>
                      <tr>
                        <td colSpan={6} className="px-3 py-1.5 text-right text-slate-600">Due Balance:</td>
                        <td colSpan={2} className={`px-3 py-1.5 text-right font-mono ${Number(viewingGrn.due_amount) > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                          {fmt(viewingGrn.due_amount)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  {viewingGrn.notes && (
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <p className="font-bold text-slate-700 text-[11px] mb-0.5">Remarks / Receiving Notes:</p>
                      <p className="text-slate-600">{viewingGrn.notes}</p>
                    </div>
                  )}

                  {/* Signatures */}
                  <div className="pt-10 grid grid-cols-3 gap-8 text-center text-slate-500 text-[11px]">
                    <div className="border-t border-slate-300 pt-1">Received By / Store Keeper</div>
                    <div className="border-t border-slate-300 pt-1">Quality & Count Verified By</div>
                    <div className="border-t border-slate-300 pt-1">Authorized Signatory</div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
