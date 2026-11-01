import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  suppliers_api,
  type supplier_detail,
  type supplier_terms,
  type ledger_row,
} from '../../api/suppliers'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import StatusBadge from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'
import {
  Building2, Users, MapPin, FileText, CreditCard, ShieldCheck,
  Package, ShoppingCart, Truck, TrendingUp, Sparkles, History,
  Settings, CheckCircle2, XCircle, AlertCircle, Eye, ArrowUpRight,
  Phone, Mail, Globe, Calendar, RefreshCw, FileCheck, Layers, Upload, Trash2,
  KeyRound, Lock, Send, Copy, Shield, ShieldAlert
} from 'lucide-react'

type DetailTab =
  | 'overview'
  | 'portal'
  | 'business'
  | 'address'
  | 'tax'
  | 'bank'
  | 'terms'
  | 'documents'
  | 'products'
  | 'pos'
  | 'grns'
  | 'sales'
  | 'item_requests'
  | 'audit'

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>()
  const supplierId = Number(id)

  const [supplier, setSupplier] = useState<supplier_detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<DetailTab>('overview')

  // Sub-data states
  const [ledger, setLedger] = useState<ledger_row[]>([])
  const [terms, setTerms] = useState<supplier_terms[]>([])
  const [pos, setPos] = useState<any[]>([])
  const [grns, setGrns] = useState<any[]>([])
  const [salesData, setSalesData] = useState<any>(null)
  const [itemRequests, setItemRequests] = useState<any[]>([])
  const [profileRequests, setProfileRequests] = useState<any[]>([])
  const [subLoading, setSubLoading] = useState(false)

  // Modals
  const [portalModal, setPortalModal] = useState(false)
  const [portalSalesEnabled, setPortalSalesEnabled] = useState(false)
  const [portalSalesConfig, setPortalSalesConfig] = useState<Record<string, boolean>>({
    view_sales_quantity: true,
    view_sales_value: true,
    view_outlet_wise: false,
    view_stock_position: false,
    export_allowed: false,
  })
  const [savingPortal, setSavingPortal] = useState(false)

  // Portal Access & Login Management
  const [portalAccessData, setPortalAccessData] = useState<any>(null)
  const [loadingPortalAccess, setLoadingPortalAccess] = useState(false)
  const [createLoginModal, setCreateLoginModal] = useState(false)
  const [loginForm, setLoginForm] = useState({
    username: '',
    email: '',
    password: '',
  })
  const [savingLogin, setSavingLogin] = useState(false)
  const [inviteModal, setInviteModal] = useState(false)
  const [inviteText, setInviteText] = useState('')
  const [resetPwdModal, setResetPwdModal] = useState(false)
  const [resetPwdMode, setResetPwdMode] = useState<'link' | 'password'>('link')
  const [newDirectPassword, setNewDirectPassword] = useState('')
  const [resetResultLink, setResetResultLink] = useState('')
  const [savingResetPwd, setSavingResetPwd] = useState(false)
  const [permissionsModal, setPermissionsModal] = useState(false)
  const [portalPerms, setPortalPerms] = useState<Record<string, boolean>>({
    view_pos: true,
    download_po: true,
    view_grn: true,
    download_grn: true,
    view_prn: true,
    download_prn: true,
    view_sales: false,
    view_sales_quantity: true,
    view_sales_value: true,
    view_outlet_sales: false,
    view_cheques: true,
    view_payments: true,
    view_ledger: true,
    download_statement: true,
    view_item_requests: true,
    submit_item_requests: true,
    edit_profile: true,
  })
  const [savingPerms, setSavingPerms] = useState(false)


  // Item request review modal
  const [reviewItemModal, setReviewItemModal] = useState(false)
  const [selectedItemReq, setSelectedItemReq] = useState<any>(null)
  const [itemReviewAction, setItemReviewAction] = useState<'approve' | 'reject' | 'correction_requested'>('approve')
  const [itemReviewNotes, setItemReviewNotes] = useState('')
  const [createProductAuto, setCreateProductAuto] = useState(true)
  const [savingItemReview, setSavingItemReview] = useState(false)

  // Profile request review modal
  const [reviewProfileModal, setReviewProfileModal] = useState(false)
  const [selectedProfileReq, setSelectedProfileReq] = useState<any>(null)
  const [profileReviewAction, setProfileReviewAction] = useState<'approve' | 'reject'>('approve')
  const [profileReviewNotes, setProfileReviewNotes] = useState('')
  const [savingProfileReview, setSavingProfileReview] = useState(false)

  // Note modal
  const [noteModal, setNoteModal] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  // Document upload modal
  const [docUploadModal, setDocUploadModal] = useState(false)
  const [docType, setDocType] = useState('GST Certificate')
  const [docFile, setDocFile] = useState<File | null>(null)
  const [docStartDate, setDocStartDate] = useState('')
  const [docEndDate, setDocEndDate] = useState('')
  const [docNotes, setDocNotes] = useState('')
  const [uploadingDoc, setUploadingDoc] = useState(false)

  // Load supplier details
  const fetchSupplier = async () => {
    if (!supplierId) return
    try {
      setLoading(true)
      const res = await suppliers_api.get(supplierId)
      setSupplier(res.data)
      setPortalSalesEnabled(Boolean(res.data.portal_sales_enabled))
      if (res.data.portal_sales_config) {
        setPortalSalesConfig(res.data.portal_sales_config)
      }
    } catch (err: any) {
      toast.error('Failed to load supplier details')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSupplier()
  }, [supplierId])

  // Lazy load tab data
  useEffect(() => {
    if (!supplierId) return
    const loadTabData = async () => {
      setSubLoading(true)
      try {
        if (activeTab === 'overview' || activeTab === 'terms') {
          const [lRes, tRes] = await Promise.all([
            suppliers_api.ledger(supplierId),
            suppliers_api.get_terms(supplierId),
          ])
          setLedger(lRes.data)
          setTerms(tRes.data)
        } else if (activeTab === 'pos') {
          const res = await suppliers_api.get_pos(supplierId)
          setPos(res.data.items || [])
        } else if (activeTab === 'grns') {
          const res = await suppliers_api.get_grns(supplierId)
          setGrns(res.data.items || [])
        } else if (activeTab === 'sales') {
          const res = await suppliers_api.get_sales(supplierId)
          setSalesData(res.data)
        } else if (activeTab === 'item_requests') {
          const res = await suppliers_api.get_item_requests(supplierId)
          setItemRequests(res.data || [])
        } else if (activeTab === 'audit') {
          const res = await suppliers_api.get_profile_requests(supplierId)
          setProfileRequests(res.data || [])
        } else if (activeTab === 'portal') {
          fetchPortalAccess()
        }
      } catch (err: any) {
        console.error('Error fetching tab data:', err)
      } finally {
        setSubLoading(false)
      }
    }
    loadTabData()
  }, [activeTab, supplierId])

  // Fetch Vendor Portal Access & Credentials
  const fetchPortalAccess = async () => {
    if (!supplierId) return
    setLoadingPortalAccess(true)
    try {
      const res = await suppliers_api.get_portal_access(supplierId)
      setPortalAccessData(res.data)
      setInviteText(res.data.invitation_text)
      if (res.data.portal_permissions) {
        setPortalPerms(res.data.portal_permissions)
      }
      if (res.data.user) {
        setLoginForm({
          username: res.data.user.username,
          email: res.data.user.email || '',
          password: '',
        })
      } else if (supplier) {
        const cleanName = (supplier.supplier_code || `sup_${supplier.id}`).toLowerCase().replace(/[^a-z0-9_]/g, '')
        setLoginForm({
          username: cleanName,
          email: supplier.email || '',
          password: '',
        })
      }
    } catch (err: any) {
      console.error('Failed to load portal access info', err)
    } finally {
      setLoadingPortalAccess(false)
    }
  }

  // Create or Update Vendor Login
  const handleCreateOrUpdateLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplierId) return
    setSavingLogin(true)
    try {
      const res = await suppliers_api.create_portal_user(supplierId, {
        username: loginForm.username,
        email: loginForm.email || undefined,
        password: loginForm.password || undefined,
        portal_permissions: portalPerms,
      })
      toast.success(res.data.user ? 'Vendor portal user saved successfully!' : 'Portal credentials updated!')
      setPortalAccessData(res.data)
      setCreateLoginModal(false)
      fetchPortalAccess()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to save vendor login')
    } finally {
      setSavingLogin(false)
    }
  }

  // Toggle Portal Status
  const handleTogglePortalStatus = async () => {
    if (!supplierId) return
    try {
      const res = await suppliers_api.toggle_portal_status(supplierId)
      toast.success(res.data.message || 'Status updated')
      fetchPortalAccess()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to update account status')
    }
  }

  // Reset Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplierId) return
    setSavingResetPwd(true)
    try {
      const res = await suppliers_api.reset_portal_password(supplierId, {
        new_password: resetPwdMode === 'password' ? newDirectPassword : null,
        generate_reset_link: resetPwdMode === 'link',
      })
      toast.success(res.data.message || 'Password reset completed')
      if (res.data.reset_link) {
        setResetResultLink(res.data.reset_link)
      } else {
        setResetPwdModal(false)
        setNewDirectPassword('')
      }
      fetchPortalAccess()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to reset password')
    } finally {
      setSavingResetPwd(false)
    }
  }

  // Save Portal Permissions
  const handleSavePortalPermissions = async () => {
    if (!supplierId) return
    setSavingPerms(true)
    try {
      await suppliers_api.update_portal_permissions(supplierId, portalPerms)
      toast.success('Portal permissions updated successfully!')
      setPermissionsModal(false)
      fetchPortalAccess()
      fetchSupplier()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to update permissions')
    } finally {
      setSavingPerms(false)
    }
  }


  // Save Portal Settings
  const handleSavePortalSettings = async () => {
    if (!supplierId) return
    setSavingPortal(true)
    try {
      await suppliers_api.update_portal_settings(supplierId, {
        portal_sales_enabled: portalSalesEnabled,
        portal_sales_config: portalSalesConfig,
      })
      toast.success('Vendor Portal settings updated')
      setPortalModal(false)
      fetchSupplier()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to update portal settings')
    } finally {
      setSavingPortal(false)
    }
  }

  // Handle Review Item Request
  const handleSubmitItemReview = async () => {
    if (!selectedItemReq || !supplierId) return
    setSavingItemReview(true)
    try {
      await suppliers_api.review_item_request(supplierId, selectedItemReq.id, {
        action: itemReviewAction,
        review_notes: itemReviewNotes,
        create_product: createProductAuto,
      })
      toast.success(`Item request #${selectedItemReq.request_no} ${itemReviewAction}d`)
      setReviewItemModal(false)
      const res = await suppliers_api.get_item_requests(supplierId)
      setItemRequests(res.data || [])
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to review item request')
    } finally {
      setSavingItemReview(false)
    }
  }

  // Handle Review Profile Request
  const handleSubmitProfileReview = async () => {
    if (!selectedProfileReq || !supplierId) return
    setSavingProfileReview(true)
    try {
      await suppliers_api.review_profile_request(supplierId, selectedProfileReq.id, {
        action: profileReviewAction,
        review_notes: profileReviewNotes,
      })
      toast.success(`Profile update request #${selectedProfileReq.id} ${profileReviewAction}d`)
      setReviewProfileModal(false)
      fetchSupplier()
      const res = await suppliers_api.get_profile_requests(supplierId)
      setProfileRequests(res.data || [])
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to review profile change request')
    } finally {
      setSavingProfileReview(false)
    }
  }

  // Add Internal Note
  const handleAddNote = async () => {
    if (!supplierId || !newNote.trim()) return
    setSavingNote(true)
    try {
      await suppliers_api.addNote(supplierId, newNote.trim())
      toast.success('Note added')
      setNewNote('')
      setNoteModal(false)
      fetchSupplier()
    } catch (err: any) {
      toast.error('Failed to add note')
    } finally {
      setSavingNote(false)
    }
  }

  // Upload Document
  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supplierId) return
    if (!docFile) {
      toast.error('Please select a file to upload')
      return
    }
    setUploadingDoc(true)
    try {
      const fd = new FormData()
      fd.append('file', docFile)
      fd.append('document_type', docType)
      if (docStartDate) fd.append('start_date', docStartDate)
      if (docEndDate) fd.append('end_date', docEndDate)
      if (docNotes) fd.append('notes', docNotes)

      await suppliers_api.upload_document(supplierId, fd)
      toast.success(`${docType} uploaded successfully!`)
      setDocUploadModal(false)
      setDocFile(null)
      setDocStartDate('')
      setDocEndDate('')
      setDocNotes('')
      fetchSupplier()
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to upload document')
    } finally {
      setUploadingDoc(false)
    }
  }

  // Delete Document
  const handleDeleteDocument = async (docId?: number) => {
    if (!docId || !supplierId) return
    if (!window.confirm('Are you sure you want to delete this document?')) return
    try {
      await suppliers_api.delete_document(supplierId, docId)
      toast.success('Document deleted')
      fetchSupplier()
    } catch (err: any) {
      toast.error('Failed to delete document')
    }
  }

  if (loading || !supplier) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-sm text-slate-500 font-medium">Loading Supplier Master record…</p>
      </div>
    )
  }

  const finalBalance = ledger.length > 0 ? Number(ledger[ledger.length - 1].balance) : 0

  const tabsConfig = [
    { id: 'overview', label: 'Overview', icon: Building2 },
    { id: 'portal', label: 'Portal Access & Login', icon: KeyRound },
    { id: 'business', label: 'Business & Contacts', icon: Users },
    { id: 'address', label: 'Addresses', icon: MapPin },
    { id: 'tax', label: 'GST & Tax Details', icon: FileCheck },
    { id: 'bank', label: 'Bank Details', icon: CreditCard },
    { id: 'terms', label: 'Payment Terms', icon: ShieldCheck },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'products', label: 'Products & Brands', icon: Package },
    { id: 'pos', label: 'Purchase Orders', icon: ShoppingCart },
    { id: 'grns', label: 'GRN / Received', icon: Truck },
    { id: 'sales', label: 'Sales Reports', icon: TrendingUp },
    { id: 'item_requests', label: 'Item Requests', icon: Sparkles },
    { id: 'audit', label: 'Audit & History', icon: History },
  ]

  return (
    <div className="space-y-6 pb-12">
      {/* Top Breadcrumb & Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 rounded-xl shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Link
              to="/masters/suppliers"
              className="p-2 border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 text-xs font-semibold"
            >
              ← Back to Suppliers
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">{supplier.name}</h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
                  {supplier.supplier_code || 'No Code'}
                </span>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                  supplier.registration_status === 'approved'
                    ? 'bg-emerald-100 text-emerald-800'
                    : supplier.registration_status === 'rejected'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {supplier.registration_status}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1 flex items-center gap-4">
                <span>{supplier.trade_name ? `Trade Name: ${supplier.trade_name}` : supplier.supplier_type}</span>
                {supplier.gst_number && <span>• GST: <strong className="text-slate-700">{supplier.gst_number}</strong></span>}
                {supplier.phone && <span>• Phone: {supplier.phone}</span>}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('portal')}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-all"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Portal Access
            </button>
            <button
              onClick={() => setPortalModal(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-all"
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </button>
            <button
              onClick={() => setNoteModal(true)}
              className="px-3.5 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all"
            >
              + Add Note
            </button>
            <Link
              to={`/masters/suppliers`}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-sm"
            >
              Edit Supplier
            </Link>
          </div>
        </div>
      </div>

      {/* 13 Modern Navigation Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-1.5 overflow-x-auto scrollbar-thin">
        <div className="flex gap-1 min-w-max">
          {tabsConfig.map((t) => {
            const Icon = t.icon
            const isActive = activeTab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id as DetailTab)}
                className={`flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── TAB 1: OVERVIEW ─────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Current Ledger Balance</p>
              <p className={`text-2xl font-black mt-2 ${finalBalance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                ₹{Math.abs(finalBalance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                <span className="text-xs font-normal text-slate-400 ml-1.5">{finalBalance > 0 ? 'Dr (Payable)' : 'Cr'}</span>
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Credit Terms</p>
              <p className="text-2xl font-black text-slate-800 mt-2">
                {supplier.credit_limit_days || 0} <span className="text-xs font-normal text-slate-400">Days</span>
              </p>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vendor Portal Status</p>
              <div className="flex items-center gap-2 mt-2">
                <span className={`w-3 h-3 rounded-full ${supplier.portal_sales_enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <span className="text-sm font-bold text-slate-700">
                  {supplier.portal_sales_enabled ? 'Sales Permitted' : 'Sales Disabled'}
                </span>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Onboarding Registration</p>
              <p className="text-sm font-bold text-slate-800 mt-2">
                {new Date(supplier.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
              </p>
            </div>
          </div>

          {/* Quick Summary Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h3 className="text-sm font-black text-slate-900 border-l-4 border-blue-600 pl-3 mb-4 uppercase tracking-wider">
                Primary Contact
              </h3>
              <div className="space-y-3 text-xs text-slate-600 font-medium">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Contact Person</span>
                  <span className="text-slate-800 text-sm font-bold">{supplier.contact_name || '—'}</span>
                  {supplier.designation && <span className="text-slate-500 text-xs ml-2">({supplier.designation})</span>}
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Phone</span>
                  <span className="text-slate-800">{supplier.phone} {supplier.alt_phone ? `/ ${supplier.alt_phone}` : ''}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Email</span>
                  <span className="text-slate-800">{supplier.email || '—'} {supplier.alt_email ? `/ ${supplier.alt_email}` : ''}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h3 className="text-sm font-black text-slate-900 border-l-4 border-blue-600 pl-3 mb-4 uppercase tracking-wider">
                Tax & Legal Summary
              </h3>
              <div className="space-y-3 text-xs text-slate-600 font-medium">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">GSTIN</span>
                  <span className="font-mono text-sm font-bold text-slate-900">{supplier.gst_number || 'Unregistered'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">PAN Number</span>
                  <span className="font-mono text-sm font-bold text-slate-900">{supplier.pan_number || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">MSME / Udyam</span>
                  <span className="text-slate-800">{supplier.msme_number || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">FSSAI License</span>
                  <span className="text-slate-800">{supplier.fssai_number || '—'}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h3 className="text-sm font-black text-slate-900 border-l-4 border-blue-600 pl-3 mb-4 uppercase tracking-wider">
                Bank & Financial
              </h3>
              <div className="space-y-3 text-xs text-slate-600 font-medium">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Bank Name</span>
                  <span className="text-sm font-bold text-slate-800">{supplier.financial?.bank_name || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Account Number</span>
                  <span className="font-mono text-sm font-bold text-slate-800">{supplier.financial?.account_no || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">IFSC Code</span>
                  <span className="font-mono text-sm font-bold text-slate-800">{supplier.financial?.ifsc_code || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Branch</span>
                  <span className="text-slate-800">{supplier.financial?.branch || '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Company Profile Description */}
          {supplier.company_description && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Company Profile / Description</h3>
              <p className="text-sm text-slate-700 leading-relaxed">{supplier.company_description}</p>
            </div>
          )}

          {/* Quick Ledger Preview */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Recent Transactions</h3>
              <span className="text-xs text-slate-400">Total Entries: {ledger.length}</span>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">Date</th>
                  <th className="px-6 py-3">Ref No</th>
                  <th className="px-6 py-3">Description</th>
                  <th className="px-6 py-3 text-right">Debit</th>
                  <th className="px-6 py-3 text-right">Credit</th>
                  <th className="px-6 py-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {ledger.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-slate-400">No ledger transactions posted yet</td>
                  </tr>
                ) : (
                  ledger.slice(-5).reverse().map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 text-slate-500">{r.date}</td>
                      <td className="px-6 py-3 font-mono">{r.ref_no}</td>
                      <td className="px-6 py-3 text-slate-700">{r.description}</td>
                      <td className="px-6 py-3 text-right text-rose-600">{Number(r.debit) > 0 ? `₹${Number(r.debit).toFixed(2)}` : '—'}</td>
                      <td className="px-6 py-3 text-right text-emerald-600">{Number(r.credit) > 0 ? `₹${Number(r.credit).toFixed(2)}` : '—'}</td>
                      <td className="px-6 py-3 text-right font-bold text-slate-900">₹{Number(r.balance).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB: VENDOR PORTAL ACCESS & LOGIN MANAGEMENT ───────────────────── */}
      {activeTab === 'portal' && (
        <div className="space-y-6">
          {/* Account Overview Header */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-4 pb-6 border-b border-slate-100">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-200 text-blue-600 flex items-center justify-center flex-shrink-0">
                  <KeyRound className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-lg font-black text-slate-900 tracking-tight">
                      Vendor Portal Access & Login Management
                    </h3>
                    {loadingPortalAccess ? (
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <RefreshCw className="w-3 h-3 animate-spin" /> Loading…
                      </span>
                    ) : portalAccessData?.has_account ? (
                      portalAccessData.user?.status ? (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Account Active
                        </span>
                      ) : (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-rose-600" /> Account Suspended
                        </span>
                      )
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
                        No Login Account Created
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Manage direct portal authentication, security credentials, single-use activation links, and data visibility for <strong>{supplier.name}</strong>.
                  </p>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                {!portalAccessData?.has_account ? (
                  <button
                    onClick={() => {
                      setCreateLoginModal(true)
                      fetchPortalAccess()
                    }}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black bg-blue-600 text-white hover:bg-blue-700 transition-all shadow-md shadow-blue-600/20"
                  >
                    <KeyRound className="w-4 h-4" />
                    Create Vendor Login
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setCreateLoginModal(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 transition-all"
                    >
                      Edit Account
                    </button>
                    <button
                      onClick={() => {
                        const fullUrl = `${window.location.origin}${portalAccessData.portal_link}`
                        navigator.clipboard.writeText(fullUrl)
                        toast.success('Portal Link copied to clipboard!')
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all"
                    >
                      <Copy className="w-3.5 h-3.5 text-slate-400" />
                      Copy Portal Link
                    </button>
                    <button
                      onClick={() => setInviteModal(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-all"
                    >
                      <Send className="w-3.5 h-3.5" />
                      Send Invitation
                    </button>
                    <button
                      onClick={() => {
                        setResetResultLink('')
                        setResetPwdModal(true)
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all"
                    >
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                      Reset Password
                    </button>
                    <button
                      onClick={handleTogglePortalStatus}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                        portalAccessData.user?.status
                          ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                    >
                      {portalAccessData.user?.status ? 'Suspend Access' : 'Reactivate Access'}
                    </button>
                    <button
                      onClick={() => setPermissionsModal(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-slate-100 border border-slate-200 text-slate-800 hover:bg-slate-200 transition-all"
                    >
                      <Shield className="w-3.5 h-3.5 text-blue-600" />
                      Permissions
                    </button>
                    <Link
                      to={`/vendor-portal?supplier_id=${supplier.id}`}
                      target="_blank"
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-black bg-slate-900 text-white hover:bg-slate-800 transition-all shadow-sm"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      Open Vendor View
                    </Link>
                  </>
                )}
              </div>
            </div>

            {/* Account Info Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6">
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Login Username</p>
                <p className="text-sm font-black text-slate-800 mt-1 font-mono">
                  {portalAccessData?.user?.username || (supplier.supplier_code || '—')}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Login Email</p>
                <p className="text-sm font-bold text-slate-800 mt-1 truncate">
                  {portalAccessData?.user?.email || supplier.email || '—'}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Last Login</p>
                <p className="text-sm font-bold text-slate-800 mt-1">
                  {portalAccessData?.user?.last_login ? new Date(portalAccessData.user.last_login).toLocaleString('en-IN') : 'Never Logged In'}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/70">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Portal URL</p>
                <p className="text-xs font-mono font-bold text-blue-600 mt-1 truncate">
                  {portalAccessData?.portal_link || '/vendor/login'}
                </p>
              </div>
            </div>
          </div>

          {/* Permissions Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-6">
              <div>
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Shield className="w-4 h-4 text-blue-600" />
                  Authorized Self-Service Permissions
                </h4>
                <p className="text-xs text-slate-500 mt-0.5">
                  Controls which data tabs, transaction records, and features this vendor can see or perform.
                </p>
              </div>
              <button
                onClick={() => setPermissionsModal(true)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-all"
              >
                Configure Permissions
              </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              {[
                { key: 'view_pos', label: 'View Purchase Orders', default: true },
                { key: 'download_po', label: 'Download / Print PO', default: true },
                { key: 'view_grn', label: 'View Goods Received (GRN)', default: true },
                { key: 'download_grn', label: 'Download GRN Receipts', default: true },
                { key: 'view_prn', label: 'View Return Notes (PRN)', default: true },
                { key: 'download_prn', label: 'Download PRN Documents', default: true },
                { key: 'view_cheques', label: 'View Issued Cheques', default: true },
                { key: 'view_payments', label: 'View Payment Transactions', default: true },
                { key: 'view_ledger', label: 'View Supplier Ledger', default: true },
                { key: 'download_statement', label: 'Download Statements', default: true },
                { key: 'view_sales', label: 'View Item Sales Reports', default: false },
                { key: 'view_sales_quantity', label: 'View Sales Quantities', default: true },
                { key: 'view_sales_value', label: 'View Sales Values', default: true },
                { key: 'view_outlet_sales', label: 'View Outlet-Wise Sales', default: false },
                { key: 'view_item_requests', label: 'View Item Proposals', default: true },
                { key: 'submit_item_requests', label: 'Submit New Item Proposals', default: true },
                { key: 'edit_profile', label: 'Request Profile Changes', default: true },
              ].map((p) => {
                const isEnabled = portalPerms[p.key] !== undefined ? portalPerms[p.key] : p.default
                return (
                  <div
                    key={p.key}
                    className={`p-3 rounded-xl border flex items-center justify-between ${
                      isEnabled ? 'bg-emerald-50/50 border-emerald-200/80 text-emerald-900' : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <span className="font-semibold text-[11px] leading-tight">{p.label}</span>
                    {isEnabled ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 ml-1.5" />
                    ) : (
                      <XCircle className="w-4 h-4 text-slate-300 flex-shrink-0 ml-1.5" />
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Login History / Audit Logs */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <h4 className="text-sm font-black text-slate-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <History className="w-4 h-4 text-slate-500" />
              Vendor Login & Access Audit History
            </h4>

            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[10px] tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3">IP Address</th>
                    <th className="px-4 py-3">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {!portalAccessData?.login_history || portalAccessData.login_history.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-6 text-slate-400">
                        No login activity recorded yet for this supplier user.
                      </td>
                    </tr>
                  ) : (
                    portalAccessData.login_history.map((log: any) => (
                      <tr key={log.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-bold text-slate-800 uppercase text-[10px]">
                          <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            {log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{log.description}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{log.ip_address || '—'}</td>
                        <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                          {log.created_at ? new Date(log.created_at).toLocaleString('en-IN') : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: BUSINESS & CONTACT DETAILS ─────────────────────────────────── */}
      {activeTab === 'business' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-black text-slate-900 border-l-4 border-blue-600 pl-3 mb-6 uppercase tracking-wider">
              Business Information
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs">
              <div>
                <span className="text-slate-400 block font-bold uppercase text-[10px]">Legal Name</span>
                <span className="text-sm font-bold text-slate-900">{supplier.name}</span>
              </div>
              <div>
                <span className="text-slate-400 block font-bold uppercase text-[10px]">Trade Name</span>
                <span className="text-sm font-bold text-slate-900">{supplier.trade_name || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block font-bold uppercase text-[10px]">Vendor Type</span>
                <span className="text-sm text-slate-800 font-semibold">{supplier.supplier_type}</span>
              </div>
              <div>
                <span className="text-slate-400 block font-bold uppercase text-[10px]">Business Constitution</span>
                <span className="text-slate-800 font-medium">{supplier.business_constitution || supplier.company_type || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block font-bold uppercase text-[10px]">Website</span>
                <span className="text-blue-600 font-medium">
                  {supplier.website ? (
                    <a href={supplier.website.startsWith('http') ? supplier.website : `https://${supplier.website}`} target="_blank" rel="noreferrer" className="hover:underline">
                      {supplier.website}
                    </a>
                  ) : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block font-bold uppercase text-[10px]">Product Categories</span>
                <span className="text-slate-800 font-medium">
                  {Array.isArray(supplier.product_categories) ? supplier.product_categories.join(', ') : supplier.category || '—'}
                </span>
              </div>
            </div>
          </div>

          {/* Key Contacts Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Contact Persons</h3>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Mobile</th>
                  <th className="px-6 py-3">Email</th>
                  <th className="px-6 py-3 text-center">Primary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {supplier.contacts?.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-slate-400">No additional contacts listed</td>
                  </tr>
                ) : (
                  supplier.contacts?.map((c) => (
                    <tr key={c.id || c.name} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 font-bold text-slate-800">{c.name}</td>
                      <td className="px-6 py-3 text-slate-600">{c.mobile}</td>
                      <td className="px-6 py-3 text-slate-600">{c.email || '—'}</td>
                      <td className="px-6 py-3 text-center">
                        {c.is_primary ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">PRIMARY</span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Directors / Partners */}
          {supplier.directors && supplier.directors.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-slate-200">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Directors / Partners</h3>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3">Director Name</th>
                    <th className="px-6 py-3">DIN</th>
                    <th className="px-6 py-3">Phone</th>
                    <th className="px-6 py-3">Email</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {supplier.directors.map((d) => (
                    <tr key={d.id || d.director_name} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 font-bold text-slate-800">{d.director_name}</td>
                      <td className="px-6 py-3 font-mono">{d.din || '—'}</td>
                      <td className="px-6 py-3 text-slate-600">{d.phone || '—'}</td>
                      <td className="px-6 py-3 text-slate-600">{d.email || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: ADDRESS DETAILS ───────────────────────────────────────────── */}
      {activeTab === 'address' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4 text-blue-600">
              <MapPin className="w-4 h-4" />
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Registered Office</h3>
            </div>
            <p className="text-sm text-slate-800 font-medium leading-relaxed">
              {supplier.address || 'No registered address recorded.'}
            </p>
            <div className="mt-4 pt-4 border-t border-slate-100 space-y-1 text-xs text-slate-500">
              <p>City: <strong className="text-slate-700">{supplier.city || '—'}</strong></p>
              <p>State: <strong className="text-slate-700">{supplier.state} ({supplier.state_code || '—'})</strong></p>
              <p>PIN Code: <strong className="text-slate-700">{supplier.pincode || '—'}</strong></p>
              <p>Country: <strong className="text-slate-700">{supplier.country || 'India'}</strong></p>
            </div>
          </div>

          {supplier.addresses?.map((addr, idx) => (
            <div key={idx} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4 text-indigo-600">
                <Building2 className="w-4 h-4" />
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">{addr.address_type} Address</h3>
              </div>
              <p className="text-sm text-slate-800 font-medium leading-relaxed">{addr.address}</p>
              <div className="mt-4 pt-4 border-t border-slate-100 space-y-1 text-xs text-slate-500">
                <p>City: <strong className="text-slate-700">{addr.city}</strong></p>
                <p>State: <strong className="text-slate-700">{addr.state}</strong></p>
                <p>PIN Code: <strong className="text-slate-700">{addr.pincode}</strong></p>
                <p>Country: <strong className="text-slate-700">{addr.country}</strong></p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── TAB 4: GST & TAX DETAILS ─────────────────────────────────────────── */}
      {activeTab === 'tax' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-black text-slate-900 border-l-4 border-blue-600 pl-3 mb-6 uppercase tracking-wider">
              Statutory Tax Identifiers
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 text-xs">
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Primary GSTIN</span>
                <span className="block font-mono text-base font-black text-slate-900 mt-1">{supplier.gst_number || 'Unregistered'}</span>
                <span className="text-[10px] text-slate-500 mt-1 block">State Code: {supplier.state_code || '—'}</span>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 font-bold uppercase text-[10px]">PAN Number</span>
                <span className="block font-mono text-base font-black text-slate-900 mt-1">{supplier.pan_number || '—'}</span>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 font-bold uppercase text-[10px]">CIN / LLPIN</span>
                <span className="block font-mono text-base font-black text-slate-900 mt-1">{supplier.cin_number || '—'}</span>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 font-bold uppercase text-[10px]">TAN Number</span>
                <span className="block font-mono text-base font-black text-slate-900 mt-1">{supplier.tan_number || '—'}</span>
              </div>
            </div>
          </div>

          {/* Multi-state GSTINs */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Registered GSTIN Branches (Multi-State)</h3>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">GSTIN</th>
                  <th className="px-6 py-3">State</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3 text-center">Primary</th>
                  <th className="px-6 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {supplier.gstins?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-6 text-slate-400">Single state GSTIN registered</td>
                  </tr>
                ) : (
                  supplier.gstins?.map((g) => (
                    <tr key={g.id || g.gstin} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 font-mono font-bold text-slate-900">{g.gstin}</td>
                      <td className="px-6 py-3">{g.state_name || g.state_code}</td>
                      <td className="px-6 py-3">{g.registration_type}</td>
                      <td className="px-6 py-3 text-center">
                        {g.is_primary ? <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-700">PRIMARY</span> : '—'}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${g.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {g.is_active ? 'ACTIVE' : 'INACTIVE'}
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

      {/* ── TAB 5: BANK DETAILS ─────────────────────────────────────────────── */}
      {activeTab === 'bank' && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-sm max-w-2xl">
          <h3 className="text-sm font-black text-slate-900 border-l-4 border-blue-600 pl-3 mb-6 uppercase tracking-wider">
            Verified Bank Account
          </h3>
          <div className="space-y-4 text-xs">
            <div className="flex justify-between py-2 border-b border-slate-100">
              <span className="text-slate-400 font-bold uppercase">Bank Name</span>
              <span className="text-sm font-bold text-slate-800">{supplier.financial?.bank_name || 'Not provided'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-100">
              <span className="text-slate-400 font-bold uppercase">Account Number</span>
              <span className="font-mono text-sm font-bold text-slate-900">{supplier.financial?.account_no || '—'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-100">
              <span className="text-slate-400 font-bold uppercase">IFSC Code</span>
              <span className="font-mono text-sm font-bold text-slate-900">{supplier.financial?.ifsc_code || '—'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-100">
              <span className="text-slate-400 font-bold uppercase">Branch Name</span>
              <span className="text-slate-700 font-medium">{supplier.financial?.branch || '—'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-100">
              <span className="text-slate-400 font-bold uppercase">Credit Limit</span>
              <span className="text-sm font-bold text-slate-900">₹{Number(supplier.financial?.credit_limit || 0).toLocaleString('en-IN')}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-slate-400 font-bold uppercase">Credit Days</span>
              <span className="text-sm font-bold text-slate-900">{supplier.financial?.credit_days || supplier.credit_limit_days || 0} Days</span>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 6: PAYMENT & COMMERCIAL TERMS ────────────────────────────────── */}
      {activeTab === 'terms' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h3 className="text-sm font-black text-slate-900 border-l-4 border-blue-600 pl-3 mb-4 uppercase tracking-wider">
              Commercial Agreement
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
              <div className="p-4 bg-slate-50 rounded-lg">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Payment Cycle</span>
                <p className="text-slate-800 font-bold text-sm mt-1">{supplier.credit_limit_days || 0} Days Credit</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Opening Balance</span>
                <p className="text-slate-800 font-bold text-sm mt-1">₹{Number(supplier.opening_balance || 0).toFixed(2)}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Configured Terms & Conditions</h3>
            </div>
            <div className="p-6 space-y-4">
              {terms.length === 0 ? (
                <p className="text-sm text-slate-400">No custom terms configured for this supplier.</p>
              ) : (
                terms.map((t, idx) => (
                  <div key={t.id} className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700">
                    <span className="font-bold text-slate-900 mr-2">#{idx + 1}</span>
                    {t.terms_text}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 7: DOCUMENTS & CERTIFICATES ─────────────────────────────────── */}
      {activeTab === 'documents' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center flex-wrap gap-4">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Uploaded Documents</h3>
              <p className="text-xs text-slate-500">Legal, compliance, and statutory certificates attached to this supplier</p>
            </div>
            <button
              onClick={() => setDocUploadModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-sm transition-all"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload Document
            </button>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Document Type</th>
                <th className="px-6 py-3">Valid From</th>
                <th className="px-6 py-3">Valid To</th>
                <th className="px-6 py-3">Notes / Ref</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {supplier.documents?.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-400">
                    <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="font-semibold text-slate-600">No documents uploaded yet</p>
                    <p className="text-[11px] text-slate-400 mt-1">Click the "Upload Document" button above to attach GST, PAN, FSSAI, or bank proofs.</p>
                  </td>
                </tr>
              ) : (
                supplier.documents?.map((d) => (
                  <tr key={d.id || d.document_type} className="hover:bg-slate-50/50">
                    <td className="px-6 py-3 font-bold text-slate-800 flex items-center gap-2">
                      <FileCheck className="w-4 h-4 text-blue-600" />
                      {d.document_type}
                    </td>
                    <td className="px-6 py-3 text-slate-500">{d.start_date || '—'}</td>
                    <td className="px-6 py-3 text-slate-500">{d.end_date || '—'}</td>
                    <td className="px-6 py-3 text-slate-600">{d.notes || '—'}</td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {d.file_path && (
                          <a
                            href={d.file_path.startsWith('http') ? d.file_path : `${d.file_path}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 font-bold"
                          >
                            View / Download
                          </a>
                        )}
                        <button
                          onClick={() => handleDeleteDocument(d.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                          title="Delete document"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB 8: PRODUCTS & BRANDS ────────────────────────────────────────── */}
      {activeTab === 'products' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Associated Brands</h3>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">Brand ID</th>
                  <th className="px-6 py-3">Brand Name</th>
                  <th className="px-6 py-3 text-right">Credit Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {supplier.brands?.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-center py-6 text-slate-400">No brands associated</td>
                  </tr>
                ) : (
                  supplier.brands?.map((b) => (
                    <tr key={b.brand_id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 font-mono text-slate-500">{b.brand_id}</td>
                      <td className="px-6 py-3 font-bold text-slate-800">{b.brand_name || 'Brand'}</td>
                      <td className="px-6 py-3 text-right text-slate-700">{b.credit_days || 0} Days</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── TAB 9: PURCHASE ORDERS ───────────────────────────────────────────── */}
      {activeTab === 'pos' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Purchase Orders</h3>
            <span className="text-xs text-slate-400">{pos.length} Orders</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">PO Number</th>
                <th className="px-6 py-3">PO Date</th>
                <th className="px-6 py-3">Expected Date</th>
                <th className="px-6 py-3">Items / Qty</th>
                <th className="px-6 py-3 text-right">Total Amount</th>
                <th className="px-6 py-3 text-center">Vendor Ack</th>
                <th className="px-6 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {subLoading ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">Loading purchase orders…</td></tr>
              ) : pos.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">No purchase orders found for this supplier</td></tr>
              ) : (
                pos.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-3 font-mono font-bold text-blue-600">
                      <Link to={`/purchases/po/${p.id}`} className="hover:underline">
                        {p.po_no}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-slate-600">{p.po_date}</td>
                    <td className="px-6 py-3 text-slate-600">{p.expected_date || '—'}</td>
                    <td className="px-6 py-3 text-slate-700">
                      {p.item_count} items ({p.total_received_qty} / {p.total_ordered_qty} rec)
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-slate-900">₹{p.total_amount?.toFixed(2)}</td>
                    <td className="px-6 py-3 text-center">
                      {p.vendor_ack ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          ACKNOWLEDGED
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">
                          PENDING
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-center">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700">
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB 10: GRN / GOODS RECEIVED ────────────────────────────────────── */}
      {activeTab === 'grns' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Goods Received Notes (GRN)</h3>
            <span className="text-xs text-slate-400">{grns.length} Receipts</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">GRN #</th>
                <th className="px-6 py-3">Invoice # / Date</th>
                <th className="px-6 py-3">Total Qty</th>
                <th className="px-6 py-3 text-right">Taxable</th>
                <th className="px-6 py-3 text-right">Total Amount</th>
                <th className="px-6 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {subLoading ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">Loading GRN receipts…</td></tr>
              ) : grns.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-slate-400">No posted GRN receipts found</td></tr>
              ) : (
                grns.map((g) => (
                  <tr key={g.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-3 font-mono font-bold text-slate-900">{g.purchase_no}</td>
                    <td className="px-6 py-3 text-slate-700">
                      {g.invoice_no || '—'} <span className="text-slate-400">({g.invoice_date})</span>
                    </td>
                    <td className="px-6 py-3 text-slate-700 font-bold">{g.total_qty}</td>
                    <td className="px-6 py-3 text-right font-mono">₹{g.taxable_amount?.toFixed(2)}</td>
                    <td className="px-6 py-3 text-right font-mono font-bold text-slate-900">₹{g.total_amount?.toFixed(2)}</td>
                    <td className="px-6 py-3 text-center">
                      <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 text-emerald-800">
                        {g.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB 11: ITEM SALES REPORTS ───────────────────────────────────────── */}
      {activeTab === 'sales' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Vendor Portal Sales Reporting</h3>
              <p className="text-xs text-slate-500 mt-1">
                Sales data visibility in the vendor's external portal is currently{' '}
                <strong className={supplier.portal_sales_enabled ? 'text-emerald-600' : 'text-rose-600'}>
                  {supplier.portal_sales_enabled ? 'ENABLED' : 'DISABLED'}
                </strong>.
              </p>
            </div>
            <button
              onClick={() => setPortalModal(true)}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-all"
            >
              Configure Vendor Permissions
            </button>
          </div>

          {salesData && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Units Sold</span>
                  <p className="text-2xl font-black text-slate-800 mt-2">{salesData.summary?.total_qty || 0}</p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Sales Revenue</span>
                  <p className="text-2xl font-black text-blue-600 mt-2">
                    ₹{Number(salesData.summary?.total_value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mapped Products</span>
                  <p className="text-2xl font-black text-slate-800 mt-2">{salesData.summary?.product_count || 0}</p>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-3">Product Name</th>
                      <th className="px-6 py-3">Item Code</th>
                      <th className="px-6 py-3">Barcode</th>
                      <th className="px-6 py-3">Brand</th>
                      <th className="px-6 py-3 text-right">MRP</th>
                      <th className="px-6 py-3 text-right">Current Stock</th>
                      <th className="px-6 py-3 text-right">Qty Sold</th>
                      <th className="px-6 py-3 text-right">Sales Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-medium">
                    {salesData.products?.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-8 text-slate-400">No products linked to this supplier</td></tr>
                    ) : (
                      salesData.products?.map((p: any) => (
                        <tr key={p.product_id} className="hover:bg-slate-50/50">
                          <td className="px-6 py-3 font-bold text-slate-900">{p.product_name}</td>
                          <td className="px-6 py-3 font-mono text-slate-500">{p.item_code || '—'}</td>
                          <td className="px-6 py-3 font-mono text-slate-500">{p.barcode || '—'}</td>
                          <td className="px-6 py-3 text-slate-600">{p.brand || '—'}</td>
                          <td className="px-6 py-3 text-right font-mono">₹{p.mrp?.toFixed(2)}</td>
                          <td className="px-6 py-3 text-right font-mono text-slate-700">{p.current_stock}</td>
                          <td className="px-6 py-3 text-right font-bold text-blue-600">{p.sales_qty}</td>
                          <td className="px-6 py-3 text-right font-bold text-slate-900">₹{p.sales_value?.toFixed(2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── TAB 12: NEW ITEM REQUESTS ────────────────────────────────────────── */}
      {activeTab === 'item_requests' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-slate-200 flex justify-between items-center">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Vendor New Item Proposals</h3>
            <span className="text-xs text-slate-400">{itemRequests.length} Proposals</span>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Request #</th>
                <th className="px-6 py-3">Product Name</th>
                <th className="px-6 py-3">Barcode</th>
                <th className="px-6 py-3 text-right">Purchase Rate</th>
                <th className="px-6 py-3 text-right">Suggested MRP</th>
                <th className="px-6 py-3 text-center">Status</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {subLoading ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">Loading item proposals…</td></tr>
              ) : itemRequests.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-slate-400">No new item proposals from this vendor</td></tr>
              ) : (
                itemRequests.map((it) => (
                  <tr key={it.id} className="hover:bg-slate-50/50">
                    <td className="px-6 py-3 font-mono font-bold text-blue-600">{it.request_no}</td>
                    <td className="px-6 py-3 font-bold text-slate-900">
                      {it.product_name}
                      <span className="block text-[10px] text-slate-400 font-normal">{it.brand_name || 'Generic'} • {it.unit}</span>
                    </td>
                    <td className="px-6 py-3 font-mono text-slate-600">{it.barcode || '—'}</td>
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
                    <td className="px-6 py-3 text-right">
                      {it.status === 'submitted' || it.status === 'under_review' ? (
                        <button
                          onClick={() => {
                            setSelectedItemReq(it)
                            setItemReviewAction('approve')
                            setItemReviewNotes('')
                            setReviewItemModal(true)
                          }}
                          className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold"
                        >
                          Review & Action
                        </button>
                      ) : (
                        <span className="text-slate-400">Reviewed</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── TAB 13: ACTIVITY & AUDIT HISTORY ─────────────────────────────────── */}
      {activeTab === 'audit' && (
        <div className="space-y-6">
          {/* Pending Profile Change Requests */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                Vendor Profile Change Requests (Approval Queue)
              </h3>
            </div>
            <div className="p-6 space-y-4">
              {profileRequests.length === 0 ? (
                <p className="text-sm text-slate-400">No profile change requests filed.</p>
              ) : (
                profileRequests.map((pr) => (
                  <div key={pr.id} className="p-5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-800">Request #{pr.id}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          pr.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : pr.status === 'rejected' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {pr.status}
                        </span>
                      </div>
                      <span className="text-xs text-slate-400">
                        {new Date(pr.created_at).toLocaleString('en-IN')}
                      </span>
                    </div>

                    {/* Diffs */}
                    <div className="bg-white p-3 rounded-lg border border-slate-200 text-xs">
                      <p className="font-bold text-slate-500 uppercase text-[10px] mb-2">Requested Changes:</p>
                      <div className="space-y-1 font-mono">
                        {Object.entries(pr.changes || {}).map(([key, val]: any) => (
                          <div key={key} className="flex gap-4">
                            <span className="text-slate-600 font-bold">{key}:</span>
                            <span className="text-slate-400 line-through">{String(val?.old ?? 'None')}</span>
                            <span className="text-emerald-600 font-bold">→ {String(val?.new ?? val)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {pr.status === 'pending' && (
                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          onClick={() => {
                            setSelectedProfileReq(pr)
                            setProfileReviewAction('approve')
                            setProfileReviewNotes('')
                            setReviewProfileModal(true)
                          }}
                          className="px-3.5 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700"
                        >
                          Approve Changes
                        </button>
                        <button
                          onClick={() => {
                            setSelectedProfileReq(pr)
                            setProfileReviewAction('reject')
                            setProfileReviewNotes('')
                            setReviewProfileModal(true)
                          }}
                          className="px-3.5 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-bold hover:bg-rose-700"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Immutable Audit Logs */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Approval & Status Audit Trail</h3>
            </div>
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase font-bold text-left border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3">Timestamp</th>
                  <th className="px-6 py-3">Action</th>
                  <th className="px-6 py-3">From → To</th>
                  <th className="px-6 py-3">Remarks</th>
                  <th className="px-6 py-3">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {supplier.approval_logs?.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-6 text-slate-400">No status changes recorded</td></tr>
                ) : (
                  supplier.approval_logs?.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/50">
                      <td className="px-6 py-3 text-slate-500">{new Date(l.created_at).toLocaleString('en-IN')}</td>
                      <td className="px-6 py-3 font-bold uppercase text-slate-800">{l.action}</td>
                      <td className="px-6 py-3 text-slate-600">{l.from_status || '—'} → {l.to_status}</td>
                      <td className="px-6 py-3 text-slate-700">{l.remarks || '—'}</td>
                      <td className="px-6 py-3 text-slate-500">{l.performed_by_name || 'System'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── MODAL: VENDOR PORTAL SETTINGS ────────────────────────────────────── */}
      <Modal open={portalModal} onClose={() => setPortalModal(false)} title="Vendor Portal Security & Sales Settings">
        <div className="p-6 space-y-6 text-xs">
          <p className="text-slate-600">
            Control what this vendor is authorized to view in their self-service Vendor Portal.
          </p>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
            <div>
              <span className="text-sm font-bold text-slate-900 block">Allow Item Sales Reports</span>
              <span className="text-xs text-slate-500">Enable or completely disable sales analytics for this vendor</span>
            </div>
            <input
              type="checkbox"
              checked={portalSalesEnabled}
              onChange={(e) => setPortalSalesEnabled(e.target.checked)}
              className="w-5 h-5 text-blue-600 rounded"
            />
          </div>

          <div className={`space-y-3 transition-opacity ${portalSalesEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            <span className="text-slate-400 font-bold uppercase tracking-wider text-[10px] block">Granular Field Permissions</span>
            {[
              { key: 'view_sales_quantity', label: 'View Sales Quantity (Units)' },
              { key: 'view_sales_value', label: 'View Sales Value (₹ Revenue)' },
              { key: 'view_outlet_wise', label: 'View Outlet-Wise Breakdown' },
              { key: 'view_stock_position', label: 'View Current Available Stock' },
              { key: 'export_allowed', label: 'Allow Exporting Sales Reports (Excel/CSV)' },
            ].map((f) => (
              <label key={f.key} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={Boolean(portalSalesConfig[f.key])}
                  onChange={(e) => setPortalSalesConfig({ ...portalSalesConfig, [f.key]: e.target.checked })}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <span className="text-xs font-bold text-slate-800">{f.label}</span>
              </label>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              onClick={() => setPortalModal(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              onClick={handleSavePortalSettings}
              disabled={savingPortal}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
            >
              {savingPortal ? 'Saving…' : 'Save Portal Permissions'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: REVIEW NEW ITEM REQUEST ──────────────────────────────────── */}
      <Modal open={reviewItemModal} onClose={() => setReviewItemModal(false)} title={`Review Proposal #${selectedItemReq?.request_no}`}>
        <div className="p-6 space-y-4 text-xs">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
            <p className="font-bold text-slate-900 text-sm">{selectedItemReq?.product_name}</p>
            <div className="grid grid-cols-2 gap-2 text-slate-600">
              <p>Brand: <strong>{selectedItemReq?.brand_name || 'Generic'}</strong></p>
              <p>Barcode: <strong className="font-mono">{selectedItemReq?.barcode || 'None'}</strong></p>
              <p>Purchase Rate: <strong>₹{selectedItemReq?.purchase_rate}</strong></p>
              <p>Suggested MRP: <strong>₹{selectedItemReq?.mrp}</strong></p>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Decision</label>
            <div className="flex gap-2">
              {[
                { val: 'approve', label: 'Approve Proposal' },
                { val: 'reject', label: 'Reject' },
                { val: 'correction_requested', label: 'Request Correction' },
              ].map((d) => (
                <button
                  key={d.val}
                  type="button"
                  onClick={() => setItemReviewAction(d.val as any)}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg border transition-all ${
                    itemReviewAction === d.val
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {itemReviewAction === 'approve' && (
            <label className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={createProductAuto}
                onChange={(e) => setCreateProductAuto(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded"
              />
              <span className="text-xs font-bold text-emerald-800">
                Automatically add to live ERP Item Master immediately
              </span>
            </label>
          )}

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Internal / Review Notes</label>
            <textarea
              value={itemReviewNotes}
              onChange={(e) => setItemReviewNotes(e.target.value)}
              placeholder="Enter feedback or decision rationale…"
              className="w-full border border-slate-200 rounded-lg p-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              onClick={() => setReviewItemModal(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitItemReview}
              disabled={savingItemReview}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
            >
              {savingItemReview ? 'Submitting…' : 'Submit Review'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: REVIEW PROFILE REQUEST ───────────────────────────────────── */}
      <Modal open={reviewProfileModal} onClose={() => setReviewProfileModal(false)} title={`Review Profile Request #${selectedProfileReq?.id}`}>
        <div className="p-6 space-y-4 text-xs">
          <p className="text-slate-600">
            {profileReviewAction === 'approve'
              ? 'Approving will immediately update the supplier’s live master profile with the requested changes.'
              : 'Rejecting will mark this request as declined without modifying the live profile.'}
          </p>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Review Notes</label>
            <textarea
              value={profileReviewNotes}
              onChange={(e) => setProfileReviewNotes(e.target.value)}
              placeholder="Optional notes for audit log…"
              className="w-full border border-slate-200 rounded-lg p-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              onClick={() => setReviewProfileModal(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmitProfileReview}
              disabled={savingProfileReview}
              className={`px-5 py-2 text-white rounded-lg font-bold disabled:opacity-50 ${
                profileReviewAction === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
              }`}
            >
              {savingProfileReview ? 'Processing…' : profileReviewAction === 'approve' ? 'Approve & Update Profile' : 'Reject Request'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: ADD NOTE ─────────────────────────────────────────────────── */}
      <Modal open={noteModal} onClose={() => setNoteModal(false)} title="Add Internal Note">
        <div className="p-6 space-y-4 text-xs">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Type confidential internal remark regarding this vendor…"
            className="w-full border border-slate-200 rounded-lg p-3 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={4}
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setNoteModal(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              onClick={handleAddNote}
              disabled={savingNote}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
            >
              {savingNote ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: UPLOAD DOCUMENT ─────────────────────────────────────────── */}
      <Modal open={docUploadModal} onClose={() => setDocUploadModal(false)} title="Upload Supplier Document">
        <form onSubmit={handleUploadDocument} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Document Type *</label>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="w-full border border-slate-200 rounded-lg p-2.5 text-xs bg-white font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {[
                'GST Certificate',
                'PAN Card',
                'Cancelled Cheque',
                'Bank Proof',
                'MSME / Udyam Certificate',
                'FSSAI License',
                'Trade License',
                'Drug License',
                'Import Export Code (IEC)',
                'Certificate of Incorporation (CIN)',
                'Partnership Deed',
                'Vendor Agreement / Contract',
                'Product Catalog',
                'Other',
              ].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Select File (PDF, PNG, JPG, WEBP) *</label>
            <input
              type="file"
              required
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              onChange={(e) => setDocFile(e.target.files?.[0] || null)}
              className="w-full border border-slate-200 rounded-lg p-2 text-xs bg-slate-50 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
            />
            {docFile && (
              <p className="text-[11px] text-emerald-600 font-bold mt-1">
                Selected: {docFile.name} ({(docFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Valid From (Issue Date)</label>
              <input
                type="date"
                value={docStartDate}
                onChange={(e) => setDocStartDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Valid Till (Expiry Date)</label>
              <input
                type="date"
                value={docEndDate}
                onChange={(e) => setDocEndDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">Notes / Certificate Number</label>
            <input
              type="text"
              value={docNotes}
              onChange={(e) => setDocNotes(e.target.value)}
              placeholder="e.g. Registration number or remarks…"
              className="w-full border border-slate-200 rounded-lg p-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setDocUploadModal(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploadingDoc}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50"
            >
              {uploadingDoc ? 'Uploading…' : 'Upload Document'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL: CREATE / EDIT VENDOR LOGIN ──────────────────────────────── */}
      <Modal
        open={createLoginModal}
        onClose={() => setCreateLoginModal(false)}
        title={portalAccessData?.has_account ? "Edit Vendor Portal Login" : "Create Vendor Portal Login"}
      >
        <form onSubmit={handleCreateOrUpdateLogin} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
              Username * (3-50 characters, letters, numbers, underscores)
            </label>
            <input
              type="text"
              required
              value={loginForm.username}
              onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
              placeholder="e.g. sup_0020 or vendor_company"
              className="w-full border border-slate-200 rounded-lg p-2.5 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              This username will be used by the supplier to log in to the portal.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
              Notification Email (Optional)
            </label>
            <input
              type="email"
              value={loginForm.email}
              onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
              placeholder="e.g. contact@vendor.com"
              className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
              {portalAccessData?.has_account ? "Change Password (Leave blank to keep existing)" : "Initial Password (Optional)"}
            </label>
            <input
              type="password"
              value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              placeholder="Leave blank to generate secure activation link"
              className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-[11px] text-blue-600 font-medium mt-1">
              Tip: If left blank, a single-use activation link will be generated so the vendor sets their own confidential password.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setCreateLoginModal(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingLogin}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {savingLogin ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              {portalAccessData?.has_account ? 'Update Credentials' : 'Create & Generate Access'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── MODAL: SEND INVITATION ─────────────────────────────────────────── */}
      <Modal
        open={inviteModal}
        onClose={() => setInviteModal(false)}
        title={`Supplier Portal Invitation — ${supplier.name}`}
      >
        <div className="p-6 space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed">
            Share this invitation with the vendor via Email, WhatsApp, or formal purchase correspondence:
          </p>

          <div className="p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase text-blue-800 tracking-wider">Direct Portal Link</span>
              <button
                type="button"
                onClick={() => {
                  const fullUrl = `${window.location.origin}${portalAccessData?.portal_link || '/vendor/login'}`
                  navigator.clipboard.writeText(fullUrl)
                  toast.success('Portal Link copied!')
                }}
                className="text-[11px] text-blue-700 font-bold hover:underline flex items-center gap-1"
              >
                <Copy className="w-3 h-3" /> Copy Link
              </button>
            </div>
            <p className="font-mono text-xs text-blue-900 break-all font-bold">
              {window.location.origin}{portalAccessData?.portal_link || '/vendor/login'}
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
              Invitation Message Template
            </label>
            <textarea
              rows={9}
              value={inviteText}
              onChange={(e) => setInviteText(e.target.value)}
              className="w-full border border-slate-200 rounded-lg p-3 text-xs font-mono bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-between items-center gap-3 pt-3 border-t border-slate-100 flex-wrap">
            <a
              href={`https://api.whatsapp.com/send?text=${encodeURIComponent(inviteText)}`}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 text-xs flex items-center gap-1.5"
            >
              Share via WhatsApp
            </a>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(inviteText)
                  toast.success('Invitation text copied to clipboard!')
                }}
                className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700 font-bold hover:bg-slate-50 flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Text
              </button>
              <button
                type="button"
                onClick={() => setInviteModal(false)}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: RESET PASSWORD ───────────────────────────────────────────── */}
      <Modal
        open={resetPwdModal}
        onClose={() => setResetPwdModal(false)}
        title="Reset Vendor Password"
      >
        <form onSubmit={handleResetPassword} className="p-6 space-y-4 text-xs">
          {resetResultLink ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800">
                <p className="font-bold flex items-center gap-1.5 text-sm mb-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Password Reset Link Ready!
                </p>
                <p className="text-xs text-emerald-700">
                  This secure link is single-use and will expire in 48 hours. Share it with the vendor:
                </p>
                <div className="mt-3 p-2 bg-white rounded-lg border border-emerald-300 font-mono text-xs break-all text-slate-800 font-bold">
                  {window.location.origin}{resetResultLink}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}${resetResultLink}`)
                    toast.success('Reset link copied!')
                  }}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy Link
                </button>
                <button
                  type="button"
                  onClick={() => setResetPwdModal(false)}
                  className="px-4 py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-slate-700"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-500 mb-2">Reset Mode</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setResetPwdMode('link')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      resetPwdMode === 'link'
                        ? 'border-blue-600 bg-blue-50 text-blue-900 ring-2 ring-blue-500/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <p className="font-bold text-xs">Generate Reset Link</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Expiring 48-hr link (Recommended)</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setResetPwdMode('password')}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      resetPwdMode === 'password'
                        ? 'border-blue-600 bg-blue-50 text-blue-900 ring-2 ring-blue-500/20'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <p className="font-bold text-xs">Set Direct Password</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">Admin types password directly</p>
                  </button>
                </div>
              </div>

              {resetPwdMode === 'password' && (
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-500 mb-1">
                    New Password *
                  </label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newDirectPassword}
                    onChange={(e) => setNewDirectPassword(e.target.value)}
                    placeholder="Enter at least 6 characters…"
                    className="w-full border border-slate-200 rounded-lg p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setResetPwdModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingResetPwd}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {savingResetPwd ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
                  {resetPwdMode === 'link' ? 'Generate Link' : 'Set Password'}
                </button>
              </div>
            </>
          )}
        </form>
      </Modal>

      {/* ── MODAL: MANAGE PERMISSIONS ───────────────────────────────────────── */}
      <Modal
        open={permissionsModal}
        onClose={() => setPermissionsModal(false)}
        title={`Vendor Portal Permissions — ${supplier.name}`}
      >
        <div className="p-6 space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed">
            Configure granular access permissions for this vendor. Changes take effect immediately across all screens and backend APIs:
          </p>

          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {[
              { category: 'Purchase Orders', items: [
                { key: 'view_pos', label: 'View Purchase Orders' },
                { key: 'download_po', label: 'Download & Print PO PDFs' },
              ]},
              { category: 'Goods Received (GRN)', items: [
                { key: 'view_grn', label: 'View GRN Receipts' },
                { key: 'download_grn', label: 'Download GRN Documents' },
              ]},
              { category: 'Purchase Returns (PRN)', items: [
                { key: 'view_prn', label: 'View Purchase Return Notes (PRN)' },
                { key: 'download_prn', label: 'Download PRN Documents' },
              ]},
              { category: 'Financials & Accounts', items: [
                { key: 'view_cheques', label: 'View Issued Cheques & Clearing Status' },
                { key: 'view_payments', label: 'View Payment History & Allocations' },
                { key: 'view_ledger', label: 'View Reconciled Supplier Ledger' },
                { key: 'download_statement', label: 'Download Account Statements' },
              ]},
              { category: 'Item Sales Intelligence', items: [
                { key: 'view_sales', label: 'Enable Item Sales Reports' },
                { key: 'view_sales_quantity', label: 'View Sales Quantity' },
                { key: 'view_sales_value', label: 'View Sales Value (Revenue)' },
                { key: 'view_outlet_sales', label: 'View Outlet-Wise Sales Breakdown' },
              ]},
              { category: 'Self-Service Proposals & Profile', items: [
                { key: 'view_item_requests', label: 'View New Item Proposals' },
                { key: 'submit_item_requests', label: 'Submit New Product Listings' },
                { key: 'edit_profile', label: 'Submit Profile & Banking Update Requests' },
              ]},
            ].map((grp) => (
              <div key={grp.category} className="border border-slate-200 rounded-xl p-3 bg-slate-50/50">
                <p className="text-[10px] font-black uppercase text-slate-500 mb-2 tracking-wider">{grp.category}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {grp.items.map((it) => (
                    <label key={it.key} className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={Boolean(portalPerms[it.key])}
                        onChange={(e) => setPortalPerms({ ...portalPerms, [it.key]: e.target.checked })}
                        className="w-4 h-4 text-blue-600 rounded"
                      />
                      <span className="font-bold text-slate-800 text-[11px]">{it.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setPermissionsModal(false)}
              className="px-4 py-2 border border-slate-200 rounded-lg text-slate-600 font-bold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSavePortalPermissions}
              disabled={savingPerms}
              className="px-5 py-2 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              {savingPerms ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Shield className="w-3.5 h-3.5" />}
              Save All Permissions
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

