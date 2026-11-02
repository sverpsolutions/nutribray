import { useState, useEffect } from 'react'
import {
  Building2, ShoppingCart, Truck, TrendingUp, Sparkles, User,
  CheckCircle2, XCircle, AlertCircle, Clock, Search, Filter,
  ArrowRight, Calendar, Package, FileText, Check, ChevronRight,
  ExternalLink, Send, ShieldAlert, BarChart3, RefreshCw,
  RotateCcw, CreditCard, Receipt, FileCheck, Printer, Download,
  Wallet, Eye
} from 'lucide-react'
import { vendor_portal_api, type VendorDashboardData } from '../../api/vendorPortal'
import toast from 'react-hot-toast'
import Modal from '../../components/ui/Modal'

type PortalTab =
  | 'dashboard'
  | 'pos'
  | 'grns'
  | 'prns'
  | 'cheques'
  | 'ledger'
  | 'invoices'
  | 'sales'
  | 'item_requests'
  | 'profile'

export default function VendorPortal() {
  const [activeTab, setActiveTab] = useState<PortalTab>('dashboard')
  const [dashboardData, setDashboardData] = useState<VendorDashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  // POs state
  const [pos, setPos] = useState<any[]>([])
  const [poFilter, setPoFilter] = useState('')
  const [selectedPo, setSelectedPo] = useState<any>(null)
  const [poDetailModal, setPoDetailModal] = useState(false)
  const [ackModal, setAckModal] = useState(false)
  const [ackExpectedDate, setAckExpectedDate] = useState('')
  const [ackRemarks, setAckRemarks] = useState('')
  const [savingAck, setSavingAck] = useState(false)

  // GRNs state
  const [grns, setGrns] = useState<any[]>([])
  const [grnFilter, setGrnFilter] = useState('')
  const [selectedGrn, setSelectedGrn] = useState<any>(null)
  const [grnDetailModal, setGrnDetailModal] = useState(false)

  // PRNs state
  const [prns, setPrns] = useState<any[]>([])
  const [prnFilter, setPrnFilter] = useState('')
  const [selectedPrn, setSelectedPrn] = useState<any>(null)
  const [prnDetailModal, setPrnDetailModal] = useState(false)
  const [prnAckModal, setPrnAckModal] = useState(false)
  const [prnAckRemarks, setPrnAckRemarks] = useState('')
  const [savingPrnAck, setSavingPrnAck] = useState(false)

  // Cheques state
  const [cheques, setCheques] = useState<any[]>([])
  const [chequeStatusFilter, setChequeStatusFilter] = useState<string>('all')

  // Payments & Ledger state
  const [ledgerData, setLedgerData] = useState<any>(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [payments, setPayments] = useState<any[]>([])
  const [ledgerSubTab, setLedgerSubTab] = useState<'statement' | 'payments'>('statement')

  // Invoices state
  const [invoices, setInvoices] = useState<any[]>([])
  const [invoiceFilter, setInvoiceFilter] = useState('')

  // Sales state
  const [salesData, setSalesData] = useState<any>(null)
  const [salesDisabled, setSalesDisabled] = useState(false)
  const [salesLoading, setSalesLoading] = useState(false)

  // Item Requests state
  const [itemRequests, setItemRequests] = useState<any[]>([])
  const [newItemModal, setNewItemModal] = useState(false)
  const [newItemForm, setNewItemForm] = useState({
    product_name: '',
    brand_name: '',
    category_name: '',
    barcode: '',
    vendor_item_code: '',
    unit: 'PCS',
    pack_size: '',
    purchase_rate: '',
    mrp: '',
    proposed_selling_price: '',
    gst_percent: '18',
    hsn_code: '',
    moq: '1',
    lead_time_days: '7',
    country_of_origin: 'India',
    description: '',
    vendor_remarks: '',
  })
  const [savingItemReq, setSavingItemReq] = useState(false)

  // Profile update request modal
  const [profileData, setProfileData] = useState<any>(null)
  const [profileModal, setProfileModal] = useState(false)
  const [profileChanges, setProfileChanges] = useState({
    contact_name: '',
    phone: '',
    email: '',
    address: '',
    bank_name: '',
    account_no: '',
    ifsc_code: '',
    branch: '',
  })
  const [savingProfileReq, setSavingProfileReq] = useState(false)

  // Load initial dashboard
  const fetchDashboard = async () => {
    try {
      setLoading(true)
      const res = await vendor_portal_api.get_dashboard()
      setDashboardData(res.data)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to load vendor portal')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboard()
  }, [])

  // Lazy tab data loaders
  useEffect(() => {
    if (activeTab === 'pos') {
      vendor_portal_api.list_purchase_orders().then((r) => setPos(r.data.items || []))
    } else if (activeTab === 'grns') {
      vendor_portal_api.list_grns().then((r) => setGrns(r.data.items || []))
    } else if (activeTab === 'prns') {
      vendor_portal_api.list_prns().then((r) => setPrns(r.data.items || []))
    } else if (activeTab === 'cheques') {
      vendor_portal_api.list_cheques().then((r) => setCheques(r.data || []))
    } else if (activeTab === 'ledger') {
      setLedgerLoading(true)
      Promise.all([
        vendor_portal_api.get_ledger(),
        vendor_portal_api.list_payments()
      ])
        .then(([lRes, pRes]) => {
          setLedgerData(lRes.data)
          setPayments(pRes.data || [])
        })
        .catch((err) => {
          toast.error(err.response?.data?.detail || 'Failed to load ledger')
        })
        .finally(() => setLedgerLoading(false))
    } else if (activeTab === 'invoices') {
      vendor_portal_api.list_invoices().then((r) => setInvoices(r.data || []))
    } else if (activeTab === 'sales') {
      setSalesLoading(true)
      vendor_portal_api.get_item_sales()
        .then((r) => {
          setSalesData(r.data)
          setSalesDisabled(false)
        })
        .catch((err) => {
          if (err.response?.status === 403) {
            setSalesDisabled(true)
          } else {
            toast.error('Failed to load item sales')
          }
        })
        .finally(() => setSalesLoading(false))
    } else if (activeTab === 'item_requests') {
      vendor_portal_api.list_item_requests().then((r) => setItemRequests(r.data || []))
    } else if (activeTab === 'profile') {
      vendor_portal_api.get_profile().then((r) => {
        setProfileData(r.data)
        setProfileChanges({
          contact_name: r.data.contact_name || '',
          phone: r.data.phone || '',
          email: r.data.email || '',
          address: r.data.address || '',
          bank_name: r.data.financial?.bank_name || '',
          account_no: r.data.financial?.account_no || '',
          ifsc_code: r.data.financial?.ifsc_code || '',
          branch: r.data.financial?.branch || '',
        })
      })
    }
  }, [activeTab])

  // Acknowledge PO
  const handleAcknowledgePo = async () => {
    if (!selectedPo) return
    setSavingAck(true)
    try {
      await vendor_portal_api.acknowledge_purchase_order(selectedPo.id, {
        vendor_expected_delivery: ackExpectedDate || undefined,
        vendor_delivery_remarks: ackRemarks || undefined,
      })
      toast.success(`PO #${selectedPo.po_no} acknowledged successfully`)
      setAckModal(false)
      const res = await vendor_portal_api.list_purchase_orders()
      setPos(res.data.items || [])
    } catch (err: any) {
      toast.error('Failed to acknowledge PO')
    } finally {
      setSavingAck(false)
    }
  }

  // Acknowledge PRN
  const handleAcknowledgePrn = async () => {
    if (!selectedPrn) return
    setSavingPrnAck(true)
    try {
      await vendor_portal_api.acknowledge_prn(selectedPrn.id, {
        vendor_remarks: prnAckRemarks || undefined,
      })
      toast.success(`PRN #${selectedPrn.return_no} acknowledged successfully`)
      setPrnAckModal(false)
      const res = await vendor_portal_api.list_prns()
      setPrns(res.data.items || [])
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to acknowledge PRN')
    } finally {
      setSavingPrnAck(false)
    }
  }

  // Submit New Item Request
  const handleSubmitNewItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItemForm.product_name) {
      toast.error('Please enter product name')
      return
    }
    setSavingItemReq(true)
    try {
      await vendor_portal_api.submit_item_request({
        product_name: newItemForm.product_name,
        brand_name: newItemForm.brand_name || undefined,
        category_name: newItemForm.category_name || undefined,
        barcode: newItemForm.barcode || undefined,
        vendor_item_code: newItemForm.vendor_item_code || undefined,
        unit: newItemForm.unit,
        pack_size: newItemForm.pack_size || undefined,
        purchase_rate: Number(newItemForm.purchase_rate) || 0,
        mrp: Number(newItemForm.mrp) || 0,
        proposed_selling_price: Number(newItemForm.proposed_selling_price) || Number(newItemForm.mrp) || 0,
        gst_percent: Number(newItemForm.gst_percent) || 0,
        hsn_code: newItemForm.hsn_code || undefined,
        moq: Number(newItemForm.moq) || 1,
        lead_time_days: Number(newItemForm.lead_time_days) || 7,
        country_of_origin: newItemForm.country_of_origin || 'India',
        description: newItemForm.description || undefined,
        vendor_remarks: newItemForm.vendor_remarks || undefined,
      })
      toast.success('New item proposal submitted for review!')
      setNewItemModal(false)
      const res = await vendor_portal_api.list_item_requests()
      setItemRequests(res.data || [])
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to submit proposal')
    } finally {
      setSavingItemReq(false)
    }
  }

  // Submit Profile Changes
  const handleSubmitProfileChanges = async () => {
    setSavingProfileReq(true)
    try {
      const changes: Record<string, any> = {}
      if (profileChanges.contact_name !== profileData?.contact_name) {
        changes.contact_name = { old: profileData?.contact_name, new: profileChanges.contact_name }
      }
      if (profileChanges.phone !== profileData?.phone) {
        changes.phone = { old: profileData?.phone, new: profileChanges.phone }
      }
      if (profileChanges.email !== profileData?.email) {
        changes.email = { old: profileData?.email, new: profileChanges.email }
      }
      if (profileChanges.address !== profileData?.address) {
        changes.address = { old: profileData?.address, new: profileChanges.address }
      }
      if (profileChanges.bank_name !== profileData?.financial?.bank_name) {
        changes.bank_name = { old: profileData?.financial?.bank_name, new: profileChanges.bank_name }
      }
      if (profileChanges.account_no !== profileData?.financial?.account_no) {
        changes.account_no = { old: profileData?.financial?.account_no, new: profileChanges.account_no }
      }
      if (profileChanges.ifsc_code !== profileData?.financial?.ifsc_code) {
        changes.ifsc_code = { old: profileData?.financial?.ifsc_code, new: profileChanges.ifsc_code }
      }
      if (profileChanges.branch !== profileData?.financial?.branch) {
        changes.branch = { old: profileData?.financial?.branch, new: profileChanges.branch }
      }

      if (Object.keys(changes).length === 0) {
        toast.error('No changes detected to submit')
        setSavingProfileReq(false)
        return
      }

      await vendor_portal_api.submit_profile_update_request(changes)
      toast.success('Profile changes submitted for company approval')
      setProfileModal(false)
      const r = await vendor_portal_api.get_profile()
      setProfileData(r.data)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to submit profile update')
    } finally {
      setSavingProfileReq(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Connecting to Vendor Portal…</p>
      </div>
    )
  }

  const supplier = dashboardData?.supplier
  const kpis = dashboardData?.kpis
  const perms = supplier?.portal_permissions || {}

  // Filter navigation items according to portal permissions
  const allNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: Building2, show: true },
    { id: 'pos', label: 'Purchase Orders', icon: ShoppingCart, show: perms.view_orders !== false },
    { id: 'grns', label: 'GRN Receipts', icon: Truck, show: perms.view_grn !== false },
    { id: 'prns', label: 'PRN Returns', icon: RotateCcw, show: perms.view_prn !== false },
    { id: 'cheques', label: 'Cheques', icon: CreditCard, show: perms.view_cheques !== false },
    { id: 'ledger', label: 'Payments & Ledger', icon: Receipt, show: perms.view_ledger !== false },
    { id: 'invoices', label: 'Invoices', icon: FileCheck, show: perms.view_invoices !== false },
    { id: 'sales', label: 'Item Sales', icon: TrendingUp, show: perms.view_sales === true || supplier?.portal_sales_enabled },
    { id: 'item_requests', label: 'Propose Items', icon: Sparkles, show: perms.propose_items !== false },
    { id: 'profile', label: 'My Profile', icon: User, show: true },
  ]
  const portalNav = allNavItems.filter((i) => i.show)

  // Filtered lists
  const filteredPos = pos.filter((p) => {
    if (!poFilter) return true
    return (
      p.po_no?.toLowerCase().includes(poFilter.toLowerCase()) ||
      p.status?.toLowerCase().includes(poFilter.toLowerCase())
    )
  })

  const filteredGrns = grns.filter((g) => {
    if (!grnFilter) return true
    return (
      g.purchase_no?.toLowerCase().includes(grnFilter.toLowerCase()) ||
      g.invoice_no?.toLowerCase().includes(grnFilter.toLowerCase())
    )
  })

  const filteredPrns = prns.filter((r) => {
    if (!prnFilter) return true
    return (
      r.return_no?.toLowerCase().includes(prnFilter.toLowerCase()) ||
      r.reference_no?.toLowerCase().includes(prnFilter.toLowerCase()) ||
      r.reason?.toLowerCase().includes(prnFilter.toLowerCase())
    )
  })

  const filteredCheques = cheques.filter((c) => {
    if (chequeStatusFilter === 'all') return true
    return c.status?.toLowerCase() === chequeStatusFilter.toLowerCase()
  })

  const filteredInvoices = invoices.filter((inv) => {
    if (!invoiceFilter) return true
    return (
      inv.invoice_no?.toLowerCase().includes(invoiceFilter.toLowerCase()) ||
      inv.purchase_no?.toLowerCase().includes(invoiceFilter.toLowerCase())
    )
  })

  return (
    <div className="space-y-6 pb-12 max-w-7xl mx-auto">
      {/* Top Welcome Card */}
      <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-900 rounded-2xl p-6 text-white shadow-xl print:hidden">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="space-y-1">
            <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-blue-500/20 text-blue-300 border border-blue-400/30">
              Nutribray Partner Portal
            </span>
            <h1 className="text-2xl font-black tracking-tight">{supplier?.name}</h1>
            <p className="text-xs text-blue-200/80 flex items-center gap-3 flex-wrap">
              <span>Code: <strong className="text-white">{supplier?.supplier_code || 'MB-VND'}</strong></span>
              {supplier?.gst_number && <span>• GSTIN: <strong className="text-white">{supplier.gst_number}</strong></span>}
              <span>• Type: {supplier?.supplier_type}</span>
              {kpis?.outstanding_balance !== undefined && (
                <span className="bg-white/10 px-2 py-0.5 rounded text-[11px] font-bold text-emerald-300">
                  Balance: ₹{Number(kpis.outstanding_balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setNewItemModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black bg-blue-500 hover:bg-blue-400 text-white transition-all shadow-lg shadow-blue-500/30"
            >
              <Sparkles className="w-4 h-4" />
              Propose New Item
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className="px-4 py-2.5 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/20 transition-all"
            >
              Update Profile
            </button>
          </div>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-1.5 flex gap-1 overflow-x-auto print:hidden">
        {portalNav.map((t) => {
          const Icon = t.icon
          const isActive = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as PortalTab)}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ── TAB: DASHBOARD ──────────────────────────────────────────────────── */}
      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Primary KPI Cards Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div
              onClick={() => setActiveTab('pos')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-blue-400 cursor-pointer transition-all"
            >
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Orders</span>
              <p className="text-2xl font-black text-slate-800 mt-1">{kpis?.total_pos || 0}</p>
              <span className="text-[10px] text-blue-600 font-bold mt-1 block">
                {kpis?.open_pos || 0} Open / In-Progress →
              </span>
            </div>

            <div
              onClick={() => setActiveTab('grns')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-emerald-400 cursor-pointer transition-all"
            >
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Goods Received (GRN)</span>
              <p className="text-2xl font-black text-emerald-600 mt-1">{kpis?.total_grns || 0}</p>
              <span className="text-[10px] text-slate-400 mt-1 block">Inward Receipts →</span>
            </div>

            <div
              onClick={() => setActiveTab('prns')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-rose-400 cursor-pointer transition-all"
            >
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Purchase Returns (PRN)</span>
              <p className="text-2xl font-black text-rose-600 mt-1">{kpis?.total_prns || 0}</p>
              <span className="text-[10px] text-slate-400 mt-1 block">Returns & Replacements →</span>
            </div>

            <div
              onClick={() => setActiveTab('ledger')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-400 cursor-pointer transition-all"
            >
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Outstanding Balance</span>
              <p className="text-2xl font-black text-slate-900 mt-1">
                ₹{Number(kpis?.outstanding_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <span className="text-[10px] text-emerald-600 font-bold mt-1 block">View Ledger & Statements →</span>
            </div>
          </div>

          {/* Secondary KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div
              onClick={() => setActiveTab('cheques')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-amber-400 cursor-pointer transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Cheques Issued</span>
                  <p className="text-xl font-black text-slate-900 mt-1">{kpis?.total_cheques || 0}</p>
                </div>
                <CreditCard className="w-6 h-6 text-amber-500 opacity-80" />
              </div>
            </div>

            <div
              onClick={() => setActiveTab('ledger')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-blue-400 cursor-pointer transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Payments (DR)</span>
                  <p className="text-xl font-black text-slate-900 mt-1">
                    ₹{Number(kpis?.total_payments || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
                  </p>
                </div>
                <Wallet className="w-6 h-6 text-emerald-500 opacity-80" />
              </div>
            </div>

            <div
              onClick={() => setActiveTab('item_requests')}
              className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm hover:border-blue-400 cursor-pointer transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Pending Proposals</span>
                  <p className="text-xl font-black text-slate-900 mt-1">{kpis?.pending_item_requests || 0} items</p>
                </div>
                <Sparkles className="w-6 h-6 text-blue-500 opacity-80" />
              </div>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Active Catalog</span>
                  <p className="text-xl font-black text-slate-900 mt-1">{kpis?.supplied_items_count || 0} items</p>
                </div>
                <Package className="w-6 h-6 text-indigo-500 opacity-80" />
              </div>
            </div>
          </div>

          {/* Recent Orders, GRNs, PRNs, and Cheques Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Recent Orders */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Recent Purchase Orders</h3>
                <button onClick={() => setActiveTab('pos')} className="text-xs text-blue-600 font-bold hover:underline">
                  View All →
                </button>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {(!dashboardData?.recent_pos || dashboardData.recent_pos.length === 0) ? (
                  <p className="p-6 text-center text-slate-400">No recent orders</p>
                ) : (
                  dashboardData.recent_pos.map((p) => (
                    <div key={p.id} className="p-4 hover:bg-slate-50 flex items-center justify-between">
                      <div>
                        <span className="font-mono font-bold text-blue-600">{p.po_no}</span>
                        <p className="text-slate-400 text-[10px] mt-0.5">{p.po_date} • {p.items_count} items</p>
                      </div>
                      <div className="text-right">
                        <span className="font-black text-slate-900 block">₹{Number(p.total_amount || 0).toFixed(2)}</span>
                        <span className="text-[10px] font-bold uppercase text-slate-500">{p.status}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent GRNs */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Recent Goods Received (GRN)</h3>
                <button onClick={() => setActiveTab('grns')} className="text-xs text-blue-600 font-bold hover:underline">
                  View All →
                </button>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {(!dashboardData?.recent_grns || dashboardData.recent_grns.length === 0) ? (
                  <p className="p-6 text-center text-slate-400">No recent GRNs</p>
                ) : (
                  dashboardData.recent_grns.map((g) => (
                    <div key={g.id} className="p-4 hover:bg-slate-50 flex items-center justify-between">
                      <div>
                        <span className="font-mono font-bold text-slate-800">{g.purchase_no}</span>
                        <p className="text-slate-400 text-[10px] mt-0.5">Inv: {g.invoice_no || '—'} • {g.invoice_date}</p>
                      </div>
                      <div className="text-right">
                        <span className="font-black text-slate-900 block">₹{Number(g.total_amount || 0).toFixed(2)}</span>
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                          POSTED
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent PRNs (Returns) */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Recent Purchase Returns (PRN)</h3>
                <button onClick={() => setActiveTab('prns')} className="text-xs text-rose-600 font-bold hover:underline">
                  View All →
                </button>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {(!dashboardData?.recent_prns || dashboardData.recent_prns.length === 0) ? (
                  <p className="p-6 text-center text-slate-400">No purchase returns recorded</p>
                ) : (
                  dashboardData.recent_prns.map((r) => (
                    <div key={r.id} className="p-4 hover:bg-slate-50 flex items-center justify-between">
                      <div>
                        <span className="font-mono font-bold text-rose-600">{r.return_no}</span>
                        <p className="text-slate-400 text-[10px] mt-0.5">{r.return_date} • {r.reason || 'Return'}</p>
                      </div>
                      <div className="text-right">
                        <span className="font-black text-slate-900 block">₹{Number(r.total_amount || 0).toFixed(2)}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          r.vendor_ack ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {r.vendor_ack ? 'ACKNOWLEDGED' : 'PENDING ACK'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Recent Cheques */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">Recent Cheques Issued</h3>
                <button onClick={() => setActiveTab('cheques')} className="text-xs text-blue-600 font-bold hover:underline">
                  View All →
                </button>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {(!dashboardData?.recent_cheques || dashboardData.recent_cheques.length === 0) ? (
                  <p className="p-6 text-center text-slate-400">No cheques issued recently</p>
                ) : (
                  dashboardData.recent_cheques.map((c) => (
                    <div key={c.id} className="p-4 hover:bg-slate-50 flex items-center justify-between">
                      <div>
                        <span className="font-mono font-bold text-slate-900">Cheque {c.cheque_no}</span>
                        <p className="text-slate-400 text-[10px] mt-0.5">{c.bank_name || 'Bank'} • {c.cheque_date}</p>
                      </div>
                      <div className="text-right">
                        <span className="font-black text-slate-900 block">₹{Number(c.amount || 0).toFixed(2)}</span>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          c.status === 'cleared'
                            ? 'bg-emerald-100 text-emerald-800'
                            : c.status === 'bounced'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {c.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: PURCHASE ORDERS ─────────────────────────────────────────────── */}
      {activeTab === 'pos' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center flex-wrap gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Approved Purchase Orders</h3>
              <p className="text-xs text-slate-500">Official POs dispatched by Nutribray purchasing department</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search PO # or status…"
                  value={poFilter}
                  onChange={(e) => setPoFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <span className="text-xs text-slate-400 font-bold">{filteredPos.length} Orders</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">PO Number</th>
                  <th className="px-6 py-3">PO Date</th>
                  <th className="px-6 py-3">Expected Date</th>
                  <th className="px-6 py-3">Ordered / Received</th>
                  <th className="px-6 py-3 text-right">PO Total</th>
                  <th className="px-6 py-3 text-center">Your Ack</th>
                  <th className="px-6 py-3 text-center">Order Status</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredPos.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">No purchase orders found</td></tr>
                ) : (
                  filteredPos.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 font-mono font-bold text-blue-600">{p.po_no}</td>
                      <td className="px-6 py-3 text-slate-600">{p.po_date}</td>
                      <td className="px-6 py-3 text-slate-600">{p.expected_date || '—'}</td>
                      <td className="px-6 py-3 text-slate-700">
                        <span className="font-bold text-slate-900">{p.total_received_qty}</span> / {p.total_ordered_qty} units
                      </td>
                      <td className="px-6 py-3 text-right font-bold text-slate-900">₹{Number(p.total_amount || 0).toFixed(2)}</td>
                      <td className="px-6 py-3 text-center">
                        {p.vendor_ack ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            ACKNOWLEDGED
                          </span>
                        ) : perms.acknowledge_orders !== false ? (
                          <button
                            onClick={() => {
                              setSelectedPo(p)
                              setAckExpectedDate(p.expected_date || '')
                              setAckRemarks('')
                              setAckModal(true)
                            }}
                            className="px-2.5 py-1 bg-amber-500 text-white rounded text-[10px] font-bold hover:bg-amber-600"
                          >
                            Acknowledge
                          </button>
                        ) : (
                          <span className="text-slate-400 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
                          {p.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={() => {
                            setSelectedPo(p)
                            setPoDetailModal(true)
                          }}
                          className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-bold"
                        >
                          View Items
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: GRN RECEIPTS ────────────────────────────────────────────────── */}
      {activeTab === 'grns' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center flex-wrap gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Goods Received Notes (GRN)</h3>
              <p className="text-xs text-slate-500">Official posted inventory receipts verified at Nutribray receiving docks</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search GRN # or invoice…"
                  value={grnFilter}
                  onChange={(e) => setGrnFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <span className="text-xs text-slate-400 font-bold">{filteredGrns.length} Receipts</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">GRN Number</th>
                  <th className="px-6 py-3">Invoice # / Date</th>
                  <th className="px-6 py-3">Total Qty Received</th>
                  <th className="px-6 py-3 text-right">Taxable Value</th>
                  <th className="px-6 py-3 text-right">Total Amount</th>
                  <th className="px-6 py-3 text-center">Receipt Status</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredGrns.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-slate-400">No GRN receipts found</td></tr>
                ) : (
                  filteredGrns.map((g) => (
                    <tr key={g.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 font-mono font-bold text-slate-900">{g.purchase_no}</td>
                      <td className="px-6 py-3 text-slate-700">
                        {g.invoice_no || '—'} <span className="text-slate-400">({g.invoice_date})</span>
                      </td>
                      <td className="px-6 py-3 text-slate-800 font-bold">{g.total_qty} units</td>
                      <td className="px-6 py-3 text-right font-mono">₹{Number(g.taxable_amount || 0).toFixed(2)}</td>
                      <td className="px-6 py-3 text-right font-mono font-bold text-slate-900">₹{Number(g.total_amount || 0).toFixed(2)}</td>
                      <td className="px-6 py-3 text-center">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800">
                          {g.status}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={() => {
                            setSelectedGrn(g)
                            setGrnDetailModal(true)
                          }}
                          className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold"
                        >
                          View Items & Batches
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: PRN RETURNS (NEW!) ─────────────────────────────────────────── */}
      {activeTab === 'prns' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center flex-wrap gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Purchase Return Notes (PRN)</h3>
              <p className="text-xs text-slate-500">Official goods returned to supplier due to expiry, damages, or discrepancies</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search PRN # or reason…"
                  value={prnFilter}
                  onChange={(e) => setPrnFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <span className="text-xs text-slate-400 font-bold">{filteredPrns.length} PRNs</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">PRN Number</th>
                  <th className="px-6 py-3">Return Date</th>
                  <th className="px-6 py-3">Ref Invoice #</th>
                  <th className="px-6 py-3">Return Reason</th>
                  <th className="px-6 py-3 text-right">Items Returned</th>
                  <th className="px-6 py-3 text-right">Debit Amount</th>
                  <th className="px-6 py-3 text-center">Your Ack</th>
                  <th className="px-6 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredPrns.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">No purchase returns recorded</td></tr>
                ) : (
                  filteredPrns.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 font-mono font-bold text-rose-600">{r.return_no}</td>
                      <td className="px-6 py-3 text-slate-600">{r.return_date}</td>
                      <td className="px-6 py-3 text-slate-600 font-mono">{r.reference_no || '—'}</td>
                      <td className="px-6 py-3 text-slate-700">{r.reason || 'Inventory Return'}</td>
                      <td className="px-6 py-3 text-right font-bold text-slate-800">{r.total_qty || r.items?.length || 0} units</td>
                      <td className="px-6 py-3 text-right font-mono font-bold text-rose-700">₹{Number(r.total_amount || 0).toFixed(2)}</td>
                      <td className="px-6 py-3 text-center">
                        {r.vendor_ack ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                            ACKNOWLEDGED
                          </span>
                        ) : perms.acknowledge_prn !== false ? (
                          <button
                            onClick={() => {
                              setSelectedPrn(r)
                              setPrnAckRemarks('')
                              setPrnAckModal(true)
                            }}
                            className="px-2.5 py-1 bg-amber-500 text-white rounded text-[10px] font-bold hover:bg-amber-600"
                          >
                            Acknowledge
                          </button>
                        ) : (
                          <span className="text-slate-400 text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-right">
                        <button
                          onClick={() => {
                            setSelectedPrn(r)
                            setPrnDetailModal(true)
                          }}
                          className="px-3 py-1 bg-rose-50 text-rose-700 hover:bg-rose-100 rounded-lg font-bold"
                        >
                          View Return Items
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: CHEQUES (NEW!) ──────────────────────────────────────────────── */}
      {activeTab === 'cheques' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex justify-between items-center flex-wrap gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Cheque Management</h3>
              <p className="text-xs text-slate-500">Track cheques issued by Nutribray finance department for your payments</p>
            </div>
            {/* Status Filter Tabs */}
            <div className="flex gap-1 bg-slate-100 p-1 rounded-lg">
              {['all', 'issued', 'cleared', 'bounced'].map((st) => (
                <button
                  key={st}
                  onClick={() => setChequeStatusFilter(st)}
                  className={`px-3 py-1 rounded text-xs font-bold uppercase transition-all ${
                    chequeStatusFilter === st
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-3 text-xs text-amber-900 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Bank cheque numbers are masked (e.g. ****1234) for financial confidentiality and fraud protection.</span>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3">Cheque Number</th>
                    <th className="px-6 py-3">Cheque Date</th>
                    <th className="px-6 py-3">Bank Name & Branch</th>
                    <th className="px-6 py-3 text-right">Amount (₹)</th>
                    <th className="px-6 py-3 text-center">Clearing Status</th>
                    <th className="px-6 py-3">Clearing Date</th>
                    <th className="px-6 py-3">Remarks / Voucher</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredCheques.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-8 text-slate-400">No cheques found matching filter</td></tr>
                  ) : (
                    filteredCheques.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-3 font-mono font-bold text-slate-900">{c.cheque_no}</td>
                        <td className="px-6 py-3 text-slate-600">{c.cheque_date}</td>
                        <td className="px-6 py-3 text-slate-800">
                          {c.bank_name || 'Bank'} {c.branch && <span className="text-slate-400">({c.branch})</span>}
                        </td>
                        <td className="px-6 py-3 text-right font-mono font-bold text-slate-900">
                          ₹{Number(c.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-6 py-3 text-center">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            c.status === 'cleared'
                              ? 'bg-emerald-100 text-emerald-800'
                              : c.status === 'bounced'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-slate-600">{c.clearing_date || '—'}</td>
                        <td className="px-6 py-3 text-slate-500 font-mono text-[11px]">{c.remarks || c.voucher_no || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: PAYMENTS & LEDGER (NEW!) ───────────────────────────────────── */}
      {activeTab === 'ledger' && (
        <div className="space-y-6">
          {/* Summary Balance Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Opening Balance</span>
              <p className="text-2xl font-black text-slate-800 mt-1">
                ₹{Number(ledgerData?.opening_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <span className="text-[10px] text-slate-400 mt-1 block">Account Start</span>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Invoiced (CR)</span>
              <p className="text-2xl font-black text-blue-600 mt-1">
                ₹{Number(ledgerData?.total_purchases || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <span className="text-[10px] text-blue-500 mt-1 block">GRN Receipts</span>
            </div>

            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Paid & Returns (DR)</span>
              <p className="text-2xl font-black text-emerald-600 mt-1">
                ₹{Number((ledgerData?.total_payments || 0) + (ledgerData?.total_returns || 0)).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <span className="text-[10px] text-slate-400 mt-1 block">Payments + PRNs</span>
            </div>

            <div className="bg-slate-900 text-white p-5 rounded-xl shadow-md">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Net Outstanding Balance</span>
              <p className="text-2xl font-black text-emerald-400 mt-1">
                ₹{Number(ledgerData?.closing_balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
              </p>
              <span className="text-[10px] text-slate-400 mt-1 block">Payable by Nutribray</span>
            </div>
          </div>

          {/* Sub Navigation & Print Button */}
          <div className="flex justify-between items-center flex-wrap gap-4 print:hidden">
            <div className="flex gap-2">
              <button
                onClick={() => setLedgerSubTab('statement')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  ledgerSubTab === 'statement'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Running Account Statement
              </button>
              <button
                onClick={() => setLedgerSubTab('payments')}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  ledgerSubTab === 'payments'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                Payment Vouchers ({payments.length})
              </button>
            </div>

            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Statement
            </button>
          </div>

          {ledgerLoading ? (
            <div className="p-12 text-center text-slate-400">Loading ledger statement…</div>
          ) : ledgerSubTab === 'statement' ? (
            /* Running Statement Table */
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                <span className="text-xs font-bold text-slate-700">Chronological Ledger Statement</span>
                <span className="text-xs text-slate-400 font-mono">Statement as of {new Date().toLocaleDateString('en-IN')}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-700 uppercase font-bold text-left">
                    <tr>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Type</th>
                      <th className="px-5 py-3">Ref / Doc #</th>
                      <th className="px-5 py-3">Particulars</th>
                      <th className="px-5 py-3 text-right">Debit (₹)</th>
                      <th className="px-5 py-3 text-right">Credit (₹)</th>
                      <th className="px-5 py-3 text-right">Balance (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {/* Opening balance row */}
                    <tr className="bg-slate-50/50 font-bold">
                      <td className="px-5 py-3 text-slate-500">—</td>
                      <td className="px-5 py-3 text-slate-500 uppercase text-[10px]">OPENING</td>
                      <td className="px-5 py-3 font-mono text-slate-500">—</td>
                      <td className="px-5 py-3 text-slate-800">Opening Balance Brought Forward</td>
                      <td className="px-5 py-3 text-right font-mono text-slate-400">—</td>
                      <td className="px-5 py-3 text-right font-mono text-slate-400">—</td>
                      <td className="px-5 py-3 text-right font-mono text-slate-900 font-black">
                        ₹{Number(ledgerData?.opening_balance || 0).toFixed(2)}
                      </td>
                    </tr>

                    {(!ledgerData?.transactions || ledgerData.transactions.length === 0) ? (
                      <tr><td colSpan={7} className="text-center py-6 text-slate-400">No transactions recorded</td></tr>
                    ) : (
                      ledgerData.transactions.map((tx: any, idx: number) => (
                        <tr key={idx} className="hover:bg-slate-50/50">
                          <td className="px-5 py-3 text-slate-600">{tx.date}</td>
                          <td className="px-5 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              tx.type === 'PURCHASE'
                                ? 'bg-blue-100 text-blue-800'
                                : tx.type === 'RETURN'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}>
                              {tx.type}
                            </span>
                          </td>
                          <td className="px-5 py-3 font-mono font-bold text-slate-800">{tx.ref_no}</td>
                          <td className="px-5 py-3 text-slate-700">{tx.particulars}</td>
                          <td className="px-5 py-3 text-right font-mono text-rose-600 font-bold">
                            {tx.debit > 0 ? `₹${Number(tx.debit).toFixed(2)}` : '—'}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-blue-600 font-bold">
                            {tx.credit > 0 ? `₹${Number(tx.credit).toFixed(2)}` : '—'}
                          </td>
                          <td className="px-5 py-3 text-right font-mono font-black text-slate-900">
                            ₹{Number(tx.balance).toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* Payments Vouchers Table */
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">Payment Date</th>
                      <th className="px-6 py-3">Voucher #</th>
                      <th className="px-6 py-3">Payment Mode</th>
                      <th className="px-6 py-3">Reference / Cheque #</th>
                      <th className="px-6 py-3">Bank Name</th>
                      <th className="px-6 py-3 text-right">Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {payments.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8 text-slate-400">No payment records found</td></tr>
                    ) : (
                      payments.map((p) => (
                        <tr key={p.id} className="hover:bg-slate-50/50">
                          <td className="px-6 py-3 text-slate-600">{p.payment_date}</td>
                          <td className="px-6 py-3 font-mono font-bold text-slate-800">{p.payment_no || `PAY-${p.id}`}</td>
                          <td className="px-6 py-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-800">
                              {p.payment_mode || 'BANK'}
                            </span>
                          </td>
                          <td className="px-6 py-3 font-mono text-slate-600">{p.reference_no || '—'}</td>
                          <td className="px-6 py-3 text-slate-700">{p.bank_name || '—'}</td>
                          <td className="px-6 py-3 text-right font-mono font-bold text-emerald-700 text-sm">
                            ₹{Number(p.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: INVOICES (NEW!) ─────────────────────────────────────────────── */}
      {activeTab === 'invoices' && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center flex-wrap gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Purchase Invoices & Bills</h3>
              <p className="text-xs text-slate-500">Verified vendor invoices processed by Nutribray accounts</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search invoice or GRN #…"
                  value={invoiceFilter}
                  onChange={(e) => setInvoiceFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs w-48 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              <span className="text-xs text-slate-400 font-bold">{filteredInvoices.length} Bills</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">Invoice Number</th>
                  <th className="px-6 py-3">Invoice Date</th>
                  <th className="px-6 py-3">Nutribray GRN #</th>
                  <th className="px-6 py-3">Nutribray Store/Unit</th>
                  <th className="px-6 py-3 text-right">Taxable Amount</th>
                  <th className="px-6 py-3 text-right">Tax (GST)</th>
                  <th className="px-6 py-3 text-right">Net Bill Amount</th>
                  <th className="px-6 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {filteredInvoices.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-slate-400">No invoices found</td></tr>
                ) : (
                  filteredInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 font-mono font-bold text-slate-900">{inv.invoice_no}</td>
                      <td className="px-6 py-3 text-slate-600">{inv.invoice_date}</td>
                      <td className="px-6 py-3 font-mono text-blue-600 font-bold">{inv.purchase_no}</td>
                      <td className="px-6 py-3 text-slate-700">{inv.unit_name || 'Nutribray Store'}</td>
                      <td className="px-6 py-3 text-right font-mono">₹{Number(inv.taxable_amount || 0).toFixed(2)}</td>
                      <td className="px-6 py-3 text-right font-mono text-slate-500">₹{Number(inv.tax_amount || 0).toFixed(2)}</td>
                      <td className="px-6 py-3 text-right font-mono font-bold text-slate-900">₹{Number(inv.total_amount || 0).toFixed(2)}</td>
                      <td className="px-6 py-3 text-center">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800">
                          {inv.status || 'VERIFIED'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: ITEM SALES REPORT ───────────────────────────────────────────── */}
      {activeTab === 'sales' && (
        <div className="space-y-6">
          {salesDisabled ? (
            <div className="p-8 bg-amber-50 border border-amber-200 rounded-2xl text-center max-w-xl mx-auto space-y-3">
              <ShieldAlert className="w-12 h-12 text-amber-500 mx-auto" />
              <h3 className="text-base font-black text-amber-900">Item Sales Reports Not Enabled</h3>
              <p className="text-xs text-amber-700 leading-relaxed">
                Item sales reporting is controlled by the purchasing department and is not currently activated for your vendor account.
                Please contact the Nutribray procurement team to request access to sell-through reports.
              </p>
            </div>
          ) : salesLoading ? (
            <div className="p-12 text-center text-slate-400 font-medium">Loading sales data…</div>
          ) : salesData ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {salesData.summary?.total_qty !== null && (
                  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Units Sold</span>
                    <p className="text-2xl font-black text-slate-900 mt-2">{salesData.summary?.total_qty || 0}</p>
                  </div>
                )}
                {salesData.summary?.total_value !== null && (
                  <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Sales Value</span>
                    <p className="text-2xl font-black text-blue-600 mt-2">
                      ₹{Number(salesData.summary?.total_value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                )}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Products Count</span>
                  <p className="text-2xl font-black text-slate-800 mt-2">{salesData.summary?.product_count || 0}</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">Product Name</th>
                      <th className="px-6 py-3">Item Code</th>
                      <th className="px-6 py-3">Barcode</th>
                      <th className="px-6 py-3">Brand</th>
                      <th className="px-6 py-3 text-right">MRP</th>
                      {salesData.permissions?.view_stock_position && <th className="px-6 py-3 text-right">Available Stock</th>}
                      {salesData.permissions?.view_sales_quantity && <th className="px-6 py-3 text-right">Sales Qty</th>}
                      {salesData.permissions?.view_sales_value && <th className="px-6 py-3 text-right">Sales Value</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {salesData.products?.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-8 text-slate-400">No sales transactions found for your items</td></tr>
                    ) : (
                      salesData.products?.map((p: any) => (
                        <tr key={p.product_id} className="hover:bg-slate-50/50">
                          <td className="px-6 py-3 font-bold text-slate-900">{p.product_name}</td>
                          <td className="px-6 py-3 font-mono text-slate-500">{p.item_code || '—'}</td>
                          <td className="px-6 py-3 font-mono text-slate-500">{p.barcode || '—'}</td>
                          <td className="px-6 py-3 text-slate-600">{p.brand || '—'}</td>
                          <td className="px-6 py-3 text-right font-mono">₹{Number(p.mrp || 0).toFixed(2)}</td>
                          {salesData.permissions?.view_stock_position && (
                            <td className="px-6 py-3 text-right font-mono text-slate-700">{p.current_stock ?? '—'}</td>
                          )}
                          {salesData.permissions?.view_sales_quantity && (
                            <td className="px-6 py-3 text-right font-bold text-blue-600">{p.sales_qty ?? '—'}</td>
                          )}
                          {salesData.permissions?.view_sales_value && (
                            <td className="px-6 py-3 text-right font-bold text-slate-900">₹{Number(p.sales_value || 0).toFixed(2)}</td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* ── TAB: NEW ITEM PROPOSALS ──────────────────────────────────────────── */}
      {activeTab === 'item_requests' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex-wrap gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Product Proposals</h3>
              <p className="text-xs text-slate-500">Propose new products for listing in Nutribray stores</p>
            </div>
            <button
              onClick={() => setNewItemModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-sm"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Propose New Item
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3">Proposal #</th>
                    <th className="px-6 py-3">Product Name</th>
                    <th className="px-6 py-3">Brand / Unit</th>
                    <th className="px-6 py-3 font-mono">Barcode</th>
                    <th className="px-6 py-3 text-right">Purchase Rate</th>
                    <th className="px-6 py-3 text-right">MRP</th>
                    <th className="px-6 py-3 text-center">Status</th>
                    <th className="px-6 py-3">Reviewer Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {itemRequests.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-8 text-slate-400">No proposals submitted yet</td></tr>
                  ) : (
                    itemRequests.map((it) => (
                      <tr key={it.id} className="hover:bg-slate-50/50">
                        <td className="px-6 py-3 font-mono font-bold text-blue-600">{it.request_no}</td>
                        <td className="px-6 py-3 font-bold text-slate-900">{it.product_name}</td>
                        <td className="px-6 py-3 text-slate-600">{it.brand_name || 'Generic'} • {it.unit}</td>
                        <td className="px-6 py-3 font-mono text-slate-500">{it.barcode || '—'}</td>
                        <td className="px-6 py-3 text-right font-mono">₹{Number(it.purchase_rate || 0).toFixed(2)}</td>
                        <td className="px-6 py-3 text-right font-mono font-bold text-slate-900">₹{Number(it.mrp || 0).toFixed(2)}</td>
                        <td className="px-6 py-3 text-center">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                            it.status === 'approved'
                              ? 'bg-emerald-100 text-emerald-800'
                              : it.status === 'rejected'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}>
                            {it.status}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-slate-500 text-[11px]">{it.review_notes || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: MY PROFILE ─────────────────────────────────────────────────── */}
      {activeTab === 'profile' && profileData && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex items-center justify-between flex-wrap gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Company & Account Details</h3>
              <p className="text-xs text-slate-500">Live verified information in Nutribray Supplier Master</p>
            </div>
            {perms.update_profile !== false && (
              <button
                onClick={() => setProfileModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700"
              >
                Request Changes to Profile
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-3 text-xs">
              <h4 className="font-bold text-slate-900 border-b border-slate-100 pb-2 uppercase text-[10px] text-slate-400">
                Contact & Address
              </h4>
              <p><span className="text-slate-400">Contact Person:</span> <strong className="text-slate-800">{profileData.contact_name || '—'}</strong></p>
              <p><span className="text-slate-400">Phone:</span> <strong className="text-slate-800">{profileData.phone}</strong></p>
              <p><span className="text-slate-400">Email:</span> <strong className="text-slate-800">{profileData.email || '—'}</strong></p>
              <p><span className="text-slate-400">Address:</span> <span className="text-slate-700">{profileData.address || '—'}, {profileData.city}, {profileData.state}</span></p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-3 text-xs">
              <h4 className="font-bold text-slate-900 border-b border-slate-100 pb-2 uppercase text-[10px] text-slate-400">
                Banking & Tax Details
              </h4>
              <p><span className="text-slate-400">GSTIN:</span> <strong className="font-mono text-slate-800">{profileData.gst_number || '—'}</strong></p>
              <p><span className="text-slate-400">PAN:</span> <strong className="font-mono text-slate-800">{profileData.pan_number || '—'}</strong></p>
              <p><span className="text-slate-400">Bank Name:</span> <strong className="text-slate-800">{profileData.financial?.bank_name || '—'}</strong></p>
              <p><span className="text-slate-400">Account No:</span> <strong className="font-mono text-slate-800">{profileData.financial?.account_no || '—'}</strong></p>
              <p><span className="text-slate-400">IFSC Code:</span> <strong className="font-mono text-slate-800">{profileData.financial?.ifsc_code || '—'}</strong></p>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: PO DETAIL & ITEMS ────────────────────────────────────────── */}
      <Modal open={poDetailModal} onClose={() => setPoDetailModal(false)} title={`PO Items — ${selectedPo?.po_no}`}>
        <div className="p-6 space-y-4 text-xs">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-3 gap-2">
            <div><span className="text-slate-400">PO Date:</span> <strong className="text-slate-800">{selectedPo?.po_date}</strong></div>
            <div><span className="text-slate-400">Expected Date:</span> <strong className="text-slate-800">{selectedPo?.expected_date || '—'}</strong></div>
            <div><span className="text-slate-400">PO Total:</span> <strong className="text-slate-900">₹{Number(selectedPo?.total_amount || 0).toFixed(2)}</strong></div>
          </div>

          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-700 uppercase font-bold text-left">
              <tr>
                <th className="p-2.5">Item Name</th>
                <th className="p-2.5 font-mono">Barcode</th>
                <th className="p-2.5 text-right">Ordered</th>
                <th className="p-2.5 text-right">Received</th>
                <th className="p-2.5 text-right">Rate</th>
                <th className="p-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {selectedPo?.items?.map((it: any) => (
                <tr key={it.id}>
                  <td className="p-2.5 font-bold text-slate-900">{it.product_name}</td>
                  <td className="p-2.5 font-mono text-slate-500">{it.barcode || '—'}</td>
                  <td className="p-2.5 text-right">{it.order_qty}</td>
                  <td className="p-2.5 text-right text-emerald-600 font-bold">{it.received_qty}</td>
                  <td className="p-2.5 text-right font-mono">₹{Number(it.rate || 0).toFixed(2)}</td>
                  <td className="p-2.5 text-right font-mono font-bold text-slate-900">₹{Number(it.total || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* ── MODAL: ACKNOWLEDGE PO ────────────────────────────────────────────── */}
      <Modal open={ackModal} onClose={() => setAckModal(false)} title={`Acknowledge PO #${selectedPo?.po_no}`}>
        <div className="p-6 space-y-4 text-xs">
          <p className="text-slate-600">
            Confirm that you have received this purchase order and specify your promised dispatch/delivery date.
          </p>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Expected Delivery Date</label>
            <input
              type="date"
              value={ackExpectedDate}
              onChange={(e) => setAckExpectedDate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Delivery Remarks / Transporter</label>
            <textarea
              value={ackRemarks}
              onChange={(e) => setAckRemarks(e.target.value)}
              placeholder="e.g. Dispatched via Express Logistics, tracking no #12345…"
              className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setAckModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-bold">
              Cancel
            </button>
            <button
              onClick={handleAcknowledgePo}
              disabled={savingAck}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
            >
              {savingAck ? 'Confirming…' : 'Confirm Acknowledgement'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: PRN DETAIL & ITEMS ────────────────────────────────────────── */}
      <Modal open={prnDetailModal} onClose={() => setPrnDetailModal(false)} title={`PRN Items — ${selectedPrn?.return_no}`}>
        <div className="p-6 space-y-4 text-xs">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-3 gap-2">
            <div><span className="text-slate-400">Return Date:</span> <strong className="text-slate-800">{selectedPrn?.return_date}</strong></div>
            <div><span className="text-slate-400">Reason:</span> <strong className="text-rose-600">{selectedPrn?.reason || 'Inventory Return'}</strong></div>
            <div><span className="text-slate-400">Total Debit:</span> <strong className="text-slate-900">₹{Number(selectedPrn?.total_amount || 0).toFixed(2)}</strong></div>
          </div>

          {selectedPrn?.vendor_remarks && (
            <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg text-xs text-blue-900">
              <span className="font-bold">Your Acknowledgement Remarks:</span> {selectedPrn.vendor_remarks}
            </div>
          )}

          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-700 uppercase font-bold text-left">
              <tr>
                <th className="p-2.5">Product Name</th>
                <th className="p-2.5">Batch #</th>
                <th className="p-2.5 text-right">Return Qty</th>
                <th className="p-2.5 text-right">Rate</th>
                <th className="p-2.5 text-right">Total Debit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {(!selectedPrn?.items || selectedPrn.items.length === 0) ? (
                <tr><td colSpan={5} className="text-center py-4 text-slate-400">No itemized lines available for this return</td></tr>
              ) : (
                selectedPrn.items.map((it: any) => (
                  <tr key={it.id}>
                    <td className="p-2.5 font-bold text-slate-900">{it.product_name}</td>
                    <td className="p-2.5 font-mono text-slate-600">{it.batch_no || '—'}</td>
                    <td className="p-2.5 text-right font-bold text-rose-600">{it.qty_returned || it.qty}</td>
                    <td className="p-2.5 text-right font-mono">₹{Number(it.rate || it.price || 0).toFixed(2)}</td>
                    <td className="p-2.5 text-right font-mono font-bold text-slate-900">₹{Number(it.total || 0).toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {!selectedPrn?.vendor_ack && perms.acknowledge_prn !== false && (
            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={() => {
                  setPrnDetailModal(false)
                  setPrnAckRemarks('')
                  setPrnAckModal(true)
                }}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-bold"
              >
                Acknowledge This PRN
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* ── MODAL: ACKNOWLEDGE PRN ──────────────────────────────────────────── */}
      <Modal open={prnAckModal} onClose={() => setPrnAckModal(false)} title={`Acknowledge PRN #${selectedPrn?.return_no}`}>
        <div className="p-6 space-y-4 text-xs">
          <p className="text-slate-600">
            Confirm that your company acknowledges this Purchase Return Note. You can provide replacement dispatch details or credit note reference number.
          </p>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Acknowledgement Remarks / Credit Note Ref</label>
            <textarea
              value={prnAckRemarks}
              onChange={(e) => setPrnAckRemarks(e.target.value)}
              placeholder="e.g. Credit Note CN-8821 issued, replacement items dispatched on 16/10…"
              className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setPrnAckModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-bold">
              Cancel
            </button>
            <button
              onClick={handleAcknowledgePrn}
              disabled={savingPrnAck}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
            >
              {savingPrnAck ? 'Confirming…' : 'Confirm Acknowledgement'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: PROPOSE NEW ITEM ─────────────────────────────────────────── */}
      <Modal open={newItemModal} onClose={() => setNewItemModal(false)} title="Propose New Item to Nutribray">
        <form onSubmit={handleSubmitNewItem} className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Product Name *</label>
              <input
                type="text"
                required
                value={newItemForm.product_name}
                onChange={(e) => setNewItemForm({ ...newItemForm, product_name: e.target.value })}
                placeholder="e.g. Organic Almond Butter 250g"
                className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Brand Name</label>
              <input
                type="text"
                value={newItemForm.brand_name}
                onChange={(e) => setNewItemForm({ ...newItemForm, brand_name: e.target.value })}
                placeholder="e.g. Nature Best"
                className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Barcode / EAN</label>
              <input
                type="text"
                value={newItemForm.barcode}
                onChange={(e) => setNewItemForm({ ...newItemForm, barcode: e.target.value })}
                placeholder="e.g. 8901234567890"
                className="w-full border border-slate-200 rounded-lg p-2 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Category</label>
              <input
                type="text"
                value={newItemForm.category_name}
                onChange={(e) => setNewItemForm({ ...newItemForm, category_name: e.target.value })}
                placeholder="e.g. Gourmet Spreads"
                className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Purchase Rate (₹) *</label>
              <input
                type="number"
                step="0.01"
                required
                value={newItemForm.purchase_rate}
                onChange={(e) => setNewItemForm({ ...newItemForm, purchase_rate: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">MRP (₹) *</label>
              <input
                type="number"
                step="0.01"
                required
                value={newItemForm.mrp}
                onChange={(e) => setNewItemForm({ ...newItemForm, mrp: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs font-bold"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">GST %</label>
              <select
                value={newItemForm.gst_percent}
                onChange={(e) => setNewItemForm({ ...newItemForm, gst_percent: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs bg-white"
              >
                <option value="0">0%</option>
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">HSN Code</label>
              <input
                type="text"
                value={newItemForm.hsn_code}
                onChange={(e) => setNewItemForm({ ...newItemForm, hsn_code: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Description / Key Selling Points</label>
            <textarea
              value={newItemForm.description}
              onChange={(e) => setNewItemForm({ ...newItemForm, description: e.target.value })}
              className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button type="button" onClick={() => setNewItemModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg font-bold text-slate-600">
              Cancel
            </button>
            <button type="submit" disabled={savingItemReq} className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50">
              {savingItemReq ? 'Submitting…' : 'Submit Proposal'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL: REQUEST PROFILE CHANGES ──────────────────────────────────── */}
      <Modal open={profileModal} onClose={() => setProfileModal(false)} title="Request Profile Changes">
        <div className="p-6 space-y-4 text-xs max-h-[80vh] overflow-y-auto">
          <p className="text-slate-500">
            Changes to contact, address, or banking information are routed to the purchasing compliance desk for verification before updating.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Contact Person</label>
              <input
                type="text"
                value={profileChanges.contact_name}
                onChange={(e) => setProfileChanges({ ...profileChanges, contact_name: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Phone</label>
              <input
                type="text"
                value={profileChanges.phone}
                onChange={(e) => setProfileChanges({ ...profileChanges, phone: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Email</label>
              <input
                type="email"
                value={profileChanges.email}
                onChange={(e) => setProfileChanges({ ...profileChanges, email: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Bank Name</label>
              <input
                type="text"
                value={profileChanges.bank_name}
                onChange={(e) => setProfileChanges({ ...profileChanges, bank_name: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Account Number</label>
              <input
                type="text"
                value={profileChanges.account_no}
                onChange={(e) => setProfileChanges({ ...profileChanges, account_no: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">IFSC Code</label>
              <input
                type="text"
                value={profileChanges.ifsc_code}
                onChange={(e) => setProfileChanges({ ...profileChanges, ifsc_code: e.target.value })}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Office Address</label>
            <textarea
              value={profileChanges.address}
              onChange={(e) => setProfileChanges({ ...profileChanges, address: e.target.value })}
              className="w-full border border-slate-200 rounded-lg p-2 text-xs"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button onClick={() => setProfileModal(false)} className="px-4 py-2 border border-slate-200 rounded-lg font-bold text-slate-600">
              Cancel
            </button>
            <button
              onClick={handleSubmitProfileChanges}
              disabled={savingProfileReq}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
            >
              {savingProfileReq ? 'Submitting…' : 'Submit Change Request'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: GRN DETAIL ──────────────────────────────────────────────── */}
      <Modal open={grnDetailModal} onClose={() => setGrnDetailModal(false)} title={`GRN Items — ${selectedGrn?.purchase_no}`}>
        <div className="p-6 space-y-4 text-xs">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 grid grid-cols-3 gap-2">
            <div><span className="text-slate-400">Invoice:</span> <strong className="text-slate-800">{selectedGrn?.invoice_no || '—'}</strong></div>
            <div><span className="text-slate-400">Date:</span> <strong className="text-slate-800">{selectedGrn?.invoice_date}</strong></div>
            <div><span className="text-slate-400">Total:</span> <strong className="text-slate-900">₹{Number(selectedGrn?.total_amount || 0).toFixed(2)}</strong></div>
          </div>

          <table className="w-full text-xs">
            <thead className="bg-slate-100 text-slate-700 uppercase font-bold text-left">
              <tr>
                <th className="p-2.5">Item Name</th>
                <th className="p-2.5">Batch #</th>
                <th className="p-2.5">Expiry</th>
                <th className="p-2.5 text-right">Qty Received</th>
                <th className="p-2.5 text-right">Rate</th>
                <th className="p-2.5 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {selectedGrn?.items?.map((it: any) => (
                <tr key={it.id}>
                  <td className="p-2.5 font-bold text-slate-900">{it.product_name}</td>
                  <td className="p-2.5 font-mono text-slate-600">{it.batch_no || '—'}</td>
                  <td className="p-2.5 text-slate-500">{it.expiry_date || '—'}</td>
                  <td className="p-2.5 text-right font-bold text-emerald-600">{it.qty_received}</td>
                  <td className="p-2.5 text-right font-mono">₹{Number(it.price || 0).toFixed(2)}</td>
                  <td className="p-2.5 text-right font-mono font-bold text-slate-900">₹{Number(it.total || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>
    </div>
  )
}
