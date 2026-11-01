import { matchesSearch } from '../../utils/search';
import { useEffect, useState } from 'react'
import { masters_api, type manufacturer_type, type sub_manufacturer_type } from '../../api/masters'
import PageHeader from '../../components/ui/PageHeader'
import StatusBadge from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'

export default function SubManufacturers({ searchQuery = '', onCountUpdate }: { searchQuery?: string, onCountUpdate?: (count: number) => void }) {
  const [items, set_items] = useState<sub_manufacturer_type[]>([])
  const [manufacturers, set_manufacturers] = useState<manufacturer_type[]>([])
  const [loading, set_loading] = useState(true)
  const [edit_id, set_edit_id] = useState<number | null>(null)
  
  const [name, set_name] = useState('')
  const [code, set_code] = useState('')
  const [manufacturer_id, set_manufacturer_id] = useState<string>('')
  const [is_active, set_is_active] = useState(true)
  const [saving, set_saving] = useState(false)

  async function load() {
    set_loading(true)
    try { 
      const [mans, subs] = await Promise.all([
        masters_api.get_manufacturers(),
        masters_api.get_sub_manufacturers()
      ])
      set_manufacturers(mans.data)
      set_items(subs.data) 
    }
    finally { set_loading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered_items = items.filter(item => 
    matchesSearch(searchQuery, item.name, item.code)
  )

  useEffect(() => {
    if (onCountUpdate) onCountUpdate(filtered_items.length)
  }, [filtered_items.length, onCountUpdate])

  function reset_form() {
    set_name('')
    set_code('')
    set_manufacturer_id('')
    set_is_active(true)
    set_edit_id(null)
  }

  function handle_edit(item: sub_manufacturer_type) {
    set_edit_id(item.id)
    set_name(item.name)
    set_code(item.code || '')
    set_manufacturer_id(item.manufacturer_id.toString())
    set_is_active(item.is_active)
  }

  async function handle_save() {
    if (!name.trim() || !manufacturer_id) {
      toast.error('Name and Manufacturer are required')
      return
    }
    set_saving(true)
    try {
      if (edit_id !== null) {
        await masters_api.update_sub_manufacturer(edit_id, { 
          name, 
          manufacturer_id: Number(manufacturer_id), 
          is_active 
        })
        toast.success('Sub-manufacturer updated')
      } else {
        await masters_api.create_sub_manufacturer({ 
          name, 
          code, 
          manufacturer_id: Number(manufacturer_id)
        })
        toast.success('Sub-manufacturer created')
      }
      reset_form()
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Error saving sub-manufacturer')
    } finally { set_saving(false) }
  }

   return (
    <div className="space-y-6">
      <PageHeader title="Sub-Manufacturer Master" subtitle="Manage sub-manufacturers linked to manufacturers" />

      {/* Creation/Edit Form Section */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 px-6 py-3 border-b border-slate-800 flex justify-between items-center">
          <h3 className="text-white font-black uppercase tracking-widest text-xs">
            {edit_id ? "Update Sub-manufacturer" : "Create New Sub-manufacturer"}
          </h3>
          {edit_id && (
            <button onClick={reset_form} className="text-slate-400 hover:text-white text-[10px] font-bold uppercase tracking-tighter transition-colors">
              <i className="fas fa-times mr-1"></i> Cancel Edit
            </button>
          )}
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            {/* 1. Parent Manufacturer */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Parent Manufacturer *</label>
              <select value={manufacturer_id} onChange={e => set_manufacturer_id(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm">
                <option value="">Select Manufacturer</option>
                {manufacturers.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>

            {/* 2. Sub-manufacturer Name */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Sub-manufacturer Name *</label>
              <input value={name} onChange={e => set_name(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder="e.g. Division A" />
            </div>

            {/* 3. Code */}
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Code (Optional)</label>
              <input value={code} onChange={e => set_code(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder="Manual Code" />
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
              {saving ? 'Processing…' : edit_id ? 'Update Sub-manufacturer' : 'Save Sub-manufacturer'}
            </button>
          </div>
        </div>
      </div>
      
      {/* List Table Section */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200">
          <h3 className="text-slate-600 font-black uppercase tracking-widest text-xs">Existing Sub-manufacturers</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-white uppercase tracking-wider text-[10px] font-black">
              <tr>
                <th className="px-6 py-4 text-center w-16 border-r border-slate-800">#</th>
                <th className="px-6 py-4 text-left w-24 border-r border-slate-800">Code</th>
                <th className="px-6 py-4 text-left border-r border-slate-800">Sub-manufacturer Name</th>
                <th className="px-6 py-4 text-left border-r border-slate-800">Parent Manufacturer</th>
                <th className="px-6 py-4 text-center w-32 border-r border-slate-800">Status</th>
                <th className="px-6 py-4 text-center w-24">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-20"><i className="fas fa-spinner fa-spin text-2xl text-orange-500"></i></td></tr>
              ) : filtered_items.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-20 text-slate-400 italic font-medium">
                  {searchQuery ? `No sub-manufacturers matching "${searchQuery}"` : "No sub-manufacturers found"}
                </td></tr>
              ) : filtered_items.map((c, i) => (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4 text-center text-slate-400 font-mono">{i + 1}</td>
                  <td className="px-6 py-4 font-mono font-bold text-blue-600">{c.code || '—'}</td>
                  <td className="px-6 py-4 font-bold text-slate-800">{c.name}</td>
                  <td className="px-6 py-4 text-slate-600 text-[11px] font-black uppercase">
                    {manufacturers.find(m => m.id === c.manufacturer_id)?.name || '—'}
                  </td>
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
