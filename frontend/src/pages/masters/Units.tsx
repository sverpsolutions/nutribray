import { matchesSearch } from '../../utils/search';
import { useEffect, useState } from 'react'
import { masters_api, type unit_type } from '../../api/masters'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import StatusBadge from '../../components/ui/StatusBadge'

export default function units_page({ searchQuery = '', onCountUpdate }: { searchQuery?: string, onCountUpdate?: (count: number) => void }) {
  const [items, set_items] = useState<unit_type[]>([])
  const [loading, set_loading] = useState(true)
  const [open, set_open] = useState(false)
  const [saving, set_saving] = useState(false)
  const [error, set_error] = useState('')
  const [form, set_form] = useState({ unit_code: '', unit_name: '', unit_type: 'Count' })

  async function load() {
    set_loading(true)
    try { const res = await masters_api.get_units(); set_items(res.data) }
    finally { set_loading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered_items = items.filter(item => 
    matchesSearch(searchQuery, item.unit_name, item.unit_code)
  )

  useEffect(() => {
    if (onCountUpdate) onCountUpdate(filtered_items.length)
  }, [filtered_items.length, onCountUpdate])

  async function handle_save() {
    set_saving(true); set_error('')
    try {
      await masters_api.create_unit(form)
      set_form({ unit_code: '', unit_name: '', unit_type: 'Count' }); set_open(false); load()
    } catch (e: unknown) {
      set_error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'error')
    } finally { set_saving(false) }
  }

   return (
    <div className="space-y-6">
      <PageHeader title="Units of Measure" subtitle="Manage product units" />

      {/* Creation Form Section */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 px-6 py-3 border-b border-slate-800 flex justify-between items-center">
          <h3 className="text-white font-black uppercase tracking-widest text-xs">Add New Unit</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Unit Code *</label>
              <input value={form.unit_code} onChange={e => set_form(f => ({ ...f, unit_code: e.target.value.toUpperCase() }))}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder="KG" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Unit Name *</label>
              <input value={form.unit_name} onChange={e => set_form(f => ({ ...f, unit_name: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder="Kilogram" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Type</label>
              <select value={form.unit_type} onChange={e => set_form(f => ({ ...f, unit_type: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm">
                {['Count', 'Weight', 'Volume', 'Length', 'Area'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {error && <p className="text-xs text-red-500 font-bold mt-2 uppercase tracking-tight">{error}</p>}
          <div className="flex justify-end mt-6 pt-6 border-t border-slate-100">
            <button onClick={handle_save} disabled={saving} className="px-10 py-2.5 text-sm bg-orange-500 text-white rounded-lg font-black shadow-lg hover:bg-orange-600 transition-all disabled:opacity-50 uppercase tracking-widest">
              {saving ? 'Saving…' : 'Save Unit'}
            </button>
          </div>
        </div>
      </div>

      {/* List Table Section */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200">
          <h3 className="text-slate-600 font-black uppercase tracking-widest text-xs">Existing Units</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-white uppercase tracking-wider text-[10px] font-black">
              <tr>
                <th className="px-6 py-4 text-center w-16 border-r border-slate-800">#</th>
                <th className="px-6 py-4 text-left w-24 border-r border-slate-800">Code</th>
                <th className="px-6 py-4 text-left border-r border-slate-800">Name</th>
                <th className="px-6 py-4 text-left border-r border-slate-800">Type</th>
                <th className="px-6 py-4 text-center w-32 border-r border-slate-800">Status</th>
                <th className="px-6 py-4 text-center w-32">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6} className="text-center py-20"><i className="fas fa-spinner fa-spin text-2xl text-orange-500"></i></td></tr>
              ) : filtered_items.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-20 text-slate-400 italic font-medium">
                  {searchQuery ? `No units matching "${searchQuery}"` : "No units found"}
                </td></tr>
              ) : filtered_items.map((u, i) => (
                <tr key={u.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4 text-center text-slate-400 font-mono">{i + 1}</td>
                  <td className="px-6 py-4 font-mono font-bold text-blue-600">{u.unit_code}</td>
                  <td className="px-6 py-4 font-bold text-slate-800">{u.unit_name}</td>
                  <td className="px-6 py-4 text-slate-500 font-black uppercase text-[11px] tracking-tight">{u.unit_type}</td>
                  <td className="px-6 py-4 text-center">
                    <StatusBadge active={u.is_active} />
                  </td>
                  <td className="px-6 py-4 text-center">
                    {u.is_active && (
                      <button onClick={() => masters_api.delete_unit(u.id).then(load)} className="text-[10px] font-black text-red-500 hover:text-red-700 uppercase tracking-widest border border-red-200 px-3 py-1 rounded hover:bg-red-50 transition-all">
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
