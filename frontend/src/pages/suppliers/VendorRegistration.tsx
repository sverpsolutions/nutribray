import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { suppliers_api, states_api, type state_item } from '../../api/suppliers'
import { Toaster, toast } from 'react-hot-toast'
import { CheckCircle2 } from 'lucide-react'

// ── Fallback state list ───────────────────────────────────────────────────────
const FALLBACK_STATES: state_item[] = [
  { id:1,  state_code:'01', state_name:'Jammu & Kashmir',                        is_ut:true  },
  { id:2,  state_code:'02', state_name:'Himachal Pradesh',                       is_ut:false },
  { id:3,  state_code:'03', state_name:'Punjab',                                 is_ut:false },
  { id:4,  state_code:'04', state_name:'Chandigarh',                             is_ut:true  },
  { id:5,  state_code:'05', state_name:'Uttarakhand',                            is_ut:false },
  { id:6,  state_code:'06', state_name:'Haryana',                                is_ut:false },
  { id:7,  state_code:'07', state_name:'Delhi',                                  is_ut:true  },
  { id:8,  state_code:'08', state_name:'Rajasthan',                              is_ut:false },
  { id:9,  state_code:'09', state_name:'Uttar Pradesh',                          is_ut:false },
  { id:10, state_code:'10', state_name:'Bihar',                                  is_ut:false },
  { id:11, state_code:'11', state_name:'Sikkim',                                 is_ut:false },
  { id:12, state_code:'12', state_name:'Arunachal Pradesh',                      is_ut:false },
  { id:13, state_code:'13', state_name:'Nagaland',                               is_ut:false },
  { id:14, state_code:'14', state_name:'Manipur',                                is_ut:false },
  { id:15, state_code:'15', state_name:'Mizoram',                                is_ut:false },
  { id:16, state_code:'16', state_name:'Tripura',                                is_ut:false },
  { id:17, state_code:'17', state_name:'Meghalaya',                              is_ut:false },
  { id:18, state_code:'18', state_name:'Assam',                                  is_ut:false },
  { id:19, state_code:'19', state_name:'West Bengal',                            is_ut:false },
  { id:20, state_code:'20', state_name:'Jharkhand',                              is_ut:false },
  { id:21, state_code:'21', state_name:'Odisha',                                 is_ut:false },
  { id:22, state_code:'22', state_name:'Chhattisgarh',                           is_ut:false },
  { id:23, state_code:'23', state_name:'Madhya Pradesh',                         is_ut:false },
  { id:24, state_code:'24', state_name:'Gujarat',                                is_ut:false },
  { id:25, state_code:'25', state_name:'Dadra & Nagar Haveli and Daman & Diu',   is_ut:true  },
  { id:27, state_code:'27', state_name:'Maharashtra',                            is_ut:false },
  { id:29, state_code:'29', state_name:'Karnataka',                              is_ut:false },
  { id:30, state_code:'30', state_name:'Goa',                                    is_ut:false },
  { id:32, state_code:'32', state_name:'Kerala',                                 is_ut:false },
  { id:33, state_code:'33', state_name:'Tamil Nadu',                             is_ut:false },
  { id:34, state_code:'34', state_name:'Puducherry',                             is_ut:true  },
  { id:36, state_code:'36', state_name:'Telangana',                              is_ut:false },
  { id:37, state_code:'37', state_name:'Andhra Pradesh',                         is_ut:false },
  { id:38, state_code:'38', state_name:'Ladakh',                                 is_ut:true  },
]

type SectionType = 'basic' | 'address' | 'legal' | 'contact' | 'directors' | 'auth' | 'financial' | 'docs' | 'notes'

const CIN_REQUIRED = new Set(['Pvt Ltd', 'Private Limited', 'Limited', 'Public Ltd', 'LLP'])

// ── Reusable UI components (identical to internal form) ───────────────────────
const InputField = ({ label, value, onChange, placeholder, type = 'text', required = false, readOnly = false }: any) => (
  <div className="space-y-1.5">
    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
      {label}{required && <span className="text-red-500 ml-1">*</span>}
    </label>
    <input
      type={type}
      value={value ?? ''}
      onChange={e => !readOnly && onChange(e.target.value)}
      readOnly={readOnly}
      className={`w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm ${readOnly ? 'bg-slate-50 text-slate-500 cursor-default' : ''}`}
      placeholder={placeholder}
    />
  </div>
)

const SelectField = ({ label, value, onChange, options }: any) => (
  <div className="space-y-1.5">
    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</label>
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm bg-white"
    >
      {options.map((opt: any) => (
        <option key={opt.value ?? opt} value={opt.value ?? opt}>{opt.label ?? opt}</option>
      ))}
    </select>
  </div>
)

const SectionTitle = ({ title }: { title: string }) => (
  <h3 className="text-base font-black text-slate-800 border-l-4 border-blue-600 pl-4 mb-6">{title}</h3>
)

const CardRow = ({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) => (
  <div className="relative p-5 bg-slate-50 rounded-xl border border-slate-200 group">
    <button type="button" onClick={onRemove} className="absolute top-3 right-3 text-slate-300 hover:text-red-500 transition-colors">
      <i className="fas fa-times-circle text-lg"></i>
    </button>
    {children}
  </div>
)

const AddRowButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full p-6 border-2 border-dashed border-slate-200 rounded-xl text-center text-slate-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/30 transition-all group"
  >
    <i className="fas fa-plus-circle text-xl mb-1 block group-hover:scale-110 transition-transform"></i>
    <span className="text-[11px] font-black uppercase tracking-widest">{label}</span>
  </button>
)

// ── Initial blank form state ──────────────────────────────────────────────────
const BLANK_FORM = {
  name: '', phone: '', email: '', supplier_code: '', supplier_type: 'Manufacturer', company_type: 'Proprietorship',
  category: 'FMCG', contact_name: '', website: '',
  // Address
  address: '', city: '', state: 'Delhi', state_code: '', pincode: '', district: '', country: 'India',
  // Legal
  gst_number: '', pan_number: '', cin_number: '',
  legal: { registration_type: 'Regular', gst_no: '', pan_no: '', tan_no: '', cin_no: '' },
  gstins: [] as any[],
  // Relations
  contacts: [] as any[],
  directors: [] as any[],
  auth_persons: [] as any[],
  financial: { bank_name: '', account_no: '', ifsc_code: '', branch: '', credit_limit: 0, credit_days: 0 },
  documents: [] as any[],
  notes: '',
}

const BLANK_GSTIN = { gstin: '', state_code: '', state_name: '', pan: '', registration_type: 'Regular', is_primary: false, is_active: true }

export default function VendorRegistration() {
  const { token } = useParams<{ token: string }>()
  const [loading, setLoading]       = useState(true)
  const [notFound, setNotFound]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess]       = useState(false)
  const [vendorName, setVendorName] = useState('')
  const [section, setSection]       = useState<SectionType>('basic')
  const [form, setForm]             = useState({ ...BLANK_FORM })
  const [allStates, setAllStates]   = useState<state_item[]>(FALLBACK_STATES)

  const [gstinStatus, setGstinStatus] = useState<{ valid: boolean | null; msg: string; pan?: string; state_code?: string; state_name?: string }>({ valid: null, msg: '' })
  const [panStatus, setPanStatus]     = useState<{ valid: boolean | null; msg: string }>({ valid: null, msg: '' })
  const [cinStatus, setCinStatus]     = useState<{ valid: boolean | null; msg: string }>({ valid: null, msg: '' })
  const gstinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Load token ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return }
    suppliers_api.getPublicRegistration(token)
      .then(res => {
        const d = res.data
        setVendorName(d.name)
        setForm(f => ({ ...f, name: d.name, phone: d.phone, email: d.email ?? '', city: d.city ?? '', state: d.state ?? 'Delhi', address: d.address ?? '' }))
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))

    // Load live states
    states_api.list().then(r => { if (Array.isArray(r.data) && r.data.length > 0) setAllStates(r.data) }).catch(() => {})
  }, [token])

  // ── GSTIN validation (same as internal form) ────────────────────────────────
  function _gstinChecksum(g: string): string {
    const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let factor = 1, total = 0
    for (const ch of g.slice(0, 14)) {
      let d = CHARS.indexOf(ch) * factor
      d = Math.floor(d / 36) + (d % 36)
      total += d
      factor = factor === 1 ? 2 : 1
    }
    return CHARS[(36 - (total % 36)) % 36]
  }

  function _localGstinCheck(g: string): { ok: boolean; err: string } {
    if (g.length !== 15) return { ok: false, err: `GSTIN must be 15 characters (${g.length} entered)` }
    const pat = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
    if (!pat.test(g)) return { ok: false, err: 'Invalid format — expected: 07AAAAA1234F1Z5' }
    const sc = g.slice(0, 2)
    const validSC = new Set(FALLBACK_STATES.map(s => s.state_code))
    if (!validSC.has(sc)) return { ok: false, err: `Invalid state code '${sc}' in GSTIN` }
    const expected = _gstinChecksum(g)
    if (expected !== g[14]) return { ok: false, err: `Checksum mismatch — last char should be '${expected}'` }
    return { ok: true, err: '' }
  }

  function handleGstinChange(v: string) {
    const val = v.toUpperCase().replace(/\s/g, '')
    setForm(f => ({ ...f, gst_number: val }))
    if (gstinTimer.current) clearTimeout(gstinTimer.current)
    if (!val) { setGstinStatus({ valid: null, msg: '' }); return }
    if (val.length < 15) { setGstinStatus({ valid: null, msg: `${val.length}/15 characters` }); return }
    const local = _localGstinCheck(val)
    if (!local.ok) { setGstinStatus({ valid: false, msg: local.err }); return }
    setGstinStatus({ valid: null, msg: '⏳ Verifying...' })
    gstinTimer.current = setTimeout(async () => {
      try {
        const r = await states_api.validate_gstin(val, form.state_code || undefined)
        if (!r.data.valid) {
          setGstinStatus({ valid: false, msg: r.data.error || 'Invalid GSTIN' })
        } else {
          const auto_pan = r.data.pan || val.slice(2, 12)
          const auto_sc  = r.data.state_code || val.slice(0, 2)
          const auto_sn  = r.data.state_name || auto_sc
          setForm(f => ({ ...f, pan_number: f.pan_number || auto_pan, state_code: f.state_code || auto_sc }))
          if (r.data.state_mismatch) {
            setGstinStatus({ valid: false, msg: r.data.mismatch_message || 'State mismatch' })
          } else {
            setGstinStatus({ valid: true, msg: `✓ Valid GSTIN — ${auto_sn} · PAN auto-filled` })
          }
        }
      } catch {
        const auto_pan = val.slice(2, 12)
        const auto_sc  = val.slice(0, 2)
        setForm(f => ({ ...f, pan_number: f.pan_number || auto_pan, state_code: f.state_code || auto_sc }))
        setGstinStatus({ valid: true, msg: `✓ Format valid — PAN: ${auto_pan}` })
      }
    }, 400)
  }

  async function handlePanChange(v: string) {
    const val = v.toUpperCase().replace(/\s/g, '')
    setForm(f => ({ ...f, pan_number: val }))
    if (!val) { setPanStatus({ valid: null, msg: '' }); return }
    if (val.length < 10) { setPanStatus({ valid: null, msg: `${val.length}/10 characters` }); return }
    const panPat = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
    if (!panPat.test(val)) { setPanStatus({ valid: false, msg: 'Invalid format — expected: ABCDE1234F' }); return }
    try {
      const r = await states_api.validate_pan(val)
      setPanStatus({ valid: r.data.valid, msg: r.data.valid ? `✓ Valid PAN (${val})` : (r.data.error || 'Invalid PAN') })
    } catch {
      setPanStatus({ valid: true, msg: `✓ Format valid (${val})` })
    }
  }

  async function handleCinChange(v: string) {
    const val = v.toUpperCase()
    setForm(f => ({ ...f, cin_number: val }))
    if (!val) { setCinStatus({ valid: null, msg: '' }); return }
    try {
      const r = await states_api.validate_cin(val, form.company_type)
      setCinStatus({ valid: r.data.valid, msg: r.data.valid ? '✓ Valid CIN' : (r.data.error || 'Invalid CIN') })
    } catch {}
  }

  function addGstinRow() { setForm(f => ({ ...f, gstins: [...f.gstins, { ...BLANK_GSTIN }] })) }
  function removeGstinRow(i: number) { setForm(f => { const a = [...f.gstins]; a.splice(i, 1); return { ...f, gstins: a } }) }
  function updateGstinRow(i: number, field: string, value: any) {
    setForm(f => {
      const a = [...f.gstins] as any[]
      a[i] = { ...a[i], [field]: value }
      if (field === 'gstin' && value.length === 15) {
        const sc = value.slice(0, 2)
        a[i].state_code = sc
        a[i].state_name = allStates.find(s => s.state_code === sc)?.state_name || sc
        a[i].pan = value.slice(2, 12)
      }
      return { ...f, gstins: a }
    })
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!form.name.trim()) { toast.error('Company name is required'); setSection('basic'); return }
    if (!form.phone.trim()) { toast.error('Primary mobile is required'); setSection('basic'); return }
    if (!token) return
    setSubmitting(true)
    try {
      const payload = {
        ...form,
        contacts: form.contacts.map((c: any) => ({ name: c.name, mobile: c.mobile, email: c.email || '', is_primary: c.is_primary || false })),
        directors: form.directors,
        auth_persons: form.auth_persons,
        financial: form.financial,
        documents: form.documents,
        gstins: form.gstins,
      }
      await suppliers_api.submitPublicRegistration(token, payload)
      setSuccess(true)
      toast.success('Registration submitted successfully!')
    } catch (err: any) {
      const detail = err.response?.data?.detail
      toast.error(Array.isArray(detail) ? detail.map((d: any) => d.msg).join(', ') : (detail || 'Failed to submit'))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Tab Button ──────────────────────────────────────────────────────────────
  const TabBtn = ({ id, label, icon }: { id: SectionType; label: string; icon: string }) => (
    <button
      type="button"
      onClick={() => setSection(id)}
      className={`flex items-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-widest transition-all border-b-2 w-full text-left ${section === id ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
    >
      <i className={`fas ${icon} text-xs w-4`}></i>
      {label}
    </button>
  )

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center">
      <div className="text-center">
        <i className="fas fa-circle-notch fa-spin text-4xl text-blue-600 mb-4 block"></i>
        <p className="text-slate-500 font-bold text-sm uppercase tracking-widest">Loading Registration...</p>
      </div>
    </div>
  )

  // ── Invalid token ───────────────────────────────────────────────────────────
  if (notFound) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 p-12 rounded-2xl shadow-xl max-w-md w-full text-center">
        <div className="w-20 h-20 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6 text-4xl">
          <i className="fas fa-exclamation-triangle"></i>
        </div>
        <h1 className="text-2xl font-black text-slate-800 mb-3">Link Expired</h1>
        <p className="text-slate-500 leading-relaxed mb-6">This registration link is no longer valid. Please contact our procurement team for a new invitation.</p>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Contact Us</p>
          <p className="text-blue-600 font-bold text-sm mt-1">procurement@nutribay.com</p>
        </div>
      </div>
    </div>
  )

  // ── Success ─────────────────────────────────────────────────────────────────
  if (success) return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 p-12 rounded-2xl shadow-xl max-w-xl w-full text-center">
        <div className="w-20 h-20 bg-green-50 text-green-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 size={44} />
        </div>
        <h1 className="text-3xl font-black text-slate-800 mb-3">Registration Submitted!</h1>
        <p className="text-slate-500 text-lg mb-8 leading-relaxed">
          Thank you, <span className="font-black text-slate-800">{form.name}</span>! Your application is under review.
        </p>
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 text-left space-y-2">
          <p className="text-[10px] font-black text-green-700 uppercase tracking-widest">What happens next?</p>
          <p className="text-sm text-green-800 font-medium">✓ Our team will review your submitted details</p>
          <p className="text-sm text-green-800 font-medium">✓ You will receive a Supplier Code (SUP-XXXX) via email</p>
          <p className="text-sm text-green-800 font-medium">✓ You will be notified once your account is approved</p>
        </div>
      </div>
    </div>
  )

  // ── Main Form ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4">
      <Toaster position="top-center" />

      <div className="max-w-7xl mx-auto space-y-5">

        {/* Top branding bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-black text-lg shadow-md">M</div>
            <div>
              <p className="font-black text-slate-800 text-sm leading-tight">Nutribay</p>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Vendor Registration Portal</p>
            </div>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">Invited as</p>
            <p className="text-sm font-black text-slate-700">{vendorName}</p>
          </div>
        </div>

        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-slate-800">Register Your Company</h1>
            <p className="text-slate-500 text-sm mt-0.5">Fill all sections and submit your registration</p>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-10 py-2.5 text-xs font-black uppercase tracking-widest bg-blue-600 text-white rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center gap-2 self-start sm:self-auto"
          >
            {submitting
              ? <><i className="fas fa-circle-notch fa-spin"></i> Submitting...</>
              : <><i className="fas fa-paper-plane"></i> Submit Registration</>}
          </button>
        </div>

        {/* Card: sidebar + content */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex min-h-[640px]">

          {/* Left sidebar (identical to internal form) */}
          <div className="w-56 bg-slate-50 border-r border-slate-200 flex flex-col shrink-0">
            <div className="p-5 border-b border-slate-200 bg-white">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center text-white text-2xl font-black mb-2 shadow-lg">
                {form.name?.[0]?.toUpperCase() || 'V'}
              </div>
              <p className="font-black text-slate-800 text-sm truncate">{form.name || 'Your Company'}</p>
              <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest">NEW REGISTRATION</p>
            </div>
            <nav className="flex-1 py-2 overflow-y-auto">
              <TabBtn id="basic"     label="Basic Info"    icon="fa-info-circle"    />
              <TabBtn id="address"   label="Addresses"     icon="fa-map-marker-alt" />
              <TabBtn id="legal"     label="Legal & Tax"   icon="fa-gavel"          />
              <TabBtn id="contact"   label="Contacts"      icon="fa-address-book"   />
              <TabBtn id="directors" label="Directors"     icon="fa-users-cog"      />
              <TabBtn id="auth"      label="Auth Persons"  icon="fa-user-check"     />
              <TabBtn id="financial" label="Financials"    icon="fa-university"     />
              <TabBtn id="docs"      label="Documents"     icon="fa-file-alt"       />
              <TabBtn id="notes"     label="Notes"         icon="fa-sticky-note"    />
            </nav>

            {/* Progress hint */}
            <div className="p-4 border-t border-slate-200">
              <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest mb-2">Completion</p>
              <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-blue-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, [form.name, form.phone, form.address, form.gst_number, form.pan_number, (form.financial as any).bank_name, form.contacts.length > 0].filter(Boolean).length / 7 * 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 p-8 overflow-y-auto">

            {/* ── BASIC INFO ─────────────────────────────────────────────────── */}
            {section === 'basic' && (
              <div className="space-y-8">
                <SectionTitle title="General Information" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <InputField label="Company Legal Name" required value={form.name}
                    onChange={(v: string) => setForm(f => ({ ...f, name: v }))} placeholder="Full legal name" />
                  <InputField label="Supplier Code" value={form.supplier_code}
                    onChange={(v: string) => setForm(f => ({ ...f, supplier_code: v }))} placeholder="Auto-generated if blank" />
                  <SelectField label="Supplier Type" value={form.supplier_type}
                    onChange={(v: string) => setForm(f => ({ ...f, supplier_type: v }))}
                    options={['Manufacturer', 'Distributor', 'Importer', 'Local Vendor', 'Agent']} />
                  <SelectField label="Company Type" value={form.company_type}
                    onChange={(v: string) => setForm(f => ({ ...f, company_type: v }))}
                    options={['Proprietorship', 'Partnership', 'Pvt Ltd', 'LLP', 'Public Ltd']} />
                  <SelectField label="Category" value={form.category}
                    onChange={(v: string) => setForm(f => ({ ...f, category: v }))}
                    options={['FMCG', 'Beverage', 'Grocery', 'Frozen', 'Electronics', 'Dairy', 'Bakery', 'General']} />
                </div>

                <div className="border-t border-slate-100 pt-6">
                  <SectionTitle title="Primary Contact" />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <InputField label="Contact Person Name" value={form.contact_name}
                      onChange={(v: string) => setForm(f => ({ ...f, contact_name: v }))} placeholder="e.g. Mr. Rajesh Kumar" />
                    <InputField label="Primary Mobile" required value={form.phone}
                      onChange={(v: string) => setForm(f => ({ ...f, phone: v }))} placeholder="+91 9876543210" />
                    <InputField label="Email Address" type="email" value={form.email}
                      onChange={(v: string) => setForm(f => ({ ...f, email: v }))} placeholder="office@supplier.com" />
                    <InputField label="Website" value={form.website}
                      onChange={(v: string) => setForm(f => ({ ...f, website: v }))} placeholder="www.supplier.com" />
                  </div>
                </div>

                <div className="pt-4">
                  <button type="button" onClick={() => setSection('address')}
                    className="px-8 py-2.5 bg-blue-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-blue-700 transition-all flex items-center gap-2">
                    Next: Address <i className="fas fa-arrow-right"></i>
                  </button>
                </div>
              </div>
            )}

            {/* ── ADDRESS ────────────────────────────────────────────────────── */}
            {section === 'address' && (
              <div className="space-y-6">
                <SectionTitle title="Location Details" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="md:col-span-2">
                    <InputField label="Registered / Billing Address" value={form.address}
                      onChange={(v: string) => setForm(f => ({ ...f, address: v }))} placeholder="Door no, Street, Area..." />
                  </div>
                  <InputField label="City" value={form.city}
                    onChange={(v: string) => setForm(f => ({ ...f, city: v }))} placeholder="Mumbai" />
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">State</label>
                    <select value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm bg-white">
                      {allStates.map(s => <option key={s.state_code} value={s.state_name}>{s.state_name}{s.is_ut ? ' (UT)' : ''}</option>)}
                    </select>
                  </div>
                  <InputField label="Pincode" value={form.pincode}
                    onChange={(v: string) => setForm(f => ({ ...f, pincode: v }))} placeholder="400001" />
                  <InputField label="District" value={form.district}
                    onChange={(v: string) => setForm(f => ({ ...f, district: v }))} placeholder="Mumbai Suburban" />
                  <InputField label="Country" value={form.country}
                    onChange={(v: string) => setForm(f => ({ ...f, country: v }))} placeholder="India" />
                </div>

                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setSection('basic')}
                    className="px-6 py-2.5 bg-slate-100 text-slate-600 text-xs font-black uppercase tracking-widest rounded-xl hover:bg-slate-200 transition-all flex items-center gap-2">
                    <i className="fas fa-arrow-left"></i> Back
                  </button>
                  <button type="button" onClick={() => setSection('legal')}
                    className="px-8 py-2.5 bg-blue-600 text-white text-xs font-black uppercase tracking-widest rounded-xl hover:bg-blue-700 transition-all flex items-center gap-2">
                    Next: Legal & Tax <i className="fas fa-arrow-right"></i>
                  </button>
                </div>
              </div>
            )}

            {/* ── LEGAL & TAX ────────────────────────────────────────────────── */}
            {section === 'legal' && (
              <div className="space-y-8">
                <SectionTitle title="GST & Compliance" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <SelectField label="GST Registration Type"
                    value={form.legal.registration_type}
                    onChange={(v: string) => setForm(f => ({ ...f, legal: { ...f.legal, registration_type: v } }))}
                    options={['Regular', 'Composition', 'Unregistered', 'Consumer']} />

                  {/* GSTIN with live validation */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Primary GSTIN</label>
                        <a 
                          href="https://services.gst.gov.in/services/searchtp" 
                          target="_blank" 
                          rel="noreferrer" 
                          className="text-[9px] text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-200 transition-all font-bold flex items-center gap-1" 
                          title="Verify on official Government Portal"
                        >
                          <i className="fas fa-external-link-alt"></i> Verify Govt Portal
                        </a>
                      </div>
                      <span className={`text-[9px] font-bold ${form.gst_number.length === 15 ? 'text-green-500' : 'text-slate-400'}`}>
                        {form.gst_number.length}/15
                      </span>
                    </div>
                    <input
                      value={form.gst_number}
                      onChange={e => handleGstinChange(e.target.value)}
                      maxLength={15}
                      placeholder="e.g. 07AAAAA1234F1Z5"
                      className={`w-full border rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 transition-all shadow-sm tracking-widest uppercase
                        ${gstinStatus.valid === true ? 'border-green-400 bg-green-50/30 focus:ring-green-200'
                          : gstinStatus.valid === false ? 'border-red-400 bg-red-50/30 focus:ring-red-200'
                          : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'}`}
                    />
                    {gstinStatus.msg && (
                      <p className={`text-[10px] font-bold mt-1 flex items-center gap-1.5
                        ${gstinStatus.valid === true ? 'text-green-600' : gstinStatus.valid === false ? 'text-red-500' : 'text-slate-400'}`}>
                        {gstinStatus.valid === null && gstinStatus.msg.startsWith('⏳') && <i className="fas fa-circle-notch fa-spin text-[9px]"></i>}
                        {gstinStatus.msg}
                      </p>
                    )}
                  </div>

                  {/* State auto-detected */}
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      State <span className="text-slate-300 font-normal">(auto from GSTIN)</span>
                    </label>
                    <select
                      value={form.state_code}
                      onChange={e => setForm(f => ({ ...f, state_code: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-sm bg-white"
                    >
                      <option value="">— Select State —</option>
                      {allStates.map(s => (
                        <option key={s.state_code} value={s.state_code}>{s.state_code} — {s.state_name}{s.is_ut ? ' (UT)' : ''}</option>
                      ))}
                    </select>
                  </div>

                  {/* PAN with live validation */}
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      PAN Number <span className="text-slate-300 font-normal">(auto from GSTIN)</span>
                    </label>
                    <input
                      value={form.pan_number}
                      onChange={e => handlePanChange(e.target.value)}
                      maxLength={10}
                      placeholder="ABCDE1234F"
                      className={`w-full border rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 transition-all shadow-sm font-mono
                        ${panStatus.valid === true ? 'border-green-400 focus:ring-green-200' : panStatus.valid === false ? 'border-red-400 focus:ring-red-200' : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'}`}
                    />
                    {panStatus.msg && (
                      <p className={`text-[10px] font-bold mt-1 ${panStatus.valid ? 'text-green-600' : 'text-red-500'}`}>{panStatus.msg}</p>
                    )}
                  </div>

                  <InputField label="TAN Number"
                    value={form.legal.tan_no}
                    onChange={(v: string) => setForm(f => ({ ...f, legal: { ...f.legal, tan_no: v } }))}
                    placeholder="RTKA12345B" />

                  {/* CIN — conditional */}
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
                      CIN Number
                      {CIN_REQUIRED.has(form.company_type) && <span className="text-red-500 ml-1">* Required</span>}
                    </label>
                    <input
                      value={form.cin_number}
                      onChange={e => handleCinChange(e.target.value)}
                      maxLength={21}
                      placeholder="U12345MH2020PTC126385"
                      className={`w-full border rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 transition-all shadow-sm font-mono
                        ${cinStatus.valid === true ? 'border-green-400 focus:ring-green-200' : cinStatus.valid === false ? 'border-red-400 focus:ring-red-200'
                          : CIN_REQUIRED.has(form.company_type) ? 'border-amber-300 focus:ring-amber-200' : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'}`}
                    />
                    {cinStatus.msg && (
                      <p className={`text-[10px] font-bold mt-1 ${cinStatus.valid ? 'text-green-600' : 'text-red-500'}`}>{cinStatus.msg}</p>
                    )}
                    {!cinStatus.msg && CIN_REQUIRED.has(form.company_type) && (
                      <p className="text-[10px] text-amber-600 font-bold mt-1">⚠ Mandatory for {form.company_type}</p>
                    )}
                  </div>
                </div>

                {/* Multi-state GSTINs */}
                <div className="border-t border-slate-100 pt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-700 uppercase tracking-widest">Multi-State GSTIN Registrations</h4>
                    <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-[10px] font-black">{form.gstins.length} Registered</span>
                  </div>
                  {form.gstins.map((g: any, i: number) => (
                    <div key={i} className="relative p-4 bg-slate-50 border border-slate-200 rounded-xl">
                      <button type="button" onClick={() => removeGstinRow(i)} className="absolute top-3 right-3 text-slate-300 hover:text-red-500 transition-colors">
                        <i className="fas fa-times-circle"></i>
                      </button>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase">GSTIN</label>
                          <input value={g.gstin} onChange={e => updateGstinRow(i, 'gstin', e.target.value.toUpperCase())}
                            maxLength={15} placeholder="27AAAAA1234F1Z5"
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase">State (auto)</label>
                          <input value={g.state_name || g.state_code} readOnly
                            className="w-full border border-slate-100 rounded-lg px-3 py-2 text-sm bg-slate-100 text-slate-500" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase">PAN (auto)</label>
                          <input value={g.pan} readOnly
                            className="w-full border border-slate-100 rounded-lg px-3 py-2 text-sm bg-slate-100 text-slate-500 font-mono" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase">Registration Type</label>
                          <select value={g.registration_type} onChange={e => updateGstinRow(i, 'registration_type', e.target.value)}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none">
                            {['Regular', 'Composition', 'Unregistered', 'Consumer'].map(t => <option key={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="flex items-end gap-4 pb-1">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={g.is_primary} onChange={e => updateGstinRow(i, 'is_primary', e.target.checked)} className="rounded text-blue-600" />
                            <span className="text-[10px] font-black text-slate-500 uppercase">Primary</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={g.is_active} onChange={e => updateGstinRow(i, 'is_active', e.target.checked)} className="rounded text-green-600" />
                            <span className="text-[10px] font-black text-slate-500 uppercase">Active</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={addGstinRow}
                    className="w-full p-4 border-2 border-dashed border-slate-200 rounded-xl text-center text-slate-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/30 transition-all text-xs font-black uppercase tracking-widest">
                    <i className="fas fa-plus-circle mr-2"></i>Add GSTIN (Another State)
                  </button>
                </div>
              </div>
            )}

            {/* ── CONTACTS ───────────────────────────────────────────────────── */}
            {section === 'contact' && (
              <div className="space-y-5">
                <SectionTitle title="Additional Contact Persons" />
                <div className="space-y-4">
                  {form.contacts.map((c: any, i: number) => (
                    <CardRow key={i} onRemove={() => { const a = [...form.contacts]; a.splice(i, 1); setForm(f => ({ ...f, contacts: a })) }}>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <InputField label="Name" value={c.name} onChange={(v: string) => { const a = [...form.contacts] as any[]; a[i].name = v; setForm(f => ({ ...f, contacts: a })) }} placeholder="Full name" />
                        <InputField label="Mobile" value={c.mobile} onChange={(v: string) => { const a = [...form.contacts] as any[]; a[i].mobile = v; setForm(f => ({ ...f, contacts: a })) }} placeholder="+91..." />
                        <InputField label="Email" value={c.email} onChange={(v: string) => { const a = [...form.contacts] as any[]; a[i].email = v; setForm(f => ({ ...f, contacts: a })) }} placeholder="email@..." />
                      </div>
                      <div className="mt-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="checkbox" checked={c.is_primary} onChange={e => { const a = [...form.contacts] as any[]; a[i].is_primary = e.target.checked; setForm(f => ({ ...f, contacts: a })) }} className="rounded text-blue-600" />
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Primary Contact</span>
                        </label>
                      </div>
                    </CardRow>
                  ))}
                </div>
                <AddRowButton label="Add Contact Person" onClick={() => setForm(f => ({ ...f, contacts: [...f.contacts, { name: '', mobile: '', email: '', is_primary: false }] }))} />
              </div>
            )}

            {/* ── DIRECTORS ──────────────────────────────────────────────────── */}
            {section === 'directors' && (
              <div className="space-y-5">
                <SectionTitle title="Board of Directors / Partners" />
                <div className="space-y-4">
                  {form.directors.map((d: any, i: number) => (
                    <CardRow key={i} onRemove={() => { const a = [...form.directors]; a.splice(i, 1); setForm(f => ({ ...f, directors: a })) }}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <InputField label="Director / Partner Name" value={d.director_name} onChange={(v: string) => { const a = [...form.directors] as any[]; a[i].director_name = v; setForm(f => ({ ...f, directors: a })) }} placeholder="Full name" />
                        <InputField label="DIN (Director ID No.)" value={d.din} onChange={(v: string) => { const a = [...form.directors] as any[]; a[i].din = v; setForm(f => ({ ...f, directors: a })) }} placeholder="12345678" />
                        <InputField label="Email" value={d.email} onChange={(v: string) => { const a = [...form.directors] as any[]; a[i].email = v; setForm(f => ({ ...f, directors: a })) }} placeholder="director@company.com" />
                        <InputField label="Phone" value={d.phone} onChange={(v: string) => { const a = [...form.directors] as any[]; a[i].phone = v; setForm(f => ({ ...f, directors: a })) }} placeholder="+91..." />
                      </div>
                    </CardRow>
                  ))}
                </div>
                <AddRowButton label="Add Director / Partner" onClick={() => setForm(f => ({ ...f, directors: [...f.directors, { director_name: '', din: '', email: '', phone: '' }] }))} />
              </div>
            )}

            {/* ── AUTH PERSONS ───────────────────────────────────────────────── */}
            {section === 'auth' && (
              <div className="space-y-5">
                <SectionTitle title="Authorised Persons" />
                <div className="space-y-4">
                  {form.auth_persons.map((ap: any, i: number) => (
                    <CardRow key={i} onRemove={() => { const a = [...form.auth_persons]; a.splice(i, 1); setForm(f => ({ ...f, auth_persons: a })) }}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <InputField label="Full Name" value={ap.name} onChange={(v: string) => { const a = [...form.auth_persons] as any[]; a[i].name = v; setForm(f => ({ ...f, auth_persons: a })) }} placeholder="Full name" />
                        <InputField label="Designation" value={ap.designation} onChange={(v: string) => { const a = [...form.auth_persons] as any[]; a[i].designation = v; setForm(f => ({ ...f, auth_persons: a })) }} placeholder="e.g. Sales Manager" />
                        <InputField label="Mobile" value={ap.mobile} onChange={(v: string) => { const a = [...form.auth_persons] as any[]; a[i].mobile = v; setForm(f => ({ ...f, auth_persons: a })) }} placeholder="+91..." />
                        <InputField label="Email" value={ap.email} onChange={(v: string) => { const a = [...form.auth_persons] as any[]; a[i].email = v; setForm(f => ({ ...f, auth_persons: a })) }} placeholder="email@..." />
                      </div>
                    </CardRow>
                  ))}
                </div>
                <AddRowButton label="Add Authorised Person" onClick={() => setForm(f => ({ ...f, auth_persons: [...f.auth_persons, { name: '', designation: '', mobile: '', email: '', is_active: true }] }))} />
              </div>
            )}

            {/* ── FINANCIALS ─────────────────────────────────────────────────── */}
            {section === 'financial' && (
              <div className="space-y-6">
                <SectionTitle title="Banking & Financial Details" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <InputField label="Bank Name" value={form.financial.bank_name}
                    onChange={(v: string) => setForm(f => ({ ...f, financial: { ...f.financial, bank_name: v } }))} placeholder="HDFC Bank" />
                  <InputField label="Account Number" value={form.financial.account_no}
                    onChange={(v: string) => setForm(f => ({ ...f, financial: { ...f.financial, account_no: v } }))} placeholder="50100..." />
                  <InputField label="IFSC Code" value={form.financial.ifsc_code}
                    onChange={(v: string) => setForm(f => ({ ...f, financial: { ...f.financial, ifsc_code: v.toUpperCase() } }))} placeholder="HDFC0001234" />
                  <InputField label="Branch Name" value={form.financial.branch}
                    onChange={(v: string) => setForm(f => ({ ...f, financial: { ...f.financial, branch: v } }))} placeholder="Connaught Place" />
                  <InputField label="Credit Limit (₹)" type="number" value={form.financial.credit_limit}
                    onChange={(v: string) => setForm(f => ({ ...f, financial: { ...f.financial, credit_limit: Number(v) } }))} placeholder="0" />
                  <InputField label="Credit Days" type="number" value={form.financial.credit_days}
                    onChange={(v: string) => setForm(f => ({ ...f, financial: { ...f.financial, credit_days: Number(v) } }))} placeholder="30" />
                </div>

                {/* Security note */}
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 flex items-start gap-4">
                  <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                    <i className="fas fa-shield-alt text-sm"></i>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-blue-800">Your data is safe</p>
                    <p className="text-xs text-blue-600 mt-0.5 leading-relaxed">Banking information is only used for payment processing and is kept strictly confidential.</p>
                  </div>
                </div>
              </div>
            )}

            {/* ── DOCUMENTS ──────────────────────────────────────────────────── */}
            {section === 'docs' && (
              <div className="space-y-5">
                <SectionTitle title="Legal & Compliance Documents" />
                <div className="space-y-4">
                  {form.documents.map((doc: any, i: number) => (
                    <CardRow key={i} onRemove={() => { const a = [...form.documents]; a.splice(i, 1); setForm(f => ({ ...f, documents: a })) }}>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <SelectField label="Document Type" value={doc.document_type}
                          onChange={(v: string) => { const a = [...form.documents] as any[]; a[i].document_type = v; setForm(f => ({ ...f, documents: a })) }}
                          options={['GST Certificate', 'PAN Card', 'Trade License', 'FSSAI License', 'Drug License', 'Import Export Code', 'MSME Certificate', 'Other']} />
                        <InputField label="Start Date" type="date" value={doc.start_date}
                          onChange={(v: string) => { const a = [...form.documents] as any[]; a[i].start_date = v; setForm(f => ({ ...f, documents: a })) }} placeholder="" />
                        <InputField label="Expiry Date" type="date" value={doc.end_date}
                          onChange={(v: string) => { const a = [...form.documents] as any[]; a[i].end_date = v; setForm(f => ({ ...f, documents: a })) }} placeholder="" />
                      </div>
                      <div className="mt-4">
                        <InputField label="Notes / Reference No." value={doc.notes}
                          onChange={(v: string) => { const a = [...form.documents] as any[]; a[i].notes = v; setForm(f => ({ ...f, documents: a })) }}
                          placeholder="Certificate number or remarks..." />
                      </div>
                      <div className="mt-4">
                        <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5">File Upload (PDF, PNG, JPG)</label>
                        <div className="flex gap-2 items-center flex-wrap">
                          <input
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg,.webp"
                            onChange={async (e) => {
                              const file = e.target.files?.[0]
                              if (!file) return
                              const fd = new FormData()
                              fd.append('file', file)
                              try {
                                toast.loading('Uploading document...', { id: 'reg-doc-up' })
                                const res = await suppliers_api.upload_file(fd)
                                const a = [...form.documents] as any[]
                                a[i].file_path = res.data.file_path
                                setForm(f => ({ ...f, documents: a }))
                                toast.success('Document uploaded!', { id: 'reg-doc-up' })
                              } catch (err: any) {
                                toast.error('Upload failed', { id: 'reg-doc-up' })
                              }
                            }}
                            className="flex-1 border border-slate-200 rounded-lg p-1.5 text-xs bg-slate-50 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-[11px] file:font-bold file:bg-blue-600 file:text-white"
                          />
                          {doc.file_path && (
                            <a
                              href={doc.file_path.startsWith('http') ? doc.file_path : `${doc.file_path}`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold whitespace-nowrap hover:bg-blue-100"
                            >
                              View File
                            </a>
                          )}
                        </div>
                      </div>
                    </CardRow>
                  ))}
                </div>
                <AddRowButton label="Add Document" onClick={() => setForm(f => ({ ...f, documents: [...f.documents, { document_type: 'GST Certificate', file_path: '', start_date: '', end_date: '', notes: '' }] }))} />
              </div>
            )}

            {/* ── NOTES ──────────────────────────────────────────────────────── */}
            {section === 'notes' && (
              <div className="space-y-6">
                <SectionTitle title="Additional Notes" />
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">General Notes / Remarks</label>
                  <textarea
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    rows={6}
                    className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm resize-none"
                    placeholder="Any additional information about your company, products, or requirements..."
                  />
                </div>

                {/* Final submit call-to-action */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
                      <i className="fas fa-check-circle text-lg"></i>
                    </div>
                    <div className="flex-1">
                      <p className="font-black text-blue-900 text-sm">Ready to submit?</p>
                      <p className="text-xs text-blue-700 mt-1 leading-relaxed">
                        I hereby certify that all information provided is accurate and authorize Nutribay to verify these details.
                      </p>
                      <button type="button" onClick={handleSubmit} disabled={submitting}
                        className="mt-4 px-10 py-2.5 bg-blue-600 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center gap-2">
                        {submitting
                          ? <><i className="fas fa-circle-notch fa-spin"></i> Submitting...</>
                          : <><i className="fas fa-paper-plane"></i> Submit Registration</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-400 text-xs pb-4">
          Already registered? Contact <span className="text-blue-500 font-bold">procurement@nutribay.com</span>
        </p>
      </div>
    </div>
  )
}
