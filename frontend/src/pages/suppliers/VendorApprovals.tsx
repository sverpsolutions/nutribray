import { matchesSearch } from '../../utils/search';
import { useEffect, useRef, useState } from 'react'
import {
  suppliers_api,
  type supplier_list_item,
  type supplier_detail,
  type approval_log,
} from '../../api/suppliers'
import { toast, Toaster } from 'react-hot-toast'

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  pending:            { label: 'Pending',            bg: 'bg-slate-100',  text: 'text-slate-600',  dot: 'bg-slate-400' },
  submitted:          { label: 'Submitted',          bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500' },
  under_review:       { label: 'Under Review',       bg: 'bg-purple-100', text: 'text-purple-700', dot: 'bg-purple-500' },
  correction_pending: { label: 'Correction Pending', bg: 'bg-yellow-100', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  hold:               { label: 'On Hold',            bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
  approved:           { label: 'Approved',           bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500' },
  rejected:           { label: 'Rejected',           bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500' },
}

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.pending
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${m.bg} ${m.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`}></span>
      {m.label}
    </span>
  )
}

// ── Document preview ──────────────────────────────────────────────────────────

function DocPreview({ path, label }: { path: string; label: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!path) return null

  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(path)
  const isPdf = /\.pdf$/i.test(path)
  const url = path.startsWith('http') ? path : `/uploads/${path.replace(/^\/uploads\//, '')}`

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
        <span className="text-[11px] font-bold text-slate-600 truncate">{label}</span>
        <div className="flex gap-1 shrink-0">
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-[10px] px-2 py-1 rounded bg-white border border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            {expanded ? 'Collapse' : 'Preview'}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            download
            className="text-[10px] px-2 py-1 rounded bg-white border border-slate-200 text-slate-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            ↓ Download
          </a>
        </div>
      </div>
      {expanded && (
        <div className="bg-slate-100">
          {isImg ? (
            <img src={url} alt={label} className="w-full object-contain max-h-96" />
          ) : isPdf ? (
            <iframe src={url} title={label} className="w-full h-96 border-0" />
          ) : (
            <div className="p-4 text-center text-slate-400 text-sm">
              <i className="fas fa-file text-3xl block mb-2"></i>
              Preview not available — <a href={url} target="_blank" className="text-blue-600 underline">open file</a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Collapsible section ───────────────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <i className={`${icon} text-blue-600 text-sm w-4`}></i>
          <span className="text-[11px] font-black text-slate-700 uppercase tracking-widest">{title}</span>
        </div>
        <i className={`fas fa-chevron-${open ? 'up' : 'down'} text-slate-400 text-xs`}></i>
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{label}</p>
      <p className="text-[13px] font-semibold text-slate-800">{value || <span className="text-slate-300 font-normal">—</span>}</p>
    </div>
  )
}

// ── Action log timeline entry ─────────────────────────────────────────────────

const LOG_ICONS: Record<string, { icon: string; color: string }> = {
  submitted:            { icon: 'fa-paper-plane', color: 'text-blue-500' },
  under_review:         { icon: 'fa-search',      color: 'text-purple-500' },
  approved:             { icon: 'fa-check-circle', color: 'text-green-500' },
  rejected:             { icon: 'fa-times-circle', color: 'text-red-500' },
  hold:                 { icon: 'fa-pause-circle', color: 'text-orange-500' },
  correction_requested: { icon: 'fa-edit',         color: 'text-yellow-600' },
}

function LogEntry({ log }: { log: approval_log }) {
  const meta = LOG_ICONS[log.action] ?? { icon: 'fa-circle', color: 'text-slate-400' }
  const dt = new Date(log.created_at)
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full bg-white border-2 border-current flex items-center justify-center ${meta.color}`}>
          <i className={`fas ${meta.icon} text-xs`}></i>
        </div>
        <div className="flex-1 w-px bg-slate-200 mt-1"></div>
      </div>
      <div className="pb-4">
        <p className="text-[11px] font-bold text-slate-700 capitalize">{log.action.replace(/_/g, ' ')}</p>
        {log.remarks && <p className="text-[11px] text-slate-500 mt-0.5 italic">"{log.remarks}"</p>}
        <p className="text-[10px] text-slate-400 mt-1">
          {log.performed_by_name || 'System'} · {dt.toLocaleDateString('en-IN')} {dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type FilterStatus = 'all' | 'submitted' | 'under_review' | 'correction_pending' | 'hold' | 'rejected'

export default function VendorApprovals() {
  // ── List state ─────────────────────────────────────────────────────────────
  const [items, setItems] = useState<supplier_list_item[]>([])
  const [filteredItems, setFilteredItems] = useState<supplier_list_item[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all')
  const [search, setSearch] = useState('')

  // ── Detail state ───────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<supplier_detail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // ── Action state ───────────────────────────────────────────────────────────
  const [remarks, setRemarks] = useState('')
  const [correctionFields, setCorrectionFields] = useState<string[]>([])
  const [newCorrField, setNewCorrField] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [addingNote, setAddingNote] = useState(false)

  const detailRef = useRef<HTMLDivElement>(null)

  // ── Load list ──────────────────────────────────────────────────────────────
  async function loadList() {
    setLoading(true)
    try {
      const res = await suppliers_api.listPending({ per_page: 200 })
      setItems(res.data.data)
    } catch {
      toast.error('Failed to load vendor applications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadList() }, [])

  // ── Filter logic ───────────────────────────────────────────────────────────
  useEffect(() => {
    let result = items
    if (filterStatus !== 'all') result = result.filter(i => i.registration_status === filterStatus)
    if (search.trim()) {
      result = result.filter(i => matchesSearch(search, i.name, i.phone, i.gst_number))
    }
    setFilteredItems(result)
  }, [items, filterStatus, search])

  // ── Status counts for tab badges ───────────────────────────────────────────
  function countFor(s: string) { return items.filter(i => i.registration_status === s).length }

  // ── Open detail ────────────────────────────────────────────────────────────
  async function openDetail(id: number) {
    setDetailLoading(true)
    setSelected(null)
    setRemarks('')
    setCorrectionFields([])
    setNoteText('')
    try {
      const res = await suppliers_api.get(id)
      setSelected(res.data)
      setTimeout(() => detailRef.current?.scrollTo({ top: 0 }), 50)
    } catch {
      toast.error('Failed to load vendor details')
    } finally {
      setDetailLoading(false)
    }
  }

  // ── Action handlers ────────────────────────────────────────────────────────
  async function doAction(
    fn: () => Promise<any>,
    successMsg: string,
  ) {
    setActionLoading(true)
    try {
      const res = await fn()
      setSelected(res.data)
      toast.success(successMsg)
      loadList()
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Action failed'
      toast.error(detail)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleApprove() {
    if (!selected) return
    doAction(
      () => suppliers_api.approve(selected.id, remarks),
      `✅ Vendor approved! Code: ${selected.supplier_code || '(generating...)'}`,
    )
  }

  async function handleReject() {
    if (!selected) return
    if (!remarks.trim()) { toast.error('Please enter rejection reason'); return }
    doAction(
      () => suppliers_api.reject(selected.id, remarks),
      '❌ Vendor application rejected.',
    )
  }

  async function handleHold() {
    if (!selected) return
    doAction(
      () => suppliers_api.hold(selected.id, remarks),
      '⏸ Vendor placed on hold.',
    )
  }

  async function handleCorrection() {
    if (!selected) return
    if (!remarks.trim()) { toast.error('Please describe what needs correction'); return }
    doAction(
      () => suppliers_api.requestCorrection(selected.id, remarks, correctionFields),
      '📝 Correction request sent to vendor.',
    )
  }

  async function handleUnderReview() {
    if (!selected) return
    doAction(
      () => suppliers_api.markUnderReview(selected.id),
      '🔍 Status changed to Under Review.',
    )
  }

  async function handleAddNote() {
    if (!selected || !noteText.trim()) { toast.error('Enter note text'); return }
    setAddingNote(true)
    try {
      await suppliers_api.addNote(selected.id, noteText.trim())
      toast.success('Note added')
      setNoteText('')
      // Refresh detail
      const res = await suppliers_api.get(selected.id)
      setSelected(res.data)
    } catch {
      toast.error('Failed to add note')
    } finally {
      setAddingNote(false)
    }
  }

  // ── LIST VIEW ──────────────────────────────────────────────────────────────

  if (!selected && !detailLoading) {
    const FILTER_TABS: { key: FilterStatus; label: string }[] = [
      { key: 'all',                label: 'All Pending' },
      { key: 'submitted',          label: 'Submitted' },
      { key: 'under_review',       label: 'Under Review' },
      { key: 'correction_pending', label: 'Correction' },
      { key: 'hold',               label: 'On Hold' },
      { key: 'rejected',           label: 'Rejected' },
    ]

    return (
      <div className="space-y-6 pb-10">
        <Toaster position="top-right" />

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-800 tracking-tight">Vendor Approvals</h1>
            <p className="text-slate-500 text-sm mt-0.5">Review and approve self-registered vendor applications</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border text-xs font-black uppercase tracking-widest ${
              items.length > 0 ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-slate-50 text-slate-400 border-slate-200'
            }`}>
              <span className={`w-2 h-2 rounded-full ${items.length > 0 ? 'bg-blue-500 animate-pulse' : 'bg-slate-300'}`}></span>
              {items.length} Pending
            </span>
            <button onClick={loadList} className="p-2 hover:bg-slate-100 rounded-lg transition-colors" title="Refresh">
              <i className="fas fa-sync text-slate-400 text-sm"></i>
            </button>
          </div>
        </div>

        {/* Filter tabs + search */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
            {FILTER_TABS.map(tab => {
              const cnt = tab.key === 'all' ? items.length : countFor(tab.key)
              return (
                <button
                  key={tab.key}
                  onClick={() => setFilterStatus(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all ${
                    filterStatus === tab.key
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {tab.label}
                  {cnt > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${
                      filterStatus === tab.key ? 'bg-blue-600 text-white' : 'bg-slate-300 text-slate-600'
                    }`}>{cnt}</span>
                  )}
                </button>
              )
            })}
          </div>
          <div className="relative flex-1 max-w-xs">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name, phone, GST..."
              className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>
        </div>

        {/* List */}
        {loading ? (
          <div className="h-64 flex flex-col items-center justify-center gap-4">
            <div className="w-10 h-10 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Loading applications...</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center shadow-sm">
            <i className="fas fa-shield-check text-5xl text-slate-200 block mb-4"></i>
            <p className="font-black text-slate-700 text-lg">No Applications Found</p>
            <p className="text-slate-400 text-sm mt-1">
              {search || filterStatus !== 'all' ? 'Try changing filters.' : 'All vendor registrations have been processed.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredItems.map(item => {
              const sm = STATUS_META[item.registration_status] ?? STATUS_META.pending
              return (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-100 transition-all p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-xl ${sm.bg} ${sm.text}`}>
                      {item.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-black text-slate-800 text-base">{item.name}</p>
                        <StatusBadge status={item.registration_status} />
                      </div>
                      <div className="flex gap-3 mt-0.5 text-[11px] text-slate-400 font-medium flex-wrap">
                        <span><i className="fas fa-phone mr-1"></i>{item.phone}</span>
                        {item.city && <span><i className="fas fa-map-marker-alt mr-1"></i>{item.city}</span>}
                        {item.gst_number && <span className="font-mono"><i className="fas fa-receipt mr-1"></i>{item.gst_number}</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => openDetail(item.id)}
                    className="sm:shrink-0 px-5 py-2.5 bg-slate-800 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all flex items-center gap-2"
                  >
                    <i className="fas fa-eye text-xs"></i>
                    Review
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── LOADING SPINNER ────────────────────────────────────────────────────────
  if (detailLoading) {
    return (
      <div className="h-96 flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Loading vendor profile...</p>
      </div>
    )
  }

  // ── DETAIL VIEW ────────────────────────────────────────────────────────────
  const v = selected!
  const isActionable = !['approved', 'rejected'].includes(v.registration_status)

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col">
      <Toaster position="top-right" />

      {/* Top bar */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <button
          onClick={() => { setSelected(null); loadList() }}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm font-bold transition-colors"
        >
          <i className="fas fa-arrow-left"></i>
          Back to List
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-black text-slate-800">{v.name}</span>
          <StatusBadge status={v.registration_status} />
          {v.supplier_code && (
            <span className="font-mono text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-1 rounded-lg">
              {v.supplier_code}
            </span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-4 overflow-hidden">

        {/* LEFT: Details */}
        <div ref={detailRef} className="overflow-y-auto space-y-3 pr-1">

          {/* ── 1. Company Information ── */}
          <Section title="Company Information" icon="fas fa-building" defaultOpen>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Field label="Company Name" value={v.name} />
              <Field label="Business Type" value={v.company_type} />
              <Field label="Nature of Business" value={v.supplier_type} />
              <Field label="Category" value={v.category} />
              <Field label="Website" value={v.website} />
              <Field label="Contact Person" value={v.contact_name} />
              <Field label="Primary Mobile" value={v.phone} />
              <Field label="Email" value={v.email} />
              <Field label="Submitted On" value={new Date(v.created_at).toLocaleString('en-IN')} />
            </div>
            {v.correction_notes && (
              <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-[10px] font-black text-yellow-700 uppercase tracking-widest mb-1">Correction Notes</p>
                <p className="text-xs text-yellow-800 whitespace-pre-wrap">{v.correction_notes}</p>
              </div>
            )}
            {v.rejection_reason && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
                <p className="text-[10px] font-black text-red-700 uppercase tracking-widest mb-1">Rejection Reason</p>
                <p className="text-xs text-red-800">{v.rejection_reason}</p>
              </div>
            )}
          </Section>

          {/* ── 2. GST & Tax Details ── */}
          <Section title="GST & Tax Details" icon="fas fa-receipt">
            {v.legal ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Registration Type" value={v.legal.registration_type} />
                <Field label="GST Number" value={v.legal.gst_no || v.gst_number} />
                <Field label="PAN Number" value={v.legal.pan_no || v.pan_number} />
                <Field label="TAN Number" value={v.legal.tan_no} />
                <Field label="CIN Number" value={v.legal.cin_no || v.cin_number} />
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="GST Number" value={v.gst_number} />
                <Field label="PAN Number" value={v.pan_number} />
                <Field label="CIN Number" value={v.cin_number} />
              </div>
            )}
            {v.gstins && v.gstins.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Multi-State GSTINs</p>
                <div className="space-y-2">
                  {v.gstins.map((g, i) => (
                    <div key={i} className="flex items-center gap-3 bg-slate-50 rounded-lg px-3 py-2">
                      <span className="font-mono text-xs font-bold text-blue-700">{g.gstin}</span>
                      <span className="text-[10px] text-slate-500">{g.state_name || g.state_code}</span>
                      <span className="text-[10px] text-slate-400">{g.registration_type}</span>
                      {g.is_primary && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">Primary</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* ── 3. Address Details ── */}
          <Section title="Address Details" icon="fas fa-map-marker-alt">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
              <Field label="Address" value={v.address} />
              <Field label="City" value={v.city} />
              <Field label="District" value={v.district} />
              <Field label="State" value={v.state} />
              <Field label="State Code" value={v.state_code} />
              <Field label="Pincode" value={v.pincode} />
              <Field label="Country" value={v.country} />
            </div>
            {v.addresses && v.addresses.length > 0 && (
              <div className="space-y-3">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Additional Addresses</p>
                {v.addresses.map((a, i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-3 grid grid-cols-3 gap-3">
                    <Field label="Type" value={a.address_type} />
                    <Field label="City" value={a.city} />
                    <Field label="State" value={a.state} />
                    <div className="col-span-3"><Field label="Address" value={a.address} /></div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── 4. Bank Details ── */}
          <Section title="Bank Details" icon="fas fa-university">
            {v.financial ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Bank Name" value={v.financial.bank_name} />
                <Field label="Account Number" value={v.financial.account_no} />
                <Field label="IFSC Code" value={v.financial.ifsc_code} />
                <Field label="Branch" value={v.financial.branch} />
                <Field label="Credit Limit (₹)" value={v.financial.credit_limit?.toString()} />
                <Field label="Credit Days" value={v.financial.credit_days?.toString()} />
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">No bank details provided</p>
            )}
          </Section>

          {/* ── 5. Contact Persons ── */}
          <Section title="Contact Person Details" icon="fas fa-phone-alt">
            {v.contacts && v.contacts.length > 0 ? (
              <div className="space-y-3">
                {v.contacts.map((c, i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Name" value={c.name} />
                    <Field label="Mobile" value={c.mobile} />
                    <Field label="Email" value={c.email} />
                    <Field label="Primary" value={c.is_primary ? 'Yes' : 'No'} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">No contact persons added</p>
            )}
          </Section>

          {/* ── 6. Authorized Persons / Directors ── */}
          {(v.directors?.length > 0 || v.auth_persons?.length > 0) && (
            <Section title="Authorized Persons & Directors" icon="fas fa-user-shield">
              {v.directors && v.directors.length > 0 && (
                <div className="mb-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Directors / Partners / Owners</p>
                  <div className="space-y-2">
                    {v.directors.map((d, i) => (
                      <div key={i} className="bg-slate-50 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Field label="Name" value={d.director_name} />
                        <Field label="DIN" value={d.din} />
                        <Field label="Email" value={d.email} />
                        <Field label="Phone" value={d.phone} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {v.auth_persons && v.auth_persons.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Authorized Representatives</p>
                  <div className="space-y-2">
                    {v.auth_persons.map((ap, i) => (
                      <div key={i} className="bg-slate-50 rounded-lg p-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <Field label="Name" value={ap.name} />
                        <Field label="Designation" value={ap.designation} />
                        <Field label="Mobile" value={ap.mobile} />
                        <Field label="Email" value={ap.email} />
                        {ap.photo_path && (
                          <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Photo</p>
                            <img src={`/uploads/${ap.photo_path.replace(/^\/uploads\//, '')}`} alt="Photo"
                              className="w-16 h-16 object-cover rounded-lg border border-slate-200" />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Section>
          )}

          {/* ── 7. Internal Notes ── */}
          <Section title="Internal Notes" icon="fas fa-sticky-note" defaultOpen={false}>
            <div className="space-y-2 mb-4">
              {v.internal_notes && v.internal_notes.length > 0 ? (
                v.internal_notes.map((n, i) => (
                  <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                    <p className="text-xs text-slate-700">{n.note}</p>
                    <p className="text-[10px] text-slate-400 mt-1">
                      {n.created_by_name || 'Admin'} · {n.created_at ? new Date(n.created_at).toLocaleString('en-IN') : ''}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400 italic">No internal notes yet</p>
              )}
            </div>
            {isActionable && (
              <div className="flex gap-2">
                <input
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Add internal note..."
                  className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <button
                  onClick={handleAddNote}
                  disabled={addingNote}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-black rounded-lg disabled:opacity-50 transition-colors"
                >
                  {addingNote ? '...' : 'Add'}
                </button>
              </div>
            )}
          </Section>

          {/* ── 8. Approval History ── */}
          <Section title="Approval History" icon="fas fa-history" defaultOpen={false}>
            {v.approval_logs && v.approval_logs.length > 0 ? (
              <div className="space-y-0">
                {[...v.approval_logs].reverse().map(log => (
                  <LogEntry key={log.id} log={log} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">No history yet</p>
            )}
          </Section>

        </div>

        {/* RIGHT: Documents + Action Panel */}
        <div className="xl:overflow-y-auto space-y-4 flex flex-col">

          {/* Document previews */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 flex-1">
            <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-3">
              <i className="fas fa-folder-open mr-1.5 text-blue-500"></i>
              Uploaded Documents
            </p>
            {v.documents && v.documents.length > 0 ? (
              <div className="space-y-2">
                {v.documents.map((doc, i) => (
                  <DocPreview key={i} path={doc.file_path} label={doc.document_type} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <i className="fas fa-file-upload text-3xl text-slate-200 block mb-2"></i>
                <p className="text-sm text-slate-400">No documents uploaded</p>
              </div>
            )}

            {/* Auth person ID proofs */}
            {v.auth_persons?.some(ap => ap.id_proof_path) && (
              <div className="mt-4 space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID Proofs</p>
                {v.auth_persons.filter(ap => ap.id_proof_path).map((ap, i) => (
                  <DocPreview key={i} path={ap.id_proof_path!} label={`${ap.name} — ID Proof`} />
                ))}
              </div>
            )}
          </div>

          {/* Action panel (sticky at bottom on xl) */}
          {isActionable && (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4 shrink-0">
              <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
                <i className="fas fa-tasks mr-1.5 text-blue-500"></i>
                Approval Actions
              </p>

              {/* Remarks */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  Remarks / Reason
                  <span className="text-slate-300 font-normal normal-case ml-1">(required for reject/correction)</span>
                </label>
                <textarea
                  value={remarks}
                  onChange={e => setRemarks(e.target.value)}
                  rows={3}
                  placeholder="Enter remarks, notes, or rejection reason..."
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                />
              </div>

              {/* Correction fields */}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  Fields Needing Correction
                  <span className="text-slate-300 font-normal normal-case ml-1">(for correction requests only)</span>
                </label>
                <div className="flex gap-2 mb-2">
                  <input
                    value={newCorrField}
                    onChange={e => setNewCorrField(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newCorrField.trim()) {
                        setCorrectionFields(f => [...f, newCorrField.trim()])
                        setNewCorrField('')
                      }
                    }}
                    placeholder="Add field name, press Enter..."
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <button
                    onClick={() => { if (newCorrField.trim()) { setCorrectionFields(f => [...f, newCorrField.trim()]); setNewCorrField('') } }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold"
                  >+</button>
                </div>
                {correctionFields.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {correctionFields.map((f, i) => (
                      <span key={i} className="inline-flex items-center gap-1 bg-yellow-100 text-yellow-700 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {f}
                        <button onClick={() => setCorrectionFields(ff => ff.filter((_, j) => j !== i))} className="ml-0.5 hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="col-span-2 flex items-center justify-center gap-2 py-3 bg-green-600 hover:bg-green-700 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-sm disabled:opacity-50 transition-all"
                >
                  <i className="fas fa-check-circle"></i>
                  {actionLoading ? 'Processing...' : 'Approve & Generate Code'}
                </button>

                {v.registration_status !== 'under_review' && (
                  <button
                    onClick={handleUnderReview}
                    disabled={actionLoading}
                    className="flex items-center justify-center gap-1.5 py-2.5 bg-purple-100 hover:bg-purple-200 text-purple-700 text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 transition-all"
                  >
                    <i className="fas fa-search text-xs"></i>
                    Under Review
                  </button>
                )}

                <button
                  onClick={handleHold}
                  disabled={actionLoading}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-orange-100 hover:bg-orange-200 text-orange-700 text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 transition-all"
                >
                  <i className="fas fa-pause-circle text-xs"></i>
                  Hold
                </button>

                <button
                  onClick={handleCorrection}
                  disabled={actionLoading}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-yellow-100 hover:bg-yellow-200 text-yellow-700 text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 transition-all"
                >
                  <i className="fas fa-edit text-xs"></i>
                  Ask Correction
                </button>

                <button
                  onClick={handleReject}
                  disabled={actionLoading}
                  className="flex items-center justify-center gap-1.5 py-2.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs font-black uppercase tracking-widest rounded-xl disabled:opacity-50 transition-all"
                >
                  <i className="fas fa-times-circle text-xs"></i>
                  Reject
                </button>
              </div>
            </div>
          )}

          {/* Approved banner */}
          {v.registration_status === 'approved' && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-4 shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <i className="fas fa-check-circle text-green-600"></i>
                <p className="font-black text-green-800 text-sm">Approved Supplier</p>
              </div>
              <p className="text-xs text-green-700">
                Supplier Code: <strong className="font-mono">{v.supplier_code}</strong>
              </p>
              {v.approved_at && (
                <p className="text-[11px] text-green-600 mt-1">
                  Approved on {new Date(v.approved_at).toLocaleDateString('en-IN')}
                </p>
              )}
            </div>
          )}

          {/* Rejected banner */}
          {v.registration_status === 'rejected' && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 shrink-0">
              <div className="flex items-center gap-2 mb-2">
                <i className="fas fa-times-circle text-red-600"></i>
                <p className="font-black text-red-800 text-sm">Application Rejected</p>
              </div>
              {v.rejection_reason && (
                <p className="text-xs text-red-700">{v.rejection_reason}</p>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
