import { matchesSearch } from '../../utils/search';
import { useEffect, useState } from 'react'
import { masters_api, type item_group_type } from '../../api/masters'
import PageHeader from '../../components/ui/PageHeader'
import StatusBadge from '../../components/ui/StatusBadge'
import toast from 'react-hot-toast'

export default function ItemGroupsPage({ searchQuery = '', onCountUpdate }: { searchQuery?: string, onCountUpdate?: (count: number) => void }) {
  const [items, set_items] = useState<item_group_type[]>([])
  const [loading, set_loading] = useState(true)
  const [edit_id, set_edit_id] = useState<number | null>(null)
  
  const [name, set_name] = useState('')
  const [code, set_code] = useState('')
  const [short_name, set_short_name] = useState('')
  const [is_active, set_is_active] = useState(true)
  const [saving, set_saving] = useState(false)

  async function load() {
    set_loading(true)
    try { 
      const res = await masters_api.get_item_groups()
      set_items(res.data) 
    } catch (e) {
      toast.error('Failed to load item groups')
    } finally { 
      set_loading(false) 
    }
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
    set_short_name('')
    set_is_active(true)
    set_edit_id(null)
  }

  function handle_edit(item: item_group_type) {
    set_edit_id(item.id)
    set_name(item.name)
    set_code(item.code || '')
    set_short_name(item.short_name || '')
    set_is_active(item.is_active)
  }

  async function handle_save() {
    if (!name.trim()) return toast.error('Group Name is required')
    if (!short_name.trim()) return toast.error('Short Name is required')
    
    set_saving(true)
    try {
      if (edit_id !== null) {
        await masters_api.update_item_group(edit_id, { name, short_name, is_active })
        toast.success('Group updated')
      } else {
        await masters_api.create_item_group({ name, code, short_name })
        toast.success('Group created')
      }
      reset_form()
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.detail || 'Error saving group')
    } finally { 
      set_saving(false) 
    }
  }

  const tabs = [
    { label: 'ITEM MASTER', active: false },
    { label: 'ADD NEW ITEM', active: false },
    { label: 'ITEM GROUPS', active: true },
    { label: 'VARIANTS', active: false },
    { label: 'BRANDS', active: false },
  ]

  return (
    <div className="flex flex-col h-full bg-app-bg">
      {/* ── TAB BAR ─────────────────────────────────────── */}
      <div className="tab-bar">
        {tabs.map(tab => (
          <div key={tab.label} className={`tab-item ${tab.active ? 'active' : ''}`}>
            {tab.label}
          </div>
        ))}
      </div>

      {/* ── PAGE HEADER ──────────────────────────────────── */}
      <PageHeader 
        title="Item Groups" 
        subtitle="Manage high-level product groups" 
      />

      <div className="p-6 space-y-6">
        {/* ── CREATE/EDIT FORM ───────────────────────────── */}
        <div className="bg-white border border-border rounded-fiori overflow-hidden">
          <div className="section-bar">
            <span>{edit_id ? "UPDATE GROUP" : "CREATE NEW GROUP"}</span>
            {edit_id && (
              <button onClick={reset_form} className="text-text-muted hover:text-white text-[10px] font-bold uppercase transition-colors">
                CANCEL EDIT
              </button>
            )}
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Code (Auto) */}
              <div>
                <label className="form-label">CODE (AUTO)</label>
                <input 
                  value={code} 
                  disabled 
                  className="form-input font-mono" 
                  placeholder="Auto-generated" 
                />
              </div>

              {/* Group Name */}
              <div>
                <label className="form-label">GROUP NAME *</label>
                <input 
                  value={name} 
                  onChange={e => set_name(e.target.value)}
                  className="form-input" 
                  placeholder="e.g. Beverages" 
                />
                <span className="form-helper">Enter the main product group name</span>
              </div>

              {/* Short Name */}
              <div>
                <label className="form-label">SHORT NAME *</label>
                <input 
                  value={short_name} 
                  onChange={e => set_short_name(e.target.value.toUpperCase())}
                  className="form-input" 
                  placeholder="BEV" 
                />
                <span className="form-helper">3–4 letter code (e.g. BEV)</span>
              </div>
            </div>

            <div className="flex items-center justify-between mt-6 pt-5 border-t border-border">
              <div className="flex items-center gap-4">
                <label className="form-label m-0">GROUP STATUS</label>
                <button 
                  onClick={() => set_is_active(!is_active)} 
                  className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors focus:outline-none ${is_active ? 'bg-primary' : 'bg-border'}`}
                >
                  <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className={`text-[11px] font-semibold uppercase ${is_active ? 'text-status-active-text' : 'text-text-muted'}`}>
                  {is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <button 
                onClick={handle_save} 
                disabled={saving} 
                className="btn btn-accent px-8"
              >
                {saving ? 'PROCESSING…' : edit_id ? 'UPDATE GROUP' : 'SAVE GROUP'}
              </button>
            </div>
          </div>
        </div>
        
        {/* ── LIST TABLE ─────────────────────────────────── */}
        <div className="bg-white border border-border rounded-fiori overflow-hidden">
          <div className="section-bar bg-slate-100 text-text-primary border-b border-border">
            <span>EXISTING ITEM GROUPS</span>
          </div>
          <div className="overflow-x-auto">
            <table className="ent-table">
              <thead>
                <tr>
                  <th className="w-12 text-center">#</th>
                  <th className="w-24">CODE</th>
                  <th>GROUP NAME</th>
                  <th className="w-32">SHORT NAME</th>
                  <th className="w-32">CREATED BY</th>
                  <th className="w-32 text-center">STATUS</th>
                  <th className="w-24 text-center">ACTION</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12">
                      <i className="fas fa-spinner fa-spin text-primary"></i>
                    </td>
                  </tr>
                ) : filtered_items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-12 text-text-muted italic">
                      {searchQuery ? `No groups matching "${searchQuery}"` : "No groups found"}
                    </td>
                  </tr>
                ) : filtered_items.map((c: any, i) => (
                  <tr key={c.id}>
                    <td className="text-center text-text-muted font-mono">{i + 1}</td>
                    <td className="font-mono font-medium text-text-link">{c.code || '—'}</td>
                    <td className="font-medium">{c.name}</td>
                    <td className="font-mono uppercase text-text-secondary">{c.short_name || '—'}</td>
                    <td className="text-text-secondary text-[11px]">{c.created_by_name || 'SYSTEM'}</td>
                    <td className="text-center">
                      <StatusBadge active={c.is_active} />
                    </td>
                    <td className="text-center">
                      <button 
                        onClick={() => handle_edit(c)} 
                        className="text-text-muted hover:text-accent transition-colors"
                      >
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
    </div>
  )
}
