import { matchesSearch } from '../../utils/search';
import { useEffect, useState } from 'react'
import { masters_api, type item_category_type, type item_subcategory_type, type hsn_type } from '../../api/masters'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import StatusBadge from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'

export default function item_subcategories_page({ searchQuery = '', onCountUpdate }: { searchQuery?: string, onCountUpdate?: (count: number) => void }) {
  const [items, set_items] = useState<item_subcategory_type[]>([])
  const [categories, set_categories] = useState<item_category_type[]>([])
  const [loading, set_loading] = useState(true)
  const [open, set_open] = useState(false)
  const [edit_id, set_edit_id] = useState<number | null>(null)
  
  const [name, set_name] = useState('')
  const [code, set_code] = useState('')
  const [short_name, set_short_name] = useState('')
  const [category_id, set_category_id] = useState<string>('')
  const [default_hsn_id, set_default_hsn_id] = useState<number | null>(null)
  const [hsnSearch, setHsnSearch] = useState('')
  const [hsnResults, setHsnResults] = useState<hsn_type[]>([])
  const [searchingHsn, setSearchingHsn] = useState(false)
  const [hsnIdx, setHsnIdx] = useState(-1)
  const [is_active, set_is_active] = useState(true)
  const [saving, set_saving] = useState(false)

  async function load() {
    set_loading(true)
    try { 
      const [cats, subcats] = await Promise.all([
        masters_api.get_item_categories(),
        masters_api.get_item_subcategories()
      ])
      set_categories(cats.data)
      set_items(subcats.data) 
    }
    finally { set_loading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered_items = items.filter(item => 
    matchesSearch(searchQuery, item.name, item.code, (item as any).category_name)
  )

  useEffect(() => {
    if (onCountUpdate) onCountUpdate(filtered_items.length)
  }, [filtered_items.length, onCountUpdate])

  function reset_form() {
    set_name('')
    set_code('')
    set_short_name('')
    set_category_id('')
    set_default_hsn_id(null)
    setHsnSearch('')
    setHsnResults([])
    set_is_active(true)
    set_edit_id(null)
  }

  function handle_add_new() {
    reset_form()
    set_open(true)
  }

  function handle_edit(item: item_subcategory_type) {
    set_edit_id(item.id)
    set_name(item.name)
    set_code(item.code || '')
    set_short_name(item.short_name || '')
    set_category_id(item.category_id.toString())
    set_default_hsn_id(item.default_hsn_id || null)
    setHsnSearch((item as any).hsn_code || '')
    set_is_active(item.is_active)
    set_open(true)
  }

  async function handle_save() {
    if (!name.trim() || !category_id) {
      toast.error('Name and Category are required')
      return
    }
    set_saving(true)
    try {
      const payload: any = { 
        name, 
        short_name, 
        category_id: Number(category_id), 
        is_active 
      }
      if (default_hsn_id && Number(default_hsn_id) > 0) {
        payload.default_hsn_id = Number(default_hsn_id)
      }
      
      console.log('Saving subcategory payload:', payload)

      if (edit_id !== null) {
        await masters_api.update_item_subcategory(edit_id, payload)
        toast.success('Subcategory updated')
      } else {
        await masters_api.create_item_subcategory({ ...payload, code })
        toast.success('Subcategory created')
      }
      reset_form()
      set_open(false)
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Error saving subcategory')
    } finally { set_saving(false) }
  }

  const handleHsnSearch = async (val: string) => {
    setHsnIdx(-1)
    setHsnSearch(val)
    if (val.trim().length < 2) { setHsnResults([]); return; }
    setSearchingHsn(true)
    try {
      const res = await masters_api.get_hsn({ search: val.trim(), per_page: 10 })
      const data = (res.data as any).data ?? res.data
      setHsnResults(Array.isArray(data) ? data : [])
    } catch { setHsnResults([]) }
    finally { setSearchingHsn(false) }
  }

  const selectHsnItem = (h: hsn_type) => {
    set_default_hsn_id(h.id)
    setHsnSearch(h.hsn_code)
    setHsnResults([])
    setHsnIdx(-1)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Item Sub-Categories" subtitle="Manage sub-categories linked to categories" />

      {/* Creation/Edit Form Section */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 px-6 py-3 border-b border-slate-800 flex justify-between items-center">
          <h3 className="text-white font-black uppercase tracking-widest text-xs">
            {edit_id ? "Update Subcategory" : "Create New Subcategory"}
          </h3>
          {edit_id && (
            <button onClick={reset_form} className="text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-tighter transition-colors">
              <i className="fas fa-times mr-1"></i> Cancel Edit
            </button>
          )}
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
            {/* 1. Code (Auto) */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Code (Auto)</label>
              <input value={code} disabled={true}
                className="w-full border border-slate-200 bg-slate-50 rounded-lg px-4 py-2 text-sm font-mono font-bold text-slate-400 cursor-not-allowed" placeholder="Auto-generated" />
            </div>

            {/* 2. Parent Category */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Parent Category *</label>
              <select value={category_id} onChange={e => set_category_id(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm">
                <option value="">Select Category</option>
                {categories.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>

            {/* 3. Subcategory Name */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Subcategory Name *</label>
              <input value={name} onChange={e => set_name(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder="e.g. Rohu" />
            </div>

            {/* 4. Short Name */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Short Name *</label>
              <input value={short_name} onChange={e => set_short_name(e.target.value.toUpperCase())}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder="ROH" />
            </div>

            {/* 5. Default HSN Mapping */}
            <div className="space-y-1.5 relative md:col-span-2">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Default HSN Mapping</label>
              <div className="relative">
                <input 
                  value={hsnSearch} 
                  onChange={e => handleHsnSearch(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm pr-10" 
                  placeholder="Search HSN Code..." 
                />
                <i className="fas fa-search absolute right-3 top-1/2 -translate-y-1/2 text-slate-300"></i>
                
                {hsnResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-2xl z-50 max-h-60 overflow-y-auto custom-scrollbar">
                    {hsnResults.map((h, i) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => selectHsnItem(h)}
                        className={`w-full text-left px-4 py-3 transition-colors border-b border-slate-50 last:border-0 hover:bg-orange-50`}
                      >
                        <div className="flex justify-between items-center gap-2">
                          <span className="font-mono font-bold text-orange-600 text-sm">{h.hsn_code}</span>
                          <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-[10px] font-black">{h.gst_percent}%</span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-1 truncate">{h.description || 'No description'}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {default_hsn_id && (
                <p className="text-[10px] text-green-600 font-bold uppercase mt-1 flex items-center gap-1">
                  <i className="fas fa-check-circle"></i> Mapping active
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between mt-6 pt-6 border-t border-slate-100">
            <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-lg border border-slate-100">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest cursor-pointer" htmlFor="status-toggle">Status</label>
              <button id="status-toggle" onClick={() => set_is_active(!is_active)} className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${is_active ? 'bg-green-500' : 'bg-slate-300'}`}>
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${is_active ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
              <span className={`text-[10px] font-black uppercase tracking-widest ${is_active ? 'text-green-600' : 'text-slate-400'}`}>
                {is_active ? 'Active' : 'Inactive'}
              </span>
            </div>

            <button onClick={handle_save} disabled={saving} className="px-10 py-2.5 text-sm bg-orange-500 text-white rounded-lg font-black shadow-lg hover:bg-orange-600 transition-all disabled:opacity-50 uppercase tracking-widest">
              {saving ? 'Processing…' : edit_id ? 'Update Subcategory' : 'Save Subcategory'}
            </button>
          </div>
        </div>
      </div>
      
      {/* List Table Section */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200">
          <h3 className="text-slate-600 font-black uppercase tracking-widest text-xs">Existing Subcategories</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-white uppercase tracking-wider text-[10px] font-black">
              <tr>
                <th className="px-6 py-4 text-center w-16 border-r border-slate-800">#</th>
                <th className="px-6 py-4 text-left w-24 border-r border-slate-800">Code</th>
                <th className="px-6 py-4 text-left border-r border-slate-800">Parent Category</th>
                <th className="px-6 py-4 text-left border-r border-slate-800">Subcategory Name</th>
                <th className="px-6 py-4 text-left w-32 border-r border-slate-800">Default HSN</th>
                <th className="px-6 py-4 text-left w-32 border-r border-slate-800">Short Name</th>
                <th className="px-6 py-4 text-left w-32 border-r border-slate-800">Created By</th>
                <th className="px-6 py-4 text-center w-32 border-r border-slate-800">Status</th>
                <th className="px-6 py-4 text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={8} className="text-center py-20"><i className="fas fa-spinner fa-spin text-2xl text-orange-500"></i></td></tr>
              ) : filtered_items.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-20 text-slate-400 italic font-medium">
                  {searchQuery ? `No sub-categories matching "${searchQuery}"` : "No sub-categories found"}
                </td></tr>
              ) : filtered_items.map((c: any, i) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4 text-center text-slate-400 font-mono">{i + 1}</td>
                  <td className="px-6 py-4 font-mono font-bold text-blue-600">{c.code || '—'}</td>
                  <td className="px-6 py-4 text-slate-600 text-[11px] font-black uppercase">{c.category_name || '—'}</td>
                  <td className="px-6 py-4 font-bold text-slate-800">{c.name}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col">
                      <span className="font-mono font-bold text-orange-600">{c.hsn_code || '—'}</span>
                      {c.hsn_code && <span className="text-[10px] text-slate-400 font-bold uppercase">{c.hsn_description?.slice(0, 20)}...</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-500 font-black uppercase text-[11px] tracking-tight">{c.short_name || '—'}</td>
                  <td className="px-6 py-4 text-slate-400 text-[10px] font-bold uppercase tracking-tight">{c.created_by_name || 'System'}</td>
                  <td className="px-6 py-4 text-center">
                    <StatusBadge active={c.is_active} />
                  </td>
                  <td className="px-6 py-4 text-center">
                    <button onClick={() => handle_edit(c)} className="p-2 text-slate-400 hover:text-orange-500 transition-colors rounded-lg hover:bg-orange-50">
                      <i className="fas fa-edit"></i>
                    </button>
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
