import { matchesSearch } from '../../utils/search';
import { useEffect, useState } from 'react'
import { masters_api, type gst_type } from '../../api/masters'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import StatusBadge from '../../components/ui/StatusBadge'

export default function gst_master_page({ searchQuery = '', onCountUpdate }: { searchQuery?: string, onCountUpdate?: (count: number) => void }) {
  const [items, set_items] = useState<gst_type[]>([])
  const [loading, set_loading] = useState(true)
  const [open, set_open] = useState(false)
  const [saving, set_saving] = useState(false)
  const [error, set_error] = useState('')
  const [form, set_form] = useState({ tax_name: '', gst_percent: '', cgst_pct: '', sgst_pct: '', igst_pct: '' })

  async function load() {
    set_loading(true)
    try { const res = await masters_api.get_gst(); set_items(res.data) }
    finally { set_loading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered_items = items.filter(item => 
    matchesSearch(searchQuery, item.tax_name, item.gst_percent)
  )

  useEffect(() => {
    if (onCountUpdate) onCountUpdate(filtered_items.length)
  }, [filtered_items.length, onCountUpdate])

  function auto_fill(gst: string) {
    const half = (Number(gst) / 2).toFixed(2)
    set_form(f => ({ ...f, gst_percent: gst, cgst_pct: half, sgst_pct: half, igst_pct: gst }))
  }

  async function handle_save() {
    set_saving(true); set_error('')
    try {
      await masters_api.create_gst({
        tax_name: form.tax_name,
        gst_percent: Number(form.gst_percent),
        cgst_pct: Number(form.cgst_pct),
        sgst_pct: Number(form.sgst_pct),
        igst_pct: Number(form.igst_pct),
      })
      set_form({ tax_name: '', gst_percent: '', cgst_pct: '', sgst_pct: '', igst_pct: '' })
      set_open(false); load()
    } catch (e: unknown) {
      set_error((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'error')
    } finally { set_saving(false) }
  }

   return (
    <div className="space-y-6">
      <PageHeader title="GST Master" subtitle="Tax rates used in invoices" />

      {/* Creation Form Section */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-900 px-6 py-3 border-b border-slate-800 flex justify-between items-center">
          <h3 className="text-white font-black uppercase tracking-widest text-xs">Add New Tax Rate</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-start">
            <div className="lg:col-span-2 space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">Tax Name *</label>
              <input value={form.tax_name} onChange={e => set_form(f => ({ ...f, tax_name: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder="e.g. GST 18%" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">GST % *</label>
              <input type="number" value={form.gst_percent} onChange={e => auto_fill(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all shadow-sm" placeholder="18" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">CGST %</label>
              <input value={form.cgst_pct} readOnly className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm font-mono font-bold text-slate-400" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest">SGST %</label>
              <input value={form.sgst_pct} readOnly className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 text-sm font-mono font-bold text-slate-400" />
            </div>
          </div>
          {error && <p className="text-xs text-red-500 font-bold mt-2 uppercase tracking-tight">{error}</p>}
          <div className="flex justify-end mt-6 pt-6 border-t border-slate-100">
            <button onClick={handle_save} disabled={saving} className="px-10 py-2.5 text-sm bg-orange-500 text-white rounded-lg font-black shadow-lg hover:bg-orange-600 transition-all disabled:opacity-50 uppercase tracking-widest">
              {saving ? 'Saving…' : 'Save Tax Rate'}
            </button>
          </div>
        </div>
      </div>

      {/* List Table Section */}
      <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200">
          <h3 className="text-slate-600 font-black uppercase tracking-widest text-xs">Existing Tax Rates</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-white uppercase tracking-wider text-[10px] font-black">
              <tr>
                <th className="px-6 py-4 text-left border-r border-slate-800">Tax Name</th>
                <th className="px-6 py-4 text-center border-r border-slate-800 w-24">GST%</th>
                <th className="px-6 py-4 text-center border-r border-slate-800 w-24">CGST%</th>
                <th className="px-6 py-4 text-center border-r border-slate-800 w-24">SGST%</th>
                <th className="px-6 py-4 text-center border-r border-slate-800 w-24">IGST%</th>
                <th className="px-6 py-4 text-center border-r border-slate-800 w-32">Status</th>
                <th className="px-6 py-4 text-center w-32">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7} className="text-center py-20"><i className="fas fa-spinner fa-spin text-2xl text-orange-500"></i></td></tr>
              ) : filtered_items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-20 text-slate-400 italic font-medium">
                  {searchQuery ? `No tax rates matching "${searchQuery}"` : "No tax rates found"}
                </td></tr>
              ) : filtered_items.map(g => (
                <tr key={g.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4 font-bold text-slate-800">{g.tax_name}</td>
                  <td className="px-6 py-4 text-center font-black text-orange-600">{g.gst_percent}%</td>
                  <td className="px-6 py-4 text-center text-slate-500 font-mono">{g.cgst_pct}%</td>
                  <td className="px-6 py-4 text-center text-slate-500 font-mono">{g.sgst_pct}%</td>
                  <td className="px-6 py-4 text-center text-slate-500 font-mono">{g.igst_pct}%</td>
                  <td className="px-6 py-4 text-center">
                    <StatusBadge active={g.is_active} />
                  </td>
                  <td className="px-6 py-4 text-center">
                    {g.is_active && (
                      <button onClick={() => masters_api.delete_gst(g.id).then(load)} className="text-[10px] font-black text-red-500 hover:text-red-700 uppercase tracking-widest border border-red-200 px-3 py-1 rounded hover:bg-red-50 transition-all">
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
