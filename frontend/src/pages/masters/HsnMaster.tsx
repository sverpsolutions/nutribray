import { matchesSearch } from '../../utils/search';
import { useEffect, useState } from 'react'
import { masters_api, type hsn_type } from '../../api/masters'
import PageHeader from '../../components/ui/PageHeader'
import StatusBadge from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'
import { useBrandingStore } from '../../store/brandingStore'

export default function HsnMaster({ searchQuery = '', onCountUpdate }: { searchQuery?: string, onCountUpdate?: (count: number) => void }) {
  const { settings } = useBrandingStore()
  const hsnLength = settings?.hsn_code_length || 8
  const sacLength = 6

  const [items, set_items] = useState<hsn_type[]>([])
  const [loading, set_loading] = useState(true)
  const [saving, set_saving] = useState(false)
  const [error, set_error] = useState('')
  const [form, set_form] = useState({ hsn_code: '', code_type: 'HSN', description: '', gst_percent: '', cgst_pct: '', sgst_pct: '', igst_pct: '' })
  const [filterType, setFilterType] = useState<'ALL' | 'HSN' | 'SAC'>('ALL')

  async function load() {
    set_loading(true)
    try {
      const res = await masters_api.get_hsn({ 
        per_page: 200, 
        code_type: filterType === 'ALL' ? undefined : filterType 
      })
      const hsn_data = (res.data as any).data ?? res.data;
      set_items(Array.isArray(hsn_data) ? hsn_data : []);
    }
    finally { set_loading(false) }
  }

  useEffect(() => { load() }, [filterType])

  const filtered_items = items.filter(item => {
    const matchesType = filterType === 'ALL' || item.code_type?.toUpperCase() === filterType
    const searchOk = matchesSearch(searchQuery, item.hsn_code, item.description)
    return matchesType && searchOk
  })

  useEffect(() => {
    if (onCountUpdate) onCountUpdate(filtered_items.length)
  }, [filtered_items.length, onCountUpdate])

  function auto_fill(gst: string) {
    const half = (Number(gst) / 2).toFixed(2)
    set_form(f => ({ ...f, gst_percent: gst, cgst_pct: half, sgst_pct: half, igst_pct: gst }))
  }

  async function handle_save() {
    const code = form.hsn_code.trim()
    if (!code) { toast.error('Code is required'); return }
    
    // Length validation
    if (form.code_type === 'HSN' && code.length !== hsnLength) {
        toast.error(`HSN code must be exactly ${hsnLength} digits`); return
    }
    if (form.code_type === 'SAC' && code.length !== sacLength) {
        toast.error(`SAC code must be exactly ${sacLength} digits`); return
    }

    set_saving(true); set_error('')
    console.log('API CALL: create_hsn', {
        hsn_code: code,
        code_type: form.code_type,
        gst_percent: Number(form.gst_percent)
    });
    try {
      await masters_api.create_hsn({
        hsn_code: code,
        code_type: form.code_type,
        description: form.description,
        gst_percent: Number(form.gst_percent),
        cgst_pct: Number(form.cgst_pct),
        sgst_pct: Number(form.sgst_pct),
        igst_pct: Number(form.igst_pct),
      })
      toast.success(`${form.code_type} Code added`)
      set_form({ hsn_code: '', code_type: form.code_type, description: '', gst_percent: '', cgst_pct: '', sgst_pct: '', igst_pct: '' })
      load()
    } catch (e: any) {
      set_error(e.response?.data?.detail || 'Error saving HSN')
    } finally { set_saving(false) }
  }

   return (
    <div className="space-y-6">
      <PageHeader title="HSN/SAC Master" subtitle="Harmonized System Nomenclature & Services Accounting Codes" />

      {/* Creation Form Section */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 px-6 py-3 border-b border-slate-800 flex justify-between items-center">
          <h3 className="text-white font-black uppercase tracking-widest text-xs">Add New {form.code_type} Code</h3>
          <div className="flex bg-slate-800 p-1 rounded-lg">
             <button 
                onClick={() => set_form(f => ({ ...f, code_type: 'HSN' }))}
                className={`px-4 py-1 text-[10px] font-black rounded-md transition-all ${form.code_type === 'HSN' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-white'}`}
             >HSN</button>
             <button 
                onClick={() => set_form(f => ({ ...f, code_type: 'SAC' }))}
                className={`px-4 py-1 text-[10px] font-black rounded-md transition-all ${form.code_type === 'SAC' ? 'bg-orange-500 text-white' : 'text-slate-400 hover:text-white'}`}
             >SAC</button>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">{form.code_type} Code *</label>
              <input value={form.hsn_code} onChange={e => set_form(f => ({ ...f, hsn_code: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder={`e.g. ${form.code_type === 'HSN' ? '0301' : '9954'}`} />
            </div>
            <div className="md:col-span-2 space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Description</label>
              <input value={form.description} onChange={e => set_form(f => ({ ...f, description: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder="Item description for invoice..." />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">GST % *</label>
              <input type="number" value={form.gst_percent} onChange={e => auto_fill(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder="18" />
            </div>
          </div>
          {error && <p className="text-xs text-red-500 font-bold mt-2 uppercase tracking-tight">{error}</p>}
          <div className="flex justify-end mt-6 pt-6 border-t border-slate-100">
            <button onClick={handle_save} disabled={saving} className="px-10 py-2.5 text-sm bg-orange-500 text-white rounded-lg font-black shadow-lg hover:bg-orange-600 transition-all disabled:opacity-50 uppercase tracking-widest">
              {saving ? 'Saving…' : `Save ${form.code_type}`}
            </button>
          </div>
        </div>
      </div>

      {/* List Table Section */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex justify-between items-center">
          <h3 className="text-slate-600 font-black uppercase tracking-widest text-xs">Existing Records</h3>
          <div className="flex bg-slate-200 p-1 rounded-lg scale-90">
             {(['ALL', 'HSN', 'SAC'] as const).map(type => (
               <button 
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`px-4 py-1 text-[9px] font-black rounded-md transition-all ${filterType === type ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:text-slate-700'}`}
               >{type}</button>
             ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-white uppercase tracking-wider text-[10px] font-black">
              <tr>
                <th className="px-6 py-4 text-center border-r border-slate-800 w-20">Type</th>
                <th className="px-6 py-4 text-left border-r border-slate-800">Code</th>
                <th className="px-6 py-4 text-left border-r border-slate-800">Description</th>
                <th className="px-6 py-4 text-center border-r border-slate-800 w-24">GST%</th>
                <th className="px-6 py-4 text-center border-r border-slate-800 w-32">Status</th>
                <th className="px-6 py-4 text-center w-32">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-20"><i className="fas fa-spinner fa-spin text-2xl text-orange-500"></i></td></tr>
              ) : filtered_items.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-20 text-slate-400 italic font-medium">
                  {searchQuery ? `No records matching "${searchQuery}"` : "No records found"}
                </td></tr>
              ) : filtered_items.map(h => (
                <tr key={h.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4 text-center">
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${h.code_type?.toUpperCase() === 'SAC' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {h.code_type || 'HSN'}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono font-bold text-blue-600">{h.hsn_code}</td>
                  <td className="px-6 py-4 text-slate-600 max-w-xs truncate font-medium">{h.description || '—'}</td>
                  <td className="px-6 py-4 text-center font-black text-orange-600">{h.gst_percent}%</td>
                  <td className="px-6 py-4 text-center">
                    <StatusBadge active={h.is_active} />
                  </td>
                  <td className="px-6 py-4 text-center">
                    {h.is_active && (
                      <button onClick={() => masters_api.delete_hsn(h.id).then(load)} className="text-[10px] font-black text-red-500 hover:text-red-700 uppercase tracking-widest border border-red-200 px-3 py-1 rounded hover:bg-red-50 transition-all">
                        Deactivate
                      </button>
                    )}
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
