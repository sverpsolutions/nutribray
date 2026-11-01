import { matchesSearch } from '../../utils/search';
import { useEffect, useState, useRef } from 'react'
import { Link } from 'react-router-dom'
import { suppliers_api, states_api, type supplier_list_item, type supplier_detail, type state_item, type supplier_gstin_item } from '../../api/suppliers'
import PageHeader from '../../components/ui/PageHeader'
import StatusBadge from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'

// ── Fallback state list (used if API is unreachable) ─────────────────────────
const FALLBACK_STATES: state_item[] = [
  { id:1,  state_code:'01', state_name:'Jammu & Kashmir',                              is_ut:true  },
  { id:2,  state_code:'02', state_name:'Himachal Pradesh',                             is_ut:false },
  { id:3,  state_code:'03', state_name:'Punjab',                                       is_ut:false },
  { id:4,  state_code:'04', state_name:'Chandigarh',                                   is_ut:true  },
  { id:5,  state_code:'05', state_name:'Uttarakhand',                                  is_ut:false },
  { id:6,  state_code:'06', state_name:'Haryana',                                      is_ut:false },
  { id:7,  state_code:'07', state_name:'Delhi',                                        is_ut:true  },
  { id:8,  state_code:'08', state_name:'Rajasthan',                                    is_ut:false },
  { id:9,  state_code:'09', state_name:'Uttar Pradesh',                                is_ut:false },
  { id:10, state_code:'10', state_name:'Bihar',                                        is_ut:false },
  { id:11, state_code:'11', state_name:'Sikkim',                                       is_ut:false },
  { id:12, state_code:'12', state_name:'Arunachal Pradesh',                            is_ut:false },
  { id:13, state_code:'13', state_name:'Nagaland',                                     is_ut:false },
  { id:14, state_code:'14', state_name:'Manipur',                                      is_ut:false },
  { id:15, state_code:'15', state_name:'Mizoram',                                      is_ut:false },
  { id:16, state_code:'16', state_name:'Tripura',                                      is_ut:false },
  { id:17, state_code:'17', state_name:'Meghalaya',                                    is_ut:false },
  { id:18, state_code:'18', state_name:'Assam',                                        is_ut:false },
  { id:19, state_code:'19', state_name:'West Bengal',                                  is_ut:false },
  { id:20, state_code:'20', state_name:'Jharkhand',                                    is_ut:false },
  { id:21, state_code:'21', state_name:'Odisha',                                       is_ut:false },
  { id:22, state_code:'22', state_name:'Chhattisgarh',                                 is_ut:false },
  { id:23, state_code:'23', state_name:'Madhya Pradesh',                               is_ut:false },
  { id:24, state_code:'24', state_name:'Gujarat',                                      is_ut:false },
  { id:25, state_code:'25', state_name:'Dadra & Nagar Haveli and Daman & Diu',         is_ut:true  },
  { id:26, state_code:'26', state_name:'Daman & Diu',                                  is_ut:true  },
  { id:27, state_code:'27', state_name:'Maharashtra',                                  is_ut:false },
  { id:28, state_code:'28', state_name:'Andhra Pradesh (Old)',                         is_ut:false },
  { id:29, state_code:'29', state_name:'Karnataka',                                    is_ut:false },
  { id:30, state_code:'30', state_name:'Goa',                                          is_ut:false },
  { id:31, state_code:'31', state_name:'Lakshadweep',                                  is_ut:true  },
  { id:32, state_code:'32', state_name:'Kerala',                                       is_ut:false },
  { id:33, state_code:'33', state_name:'Tamil Nadu',                                   is_ut:false },
  { id:34, state_code:'34', state_name:'Puducherry',                                   is_ut:true  },
  { id:35, state_code:'35', state_name:'Andaman & Nicobar Islands',                    is_ut:true  },
  { id:36, state_code:'36', state_name:'Telangana',                                    is_ut:false },
  { id:37, state_code:'37', state_name:'Andhra Pradesh',                               is_ut:false },
  { id:38, state_code:'38', state_name:'Ladakh',                                       is_ut:true  },
  { id:39, state_code:'97', state_name:'Other Territory',                              is_ut:false },
  { id:40, state_code:'99', state_name:'Centre Jurisdiction',                          is_ut:false },
]

type TabType = 'list' | 'basic' | 'address' | 'legal' | 'contact' | 'directors' | 'auth' | 'brands' | 'financial' | 'docs' | 'notes'

const TabButton = ({ id, label, icon, activeId, onClick }: { id: TabType; label: string; icon: string; activeId: string; onClick: (id: TabType) => void }) => (
  <button
    onClick={() => onClick(id)}
    className={`flex items-center gap-2 px-4 py-3 text-[11px] font-black uppercase tracking-widest transition-all border-b-2 w-full text-left ${activeId === id ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
  >
    <i className={`fas ${icon} text-xs w-4`}></i>
    {label}
  </button>
)

const InputField = ({ label, value, onChange, placeholder, type = 'text', required = false }: any) => (
  <div className="space-y-1.5">
    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
    <input type={type} value={value ?? ''} onChange={e => onChange(e.target.value)}
      className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm" placeholder={placeholder} />
  </div>
)

const SelectField = ({ label, value, onChange, options }: any) => (
  <div className="space-y-1.5">
    <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</label>
    <select value={value ?? ''} onChange={e => onChange(e.target.value)}
      className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm bg-white">
      {options.map((opt: any) => <option key={opt.value ?? opt} value={opt.value ?? opt}>{opt.label ?? opt}</option>)}
    </select>
  </div>
)

const SectionTitle = ({ title }: { title: string }) => (
  <h3 className="text-base font-black text-slate-800 border-l-4 border-blue-600 pl-4 mb-6">{title}</h3>
)

const CardRow = ({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) => (
  <div className="relative p-5 bg-slate-50 rounded-xl border border-slate-200 group">
    <button onClick={onRemove} className="absolute top-3 right-3 text-slate-300 hover:text-red-500 transition-colors">
      <i className="fas fa-times-circle text-lg"></i>
    </button>
    {children}
  </div>
)

const AddRowButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button onClick={onClick} className="w-full p-6 border-2 border-dashed border-slate-200 rounded-xl text-center text-slate-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/30 transition-all group">
    <i className="fas fa-plus-circle text-xl mb-1 block group-hover:scale-110 transition-transform"></i>
    <span className="text-[11px] font-black uppercase tracking-widest">{label}</span>
  </button>
)

const BLANK_GSTIN: supplier_gstin_item = {
  gstin: '', state_code: '', state_name: '', pan: '', registration_type: 'Regular', is_primary: false, is_active: true,
}

const CIN_REQUIRED = new Set(['Pvt Ltd', 'Private Limited', 'Limited', 'Public Ltd', 'LLP'])

const BLANK_FORM: Partial<supplier_detail> = {
  name: '', supplier_code: '', supplier_type: 'Manufacturer', company_type: 'Proprietorship',
  category: 'FMCG', contact_name: '', phone: '', email: '', address: '', city: '',
  state: 'Delhi', state_code: '', pincode: '', district: '', country: 'India',
  gst_number: '', pan_number: '', cin_number: '', website: '',
  addresses: [], contacts: [], directors: [], auth_persons: [], brands: [],
  financial: { bank_name: '', account_no: '', ifsc_code: '', branch: '', credit_limit: 0, credit_days: 0 },
  documents: [], internal_notes: [], gstins: [],
}

const OnboardingModal = ({ isOpen, onClose, onSuccess }: { isOpen: boolean; onClose: () => void; onSuccess: (link: string) => void }) => {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  async function handleGenerate() {
    if (!name || !phone) { toast.error("Name and Phone are required"); return }
    setLoading(true)
    try {
      const res = await suppliers_api.generateOnboardingLink(phone, name)
      const link = `${window.location.origin}/vendor-registration/${res.data.onboarding_token}`
      onSuccess(link)
    } catch (err) {
      toast.error("Failed to generate link")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-100 transform transition-all scale-100">
        <div className="bg-gradient-to-r from-indigo-600 to-blue-700 p-6">
          <div className="flex justify-between items-center">
            <h3 className="text-xl font-bold text-white">Generate Onboarding Link</h3>
            <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
              <i className="fas fa-times"></i>
            </button>
          </div>
          <p className="text-indigo-100 text-xs mt-1 font-medium opacity-80 uppercase tracking-widest">Send a self-registration form to a vendor</p>
        </div>
        <div className="p-8 space-y-6">
          <InputField label="Vendor/Company Name" value={name} onChange={setName} placeholder="e.g. Reliance Retail" />
          <InputField label="Vendor Mobile Number" value={phone} onChange={setPhone} placeholder="10 digit mobile" />
          <div className="pt-2">
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-black py-4 rounded-2xl shadow-xl shadow-indigo-100 transition-all active:scale-95 disabled:opacity-50 uppercase tracking-widest text-xs"
            >
              {loading ? <><i className="fas fa-circle-notch fa-spin mr-2"></i> Generating...</> : "Generate & Copy Link"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SuppliersPage({ searchQuery = '', onCountUpdate }: { searchQuery?: string; onCountUpdate?: (count: number) => void }) {
  const [view, setView] = useState<TabType>('list')
  const [items, setItems] = useState<supplier_list_item[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [form, setForm] = useState<Partial<supplier_detail>>({ ...BLANK_FORM })
  const [availableBrands, setAvailableBrands] = useState<any[]>([])
  const [brandSearch, setBrandSearch] = useState('')
  const [showBrandDrop, setShowBrandDrop] = useState(false)
  const brandRef = useRef<HTMLDivElement>(null)

  // GST / State — initialise with fallback so dropdown is never empty
  const [allStates, setAllStates] = useState<state_item[]>(FALLBACK_STATES)
  const [gstinStatus, setGstinStatus] = useState<{ valid: boolean | null; msg: string; pan?: string; state_code?: string; state_name?: string }>({ valid: null, msg: '' })
  const [panStatus, setPanStatus] = useState<{ valid: boolean | null; msg: string }>({ valid: null, msg: '' })
  const [cinStatus, setCinStatus] = useState<{ valid: boolean | null; msg: string }>({ valid: null, msg: '' })
  const [showOnboarding, setShowOnboarding] = useState(false)
  const gstinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function loadList() {
    setLoading(true)
    try {
      const res = await suppliers_api.list({ per_page: 1000 })
      const data = res.data.data ?? []
      setItems(data)
      if (onCountUpdate) onCountUpdate(data.length)
    } catch { toast.error('Failed to load suppliers') }
    finally { setLoading(false) }
  }

  async function loadBrands() {
    try {
      const res = await suppliers_api.get_brands()
      setAvailableBrands(Array.isArray(res.data) ? res.data : [])
    } catch { }
  }

  async function loadStates() {
    try {
      const r = await states_api.list()
      if (Array.isArray(r.data) && r.data.length > 0) setAllStates(r.data)
      // if API returns empty or fails, FALLBACK_STATES already loaded via useState default
    } catch {
      // silently keep FALLBACK_STATES — no disruption to user
    }
  }

  useEffect(() => { loadList(); loadBrands(); loadStates() }, [])

  // Close brand dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (brandRef.current && !brandRef.current.contains(e.target as Node)) setShowBrandDrop(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function handleEdit(id: number) {
    setLoading(true)
    try {
      const res = await suppliers_api.get(id)
      setForm({ ...res.data, gstins: res.data.gstins || [] })
      setSelectedId(id)
      setGstinStatus({ valid: null, msg: '' })
      setPanStatus({ valid: null, msg: '' })
      setCinStatus({ valid: null, msg: '' })
      setView('basic')
    } catch { toast.error('Failed to load supplier') }
    finally { setLoading(false) }
  }

  function handleAddNew() {
    setSelectedId(null)
    setForm({ ...BLANK_FORM, addresses: [], contacts: [], directors: [], auth_persons: [], brands: [], documents: [], internal_notes: [], gstins: [], financial: { bank_name: '', account_no: '', ifsc_code: '', branch: '', credit_limit: 0, credit_days: 0 } })
    setGstinStatus({ valid: null, msg: '' })
    setPanStatus({ valid: null, msg: '' })
    setCinStatus({ valid: null, msg: '' })
    setView('basic')
  }

  async function handleSave() {
    if (!form.name?.trim()) { toast.error('Supplier Name is required'); return }
    if (!form.phone?.trim()) { toast.error('Primary Mobile is required'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        brands: (form.brands || []).map((b: any) => typeof b === 'number' ? { brand_id: b, credit_days: 0 } : { brand_id: b.brand_id, credit_days: b.credit_days || 0 }),
        contacts: (form.contacts || []).map((c: any) => ({ name: c.name || '', mobile: c.mobile || '', email: c.email || '', is_primary: c.is_primary || false })),
      }
      if (selectedId) {
        await suppliers_api.update(selectedId, payload)
        toast.success('Supplier updated')
      } else {
        await suppliers_api.create(payload)
        toast.success('Supplier registered')
      }
      setView('list')
      loadList()
    } catch (e: any) {
      const detail = e.response?.data?.detail
      const msg = Array.isArray(detail)
        ? detail.map((d: any) => `${d.loc?.slice(-1)[0]}: ${d.msg}`).join(', ')
        : (detail || e.message || 'Error saving')
      toast.error(msg)
    } finally { setSaving(false) }
  }

  // Brand helpers
  const mappedBrandIds = new Set((form.brands || []).map((b: any) => b.brand_id ?? b))
  const brandSuggestions = brandSearch.trim()
    ? availableBrands.filter(b => !mappedBrandIds.has(b.id) &&
        matchesSearch(brandSearch, b.name, b.code)).slice(0, 15)
    : []

  function addBrand(b: any) {
    setForm(f => ({ ...f, brands: [...(f.brands || []), { brand_id: b.id, brand_name: b.name, credit_days: 0 }] }))
    setBrandSearch('')
    setShowBrandDrop(false)
  }
  function removeBrand(brandId: number) {
    setForm(f => ({ ...f, brands: (f.brands || []).filter((mb: any) => (mb.brand_id ?? mb) !== brandId) }))
  }

  // ── GSTIN live validate ───────────────────────────────────────────────────────
  // MOD-36 checksum (same algorithm as backend)
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

  // Local fast check before hitting API (includes checksum)
  function _localGstinCheck(g: string): { ok: boolean; err: string } {
    if (g.length !== 15) return { ok: false, err: `GSTIN must be 15 characters (${g.length} entered)` }
    const pat = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/
    if (!pat.test(g)) return { ok: false, err: 'Invalid format — expected: 07AAAAA1234F1Z5 (state code + PAN + entity + Z + check digit)' }
    const sc = g.slice(0, 2)
    const validSC = new Set(FALLBACK_STATES.map(s => s.state_code))
    if (!validSC.has(sc)) return { ok: false, err: `Invalid state code '${sc}' in GSTIN` }
    // Checksum validation
    const expected = _gstinChecksum(g)
    if (expected !== g[14]) {
      return { ok: false, err: `Checksum mismatch — last character should be '${expected}', not '${g[14]}'. Correct GSTIN: ${g.slice(0, 14)}${expected}` }
    }
    return { ok: true, err: '' }
  }

  function handleGstinChange(v: string) {
    const val = v.toUpperCase().replace(/\s/g, '')
    setForm(f => ({ ...f, gst_number: val }))
    if (gstinTimer.current) clearTimeout(gstinTimer.current)

    // Clear status while typing
    if (!val) { setGstinStatus({ valid: null, msg: '' }); return }

    // Instant local check while typing (< 15 chars just show neutral)
    if (val.length < 15) {
      setGstinStatus({ valid: null, msg: `${val.length}/15 characters` })
      return
    }

    // At 15 chars: immediate local format check
    const local = _localGstinCheck(val)
    if (!local.ok) {
      setGstinStatus({ valid: false, msg: local.err })
      return
    }

    // Format OK — show "checking" and call API for checksum + state name
    setGstinStatus({ valid: null, msg: '⏳ Verifying...' })
    gstinTimer.current = setTimeout(async () => {
      try {
        const r = await states_api.validate_gstin(val, (form as any).state_code || undefined)
        if (!r.data.valid) {
          setGstinStatus({ valid: false, msg: r.data.error || 'Invalid GSTIN' })
        } else {
          const auto_pan = r.data.pan || val.slice(2, 12)
          const auto_sc  = r.data.state_code || val.slice(0, 2)
          const auto_sn  = r.data.state_name || auto_sc
          setForm(f => ({
            ...f,
            pan_number: (f as any).pan_number || auto_pan,
            state_code: (f as any).state_code || auto_sc,
          }))
          if (r.data.state_mismatch) {
            setGstinStatus({ valid: false, msg: r.data.mismatch_message || 'State mismatch', pan: auto_pan, state_code: auto_sc, state_name: auto_sn })
          } else {
            setGstinStatus({ valid: true, msg: `✓ Valid GSTIN — ${auto_sn} · PAN auto-filled`, pan: auto_pan, state_code: auto_sc, state_name: auto_sn })
          }
        }
      } catch {
        // API unreachable — fall back to local check result (format was ok)
        const auto_pan = val.slice(2, 12)
        const auto_sc  = val.slice(0, 2)
        setForm(f => ({
          ...f,
          pan_number: (f as any).pan_number || auto_pan,
          state_code: (f as any).state_code || auto_sc,
        }))
        setGstinStatus({ valid: true, msg: `✓ Format valid — State: ${auto_sc} · PAN: ${auto_pan}` })
      }
    }, 400)
  }

  async function handlePanChange(v: string) {
    const val = v.toUpperCase().replace(/\s/g, '')
    setForm(f => ({ ...f, pan_number: val }))
    if (!val) { setPanStatus({ valid: null, msg: '' }); return }
    if (val.length < 10) { setPanStatus({ valid: null, msg: `${val.length}/10 characters` }); return }
    // Instant local check
    const panPat = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
    if (!panPat.test(val)) {
      setPanStatus({ valid: false, msg: 'Invalid format — expected: ABCDE1234F (5 letters · 4 digits · 1 letter)' })
      return
    }
    try {
      const r = await states_api.validate_pan(val)
      setPanStatus({ valid: r.data.valid, msg: r.data.valid ? `✓ Valid PAN (${val})` : (r.data.error || 'Invalid PAN') })
    } catch {
      setPanStatus({ valid: true, msg: `✓ Format valid (${val})` })
    }
  }

  async function handleCinChange(v: string) {
    const val = v.toUpperCase()
    setForm(f => ({ ...f, cin_number: val } as any))
    if (!val) { setCinStatus({ valid: null, msg: '' }); return }
    try {
      const r = await states_api.validate_cin(val, (form as any).company_type)
      setCinStatus({ valid: r.data.valid, msg: r.data.valid ? '✓ Valid CIN' : (r.data.error || 'Invalid CIN') })
    } catch { }
  }

  // ── GSTIN row (multi-state) ───────────────────────────────────────────────────
  function addGstinRow() {
    setForm(f => ({ ...f, gstins: [...((f as any).gstins || []), { ...BLANK_GSTIN }] } as any))
  }
  function removeGstinRow(i: number) {
    setForm(f => {
      const arr = [...((f as any).gstins || [])]
      arr.splice(i, 1)
      return { ...f, gstins: arr } as any
    })
  }
  function updateGstinRow(i: number, field: string, value: any) {
    setForm(f => {
      const arr = [...((f as any).gstins || [])] as any[]
      arr[i] = { ...arr[i], [field]: value }
      if (field === 'gstin' && value.length === 15) {
        const sc = value.slice(0, 2)
        const pan = value.slice(2, 12)
        const sn = allStates.find(s => s.state_code === sc)?.state_name || sc
        arr[i].state_code = sc
        arr[i].state_name = sn
        arr[i].pan = pan
      }
      return { ...f, gstins: arr } as any
    })
  }

  // ── List View ────────────────────────────────────────────────────────────────
  if (view === 'list') {
    const filtered = items.filter(s => matchesSearch(searchQuery, s?.name))
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <PageHeader title="Supplier Master" subtitle="Manage product suppliers, legal data, and contracts" />
          <div className="flex gap-3">
            <button 
                onClick={() => setShowOnboarding(true)}
                className="bg-slate-100 text-slate-700 px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center gap-2 border border-slate-200">
                <i className="fas fa-link text-indigo-500"></i> Onboarding Link
            </button>
            <button onClick={handleAddNew} className="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-blue-200 hover:bg-blue-700 transition-all flex items-center gap-2">
                <i className="fas fa-plus"></i> New Supplier
            </button>
          </div>
        </div>

        <OnboardingModal 
            isOpen={showOnboarding} 
            onClose={() => setShowOnboarding(false)} 
            onSuccess={(link) => {
                navigator.clipboard.writeText(link)
                toast.success("Link copied to clipboard!")
                // Also provide WhatsApp option
                const msg = encodeURIComponent(`Hi, please fill in your details for onboarding at Nutribay using this link: ${link}`)
                window.open(`https://wa.me/?text=${msg}`, '_blank')
                setShowOnboarding(false)
            }} 
        />
        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-900 text-white uppercase tracking-wider text-[10px] font-black">
                <tr>
                  <th className="px-6 py-4 text-center w-12">#</th>
                  <th className="px-6 py-4 text-left">Supplier</th>
                  <th className="px-6 py-4 text-left">Phone</th>
                  <th className="px-6 py-4 text-left">GSTIN</th>
                  <th className="px-6 py-4 text-left">City / Type</th>
                  <th className="px-6 py-4 text-center w-28">Status</th>
                  <th className="px-6 py-4 text-center w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-20"><i className="fas fa-circle-notch fa-spin text-3xl text-blue-500"></i></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-20 text-slate-400 italic">No suppliers found</td></tr>
                ) : filtered.map((s, i) => (
                  <tr key={s.id} className="hover:bg-blue-50/30 transition-colors">
                    <td className="px-6 py-4 text-center text-slate-400 font-mono text-xs">{i + 1}</td>
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-800">{s.name}</div>
                      <div className="text-[10px] text-slate-400 font-black uppercase">{s.supplier_code}</div>
                    </td>
                    <td className="px-6 py-4 text-slate-600">{s.phone}</td>
                    <td className="px-6 py-4 font-mono text-[11px] font-bold text-blue-600">{s.gst_number || '—'}</td>
                    <td className="px-6 py-4">
                      <div className="text-slate-500 font-black uppercase text-[10px]">{s.city || '—'}</div>
                      <div className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded self-start mt-1 font-bold inline-block">{s.supplier_type}</div>
                    </td>
                    <td className="px-6 py-4 text-center"><StatusBadge active={s.status} /></td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <Link to={`/masters/suppliers/${s.id}`} className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 uppercase border border-indigo-200 px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 transition-all">
                          View Details
                        </Link>
                        <button onClick={() => handleEdit(s.id)} className="text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase border border-blue-200 px-2.5 py-1.5 rounded-lg hover:bg-blue-50 transition-all">
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  // ── Form View ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button onClick={() => setView('list')} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-all">
            <i className="fas fa-arrow-left"></i>
          </button>
          <PageHeader
            title={selectedId ? `Edit: ${form.name}` : 'Register New Supplier'}
            subtitle={selectedId ? `Code: ${form.supplier_code}` : 'Fill all sections and save'}
          />
        </div>
        <div className="flex gap-3">
          <button onClick={() => setView('list')} className="px-5 py-2.5 text-xs font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 rounded-xl transition-all">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-10 py-2.5 text-xs font-black uppercase tracking-widest bg-blue-600 text-white rounded-xl shadow-lg hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center gap-2">
            {saving ? <><i className="fas fa-circle-notch fa-spin"></i> Saving...</> : <><i className="fas fa-save"></i> Save Supplier</>}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex min-h-[600px]">
        {/* Left Tabs */}
        <div className="w-56 bg-slate-50 border-r border-slate-200 flex flex-col shrink-0">
          <div className="p-5 border-b border-slate-200 bg-white">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center text-white text-2xl font-black mb-2 shadow-lg">
              {form.name?.[0]?.toUpperCase() || 'S'}
            </div>
            <p className="font-black text-slate-800 text-sm truncate">{form.name || 'New Supplier'}</p>
            <p className="text-[9px] text-slate-400 font-black uppercase tracking-widest">{form.supplier_code || 'SUP-NEW'}</p>
          </div>
          <nav className="flex-1 py-2 overflow-y-auto">
            <TabButton id="basic" label="Basic Info" icon="fa-info-circle" activeId={view} onClick={setView} />
            <TabButton id="address" label="Addresses" icon="fa-map-marker-alt" activeId={view} onClick={setView} />
            <TabButton id="legal" label="Legal & Tax" icon="fa-gavel" activeId={view} onClick={setView} />
            <TabButton id="contact" label="Contacts" icon="fa-address-book" activeId={view} onClick={setView} />
            <TabButton id="directors" label="Directors" icon="fa-users-cog" activeId={view} onClick={setView} />
            <TabButton id="auth" label="Auth Persons" icon="fa-user-check" activeId={view} onClick={setView} />
            <TabButton id="brands" label="Brands" icon="fa-tags" activeId={view} onClick={setView} />
            <TabButton id="financial" label="Financials" icon="fa-university" activeId={view} onClick={setView} />
            <TabButton id="docs" label="Documents" icon="fa-file-alt" activeId={view} onClick={setView} />
            <TabButton id="notes" label="Notes" icon="fa-sticky-note" activeId={view} onClick={setView} />
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 p-8 overflow-y-auto">

          {/* ── Basic Info ── */}
          {view === 'basic' && (
            <div className="space-y-8">
              <SectionTitle title="General Information" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <InputField label="Supplier Name" required value={form.name} onChange={(v: string) => setForm(f => ({ ...f, name: v }))} placeholder="Full legal name" />
                <InputField label="Supplier Code" value={form.supplier_code} onChange={(v: string) => setForm(f => ({ ...f, supplier_code: v }))} placeholder="Auto-generated if blank" />
                <SelectField label="Supplier Type" value={form.supplier_type} onChange={(v: string) => setForm(f => ({ ...f, supplier_type: v }))} options={['Manufacturer', 'Distributor', 'Importer', 'Local Vendor', 'Agent']} />
                <SelectField label="Company Type" value={form.company_type} onChange={(v: string) => setForm(f => ({ ...f, company_type: v }))} options={['Proprietorship', 'Partnership', 'Pvt Ltd', 'LLP', 'Public Ltd']} />
                <SelectField label="Category" value={form.category} onChange={(v: string) => setForm(f => ({ ...f, category: v }))} options={['FMCG', 'Beverage', 'Grocery', 'Frozen', 'Electronics', 'Dairy', 'Bakery', 'General']} />
              </div>
              <div className="border-t border-slate-100 pt-6">
                <SectionTitle title="Primary Contact" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <InputField label="Contact Person Name" value={form.contact_name} onChange={(v: string) => setForm(f => ({ ...f, contact_name: v }))} placeholder="e.g. Mr. Rajesh Kumar" />
                  <InputField label="Primary Mobile" required value={form.phone} onChange={(v: string) => setForm(f => ({ ...f, phone: v }))} placeholder="+91 9876543210" />
                  <InputField label="Email Address" value={form.email} onChange={(v: string) => setForm(f => ({ ...f, email: v }))} placeholder="office@supplier.com" />
                  <InputField label="Website" value={(form as any).website} onChange={(v: string) => setForm(f => ({ ...f, website: v } as any))} placeholder="www.supplier.com" />
                </div>
              </div>
            </div>
          )}

          {/* ── Address ── */}
          {view === 'address' && (
            <div className="space-y-6">
              <SectionTitle title="Location Details" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <InputField label="Billing Address" value={form.address} onChange={(v: string) => setForm(f => ({ ...f, address: v }))} placeholder="Door no, Street, Area..." />
                </div>
                <InputField label="City" value={form.city} onChange={(v: string) => setForm(f => ({ ...f, city: v }))} placeholder="Mumbai" />
                <InputField label="State" value={form.state} onChange={(v: string) => setForm(f => ({ ...f, state: v }))} placeholder="Maharashtra" />
                <InputField label="Pincode" value={form.pincode} onChange={(v: string) => setForm(f => ({ ...f, pincode: v }))} placeholder="400001" />
                <InputField label="District" value={form.district} onChange={(v: string) => setForm(f => ({ ...f, district: v }))} placeholder="Mumbai Suburban" />
                <InputField label="Country" value={form.country} onChange={(v: string) => setForm(f => ({ ...f, country: v }))} placeholder="India" />
              </div>
            </div>
          )}

          {/* ── Legal ── */}
          {view === 'legal' && (
            <div className="space-y-8">
              <SectionTitle title="GST & Compliance" />

              {/* Primary GSTIN */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <SelectField label="GST Registration Type"
                  value={(form as any).legal?.registration_type || 'Regular'}
                  onChange={(v: string) => setForm(f => ({ ...f, legal: { ...((f as any).legal || {}), registration_type: v } } as any))}
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
                    <span className={`text-[9px] font-bold ${((form as any).gst_number || '').length === 15 ? 'text-green-500' : 'text-slate-400'}`}>
                      {((form as any).gst_number || '').length}/15
                    </span>
                  </div>
                  <input
                    value={(form as any).gst_number || ''}
                    onChange={e => handleGstinChange(e.target.value)}
                    maxLength={15}
                    placeholder="e.g. 07AAAAA1234F1Z5  (State+PAN+Z+Check)"
                    className={`w-full border rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 transition-all shadow-sm tracking-widest uppercase
                      ${gstinStatus.valid === true ? 'border-green-400 bg-green-50/30 focus:ring-green-200'
                        : gstinStatus.valid === false ? 'border-red-400 bg-red-50/30 focus:ring-red-200'
                        : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'}`}
                  />
                  {gstinStatus.msg && (
                    <p className={`text-[10px] font-bold mt-1 flex items-center gap-1.5
                      ${gstinStatus.valid === true ? 'text-green-600'
                        : gstinStatus.valid === false ? 'text-red-500'
                        : 'text-slate-400'}`}>
                      {gstinStatus.valid === null && gstinStatus.msg.startsWith('⏳') && (
                        <i className="fas fa-circle-notch fa-spin text-[9px]"></i>
                      )}
                      {gstinStatus.msg}
                    </p>
                  )}
                </div>

                {/* State auto-detected */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">State <span className="text-slate-300 font-normal">(auto-detected from GSTIN)</span></label>
                  <select
                    value={(form as any).state_code || ''}
                    onChange={e => setForm(f => ({ ...f, state_code: e.target.value } as any))}
                    className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm bg-white"
                  >
                    <option value="">— Select State —</option>
                    {allStates.map(s => (
                      <option key={s.state_code} value={s.state_code}>{s.state_code} — {s.state_name}{s.is_ut ? ' (UT)' : ''}</option>
                    ))}
                  </select>
                </div>

                {/* PAN with live validation */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">PAN Number <span className="text-slate-300 font-normal">(auto from GSTIN)</span></label>
                  <input
                    value={(form as any).pan_number || ''}
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
                  value={(form as any).legal?.tan_no}
                  onChange={(v: string) => setForm(f => ({ ...f, legal: { ...((f as any).legal || {}), tan_no: v } } as any))}
                  placeholder="RTKA12345B" />

                {/* CIN — conditional based on company type */}
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">
                    CIN Number
                    {CIN_REQUIRED.has((form as any).company_type || '') && <span className="text-red-500 ml-1">* Required</span>}
                  </label>
                  <input
                    value={(form as any).cin_number || ''}
                    onChange={e => handleCinChange(e.target.value)}
                    maxLength={21}
                    placeholder="U12345MH2020PTC126385"
                    className={`w-full border rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 transition-all shadow-sm font-mono
                      ${cinStatus.valid === true ? 'border-green-400 focus:ring-green-200' : cinStatus.valid === false ? 'border-red-400 focus:ring-red-200' :
                        CIN_REQUIRED.has((form as any).company_type || '') ? 'border-amber-300 focus:ring-amber-200' : 'border-slate-200 focus:ring-blue-500/20 focus:border-blue-500'}`}
                  />
                  {cinStatus.msg && (
                    <p className={`text-[10px] font-bold mt-1 ${cinStatus.valid ? 'text-green-600' : 'text-red-500'}`}>{cinStatus.msg}</p>
                  )}
                  {!cinStatus.msg && CIN_REQUIRED.has((form as any).company_type || '') && (
                    <p className="text-[10px] text-amber-600 font-bold mt-1">⚠ Mandatory for {(form as any).company_type}</p>
                  )}
                </div>
              </div>

              {/* Multi-state GSTINs */}
              <div className="border-t border-slate-100 pt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-black text-slate-700 uppercase tracking-widest">Multi-State GSTIN Registrations</h4>
                  <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-[10px] font-black">{((form as any).gstins || []).length} Registered</span>
                </div>
                {((form as any).gstins || []).map((g: any, i: number) => (
                  <div key={i} className="relative p-4 bg-slate-50 border border-slate-200 rounded-xl group">
                    <button onClick={() => removeGstinRow(i)} className="absolute top-3 right-3 text-slate-300 hover:text-red-500 transition-colors">
                      <i className="fas fa-times-circle"></i>
                    </button>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">GSTIN</label>
                        <input
                          value={g.gstin}
                          onChange={e => updateGstinRow(i, 'gstin', e.target.value.toUpperCase())}
                          maxLength={15}
                          placeholder="27AAAAA1234F1Z5"
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">State (auto)</label>
                        <input value={g.state_name || g.state_code} readOnly
                          className="w-full border border-slate-100 rounded-lg px-3 py-2 text-sm bg-slate-100 text-slate-500 font-medium" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">PAN (auto)</label>
                        <input value={g.pan} readOnly
                          className="w-full border border-slate-100 rounded-lg px-3 py-2 text-sm bg-slate-100 text-slate-500 font-mono" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase">Registration Type</label>
                        <select value={g.registration_type} onChange={e => updateGstinRow(i, 'registration_type', e.target.value)}
                          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20">
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
                <button onClick={addGstinRow}
                  className="w-full p-4 border-2 border-dashed border-slate-200 rounded-xl text-center text-slate-400 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/30 transition-all text-xs font-black uppercase tracking-widest">
                  <i className="fas fa-plus-circle mr-2"></i>Add GSTIN (Another State)
                </button>
              </div>
            </div>
          )}

          {/* ── Contacts ── */}
          {view === 'contact' && (
            <div className="space-y-5">
              <SectionTitle title="Additional Contact Persons" />
              <div className="space-y-4">
                {(form.contacts || []).map((c: any, i: number) => (
                  <CardRow key={i} onRemove={() => {
                    const arr = [...(form.contacts || [])]
                    arr.splice(i, 1)
                    setForm(f => ({ ...f, contacts: arr }))
                  }}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <InputField label="Name" value={c.name} onChange={(v: string) => {
                        const arr = [...(form.contacts || [])] as any[]
                        arr[i].name = v
                        setForm(f => ({ ...f, contacts: arr }))
                      }} placeholder="Full name" />
                      <InputField label="Mobile" value={c.mobile} onChange={(v: string) => {
                        const arr = [...(form.contacts || [])] as any[]
                        arr[i].mobile = v
                        setForm(f => ({ ...f, contacts: arr }))
                      }} placeholder="+91..." />
                      <InputField label="Email" value={c.email} onChange={(v: string) => {
                        const arr = [...(form.contacts || [])] as any[]
                        arr[i].email = v
                        setForm(f => ({ ...f, contacts: arr }))
                      }} placeholder="email@..." />
                    </div>
                    <div className="mt-3">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={c.is_primary} onChange={e => {
                          const arr = [...(form.contacts || [])] as any[]
                          arr[i].is_primary = e.target.checked
                          setForm(f => ({ ...f, contacts: arr }))
                        }} className="rounded text-blue-600" />
                        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Primary Contact</span>
                      </label>
                    </div>
                  </CardRow>
                ))}
              </div>
              <AddRowButton label="Add Contact Person" onClick={() => setForm(f => ({ ...f, contacts: [...(f.contacts || []), { name: '', mobile: '', email: '', is_primary: false }] }))} />
            </div>
          )}

          {/* ── Directors ── */}
          {view === 'directors' && (
            <div className="space-y-5">
              <SectionTitle title="Board of Directors / Partners" />
              <div className="space-y-4">
                {(form.directors || []).map((d: any, i: number) => (
                  <CardRow key={i} onRemove={() => {
                    const arr = [...(form.directors || [])]
                    arr.splice(i, 1)
                    setForm(f => ({ ...f, directors: arr }))
                  }}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <InputField label="Director / Partner Name" value={d.director_name} onChange={(v: string) => {
                        const arr = [...(form.directors || [])] as any[]
                        arr[i].director_name = v
                        setForm(f => ({ ...f, directors: arr }))
                      }} placeholder="Full name" />
                      <InputField label="DIN (Director ID No.)" value={d.din} onChange={(v: string) => {
                        const arr = [...(form.directors || [])] as any[]
                        arr[i].din = v
                        setForm(f => ({ ...f, directors: arr }))
                      }} placeholder="12345678" />
                      <InputField label="Email" value={d.email} onChange={(v: string) => {
                        const arr = [...(form.directors || [])] as any[]
                        arr[i].email = v
                        setForm(f => ({ ...f, directors: arr }))
                      }} placeholder="director@company.com" />
                      <InputField label="Phone" value={d.phone} onChange={(v: string) => {
                        const arr = [...(form.directors || [])] as any[]
                        arr[i].phone = v
                        setForm(f => ({ ...f, directors: arr }))
                      }} placeholder="+91..." />
                    </div>
                  </CardRow>
                ))}
              </div>
              <AddRowButton label="Add Director / Partner" onClick={() => setForm(f => ({ ...f, directors: [...(f.directors || []), { director_name: '', din: '', email: '', phone: '' }] }))} />
            </div>
          )}

          {/* ── Auth Persons ── */}
          {view === 'auth' && (
            <div className="space-y-5">
              <SectionTitle title="Authorised Persons" />
              <div className="space-y-4">
                {(form.auth_persons || []).map((ap: any, i: number) => (
                  <CardRow key={i} onRemove={() => {
                    const arr = [...(form.auth_persons || [])]
                    arr.splice(i, 1)
                    setForm(f => ({ ...f, auth_persons: arr }))
                  }}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <InputField label="Full Name" value={ap.name} onChange={(v: string) => {
                        const arr = [...(form.auth_persons || [])] as any[]
                        arr[i].name = v
                        setForm(f => ({ ...f, auth_persons: arr }))
                      }} placeholder="Full name" />
                      <InputField label="Designation" value={ap.designation} onChange={(v: string) => {
                        const arr = [...(form.auth_persons || [])] as any[]
                        arr[i].designation = v
                        setForm(f => ({ ...f, auth_persons: arr }))
                      }} placeholder="e.g. Sales Manager" />
                      <InputField label="Mobile" value={ap.mobile} onChange={(v: string) => {
                        const arr = [...(form.auth_persons || [])] as any[]
                        arr[i].mobile = v
                        setForm(f => ({ ...f, auth_persons: arr }))
                      }} placeholder="+91..." />
                      <InputField label="Email" value={ap.email} onChange={(v: string) => {
                        const arr = [...(form.auth_persons || [])] as any[]
                        arr[i].email = v
                        setForm(f => ({ ...f, auth_persons: arr }))
                      }} placeholder="email@..." />
                    </div>
                  </CardRow>
                ))}
              </div>
              <AddRowButton label="Add Authorised Person" onClick={() => setForm(f => ({ ...f, auth_persons: [...(f.auth_persons || []), { name: '', designation: '', mobile: '', email: '', is_active: true }] }))} />
            </div>
          )}

          {/* ── Brands ── */}
          {view === 'brands' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <SectionTitle title="Brand Mapping" />
                <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-[10px] font-black uppercase">
                  {(form.brands || []).length} Brands Mapped
                </span>
              </div>

              {/* Search-and-add */}
              <div ref={brandRef} className="relative">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
                    <input
                      type="text"
                      value={brandSearch}
                      onChange={e => { setBrandSearch(e.target.value); setShowBrandDrop(true) }}
                      onFocus={() => setShowBrandDrop(true)}
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
                      placeholder="Type brand name or code to search and add..."
                    />
                  </div>
                </div>

                {/* Dropdown */}
                {showBrandDrop && brandSuggestions.length > 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 overflow-hidden">
                    {brandSuggestions.map(b => (
                      <button
                        key={b.id}
                        onClick={() => addBrand(b)}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left border-b border-slate-50 last:border-0"
                      >
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-black text-blue-600">{b.name[0]}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-800 truncate">{b.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase">{b.code || 'No Code'}</p>
                        </div>
                        <i className="fas fa-plus text-blue-400 text-xs shrink-0"></i>
                      </button>
                    ))}
                  </div>
                )}
                {showBrandDrop && brandSearch.trim() && brandSuggestions.length === 0 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-4 text-center text-slate-400 text-sm italic">
                    No brands found for "{brandSearch}"
                  </div>
                )}
              </div>

              {/* Mapped brands as cards */}
              {(form.brands || []).length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {(form.brands || []).map((b: any, i: number) => (
                    <div key={b.brand_id ?? b} className="flex flex-col gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl relative group">
                      <div className="flex justify-between items-center pr-6">
                        <span className="font-bold text-slate-800 text-sm truncate">{b.brand_name || `Brand #${b.brand_id ?? b}`}</span>
                        <button onClick={() => removeBrand(b.brand_id ?? b)} className="absolute top-4 right-4 text-slate-300 hover:text-red-500 transition-colors">
                          <i className="fas fa-times"></i>
                        </button>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-500 uppercase">Credit Days</label>
                        <input
                          type="number"
                          value={b.credit_days ?? 0}
                          onChange={e => {
                            const arr = [...(form.brands || [])] as any[];
                            arr[i] = { ...arr[i], credit_days: Number(e.target.value) };
                            setForm(f => ({ ...f, brands: arr }));
                          }}
                          className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-slate-300">
                  <i className="fas fa-tags text-4xl mb-3 block"></i>
                  <p className="text-xs font-black uppercase tracking-widest">No brands mapped yet</p>
                  <p className="text-xs mt-1 italic">Search and add brands above</p>
                </div>
              )}
            </div>
          )}

          {/* ── Financial ── */}
          {view === 'financial' && (
            <div className="space-y-6">
              <SectionTitle title="Banking & Credit Terms" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <InputField label="Bank Name" value={(form.financial as any)?.bank_name} onChange={(v: string) => setForm(f => ({ ...f, financial: { ...(f.financial || {} as any), bank_name: v } }))} placeholder="HDFC Bank" />
                <InputField label="Account Number" value={(form.financial as any)?.account_no} onChange={(v: string) => setForm(f => ({ ...f, financial: { ...(f.financial || {} as any), account_no: v } }))} placeholder="50100..." />
                <InputField label="IFSC Code" value={(form.financial as any)?.ifsc_code} onChange={(v: string) => setForm(f => ({ ...f, financial: { ...(f.financial || {} as any), ifsc_code: v.toUpperCase() } }))} placeholder="HDFC0001234" />
                <InputField label="Branch Name" value={(form.financial as any)?.branch} onChange={(v: string) => setForm(f => ({ ...f, financial: { ...(f.financial || {} as any), branch: v } }))} placeholder="Connaught Place" />
                <InputField label="Credit Limit (₹)" type="number" value={(form.financial as any)?.credit_limit} onChange={(v: string) => setForm(f => ({ ...f, financial: { ...(f.financial || {} as any), credit_limit: Number(v) } }))} placeholder="0" />
                <InputField label="Credit Days" type="number" value={(form.financial as any)?.credit_days} onChange={(v: string) => setForm(f => ({ ...f, financial: { ...(f.financial || {} as any), credit_days: Number(v) } }))} placeholder="30" />
              </div>
            </div>
          )}

          {/* ── Documents ── */}
          {view === 'docs' && (
            <div className="space-y-5">
              <SectionTitle title="Legal & Compliance Documents" />
              <div className="space-y-4">
                {(form.documents || []).map((doc: any, i: number) => (
                  <CardRow key={i} onRemove={() => {
                    const arr = [...(form.documents || [])]
                    arr.splice(i, 1)
                    setForm(f => ({ ...f, documents: arr }))
                  }}>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <SelectField label="Document Type" value={doc.document_type} onChange={(v: string) => {
                        const arr = [...(form.documents || [])] as any[]
                        arr[i].document_type = v
                        setForm(f => ({ ...f, documents: arr }))
                      }} options={['GST Certificate', 'PAN Card', 'Trade License', 'FSSAI License', 'Drug License', 'Import Export Code', 'MSME Certificate', 'Other']} />
                      <InputField label="Start Date" type="date" value={doc.start_date} onChange={(v: string) => {
                        const arr = [...(form.documents || [])] as any[]
                        arr[i].start_date = v
                        setForm(f => ({ ...f, documents: arr }))
                      }} placeholder="" />
                      <InputField label="Expiry Date" type="date" value={doc.end_date} onChange={(v: string) => {
                        const arr = [...(form.documents || [])] as any[]
                        arr[i].end_date = v
                        setForm(f => ({ ...f, documents: arr }))
                      }} placeholder="" />
                    </div>
                    <div className="mt-4">
                      <InputField label="Notes / Reference No." value={doc.notes} onChange={(v: string) => {
                        const arr = [...(form.documents || [])] as any[]
                        arr[i].notes = v
                        setForm(f => ({ ...f, documents: arr }))
                      }} placeholder="Certificate number or remarks..." />
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
                              toast.loading('Uploading document...', { id: 'doc-up' })
                              const res = await suppliers_api.upload_file(fd)
                              const arr = [...(form.documents || [])] as any[]
                              arr[i].file_path = res.data.file_path
                              setForm(f => ({ ...f, documents: arr }))
                              toast.success('Document uploaded!', { id: 'doc-up' })
                            } catch (err: any) {
                              toast.error('Upload failed', { id: 'doc-up' })
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
              <AddRowButton label="Add Document" onClick={() => setForm(f => ({ ...f, documents: [...(f.documents || []), { document_type: 'GST Certificate', file_path: '', start_date: '', end_date: '', notes: '' }] }))} />
            </div>
          )}

          {/* ── Notes ── */}
          {view === 'notes' && (
            <div className="space-y-6">
              <SectionTitle title="Internal Notes" />
              <div className="space-y-1.5">
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">General Notes</label>
                <textarea
                  value={(form as any).notes || ''}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value } as any))}
                  rows={6}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm resize-none"
                  placeholder="Internal notes about this supplier — not visible on documents..."
                />
              </div>
              {(form.internal_notes || []).length > 0 && (
                <div className="space-y-3">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">System Log</p>
                  {(form.internal_notes as any[]).map((n, i) => (
                    <div key={i} className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl">
                      <p className="text-sm text-slate-700 font-medium">{n.note}</p>
                      <p className="text-[10px] text-slate-400 mt-1">{n.created_by_name} · {n.created_at ? new Date(n.created_at).toLocaleString() : ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
