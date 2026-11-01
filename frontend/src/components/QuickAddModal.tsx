import { useState } from 'react'
import { masters_api } from '../api/masters'
import toast from 'react-hot-toast'

export type QuickAddType =
  | 'group'
  | 'subgroup'
  | 'category'
  | 'subcategory'
  | 'brand'
  | 'subbrand'
  | 'variant'
  | 'flavour'
  | 'classification'
  | 'manufacturer'

export interface QuickAddConfig {
  type: QuickAddType
  label: string
  /** parent id — meaning depends on type:
   *  subgroup    → group_id
   *  category    → subgroup_id
   *  subcategory → category_id
   *  subbrand    → brand_id (parent_id2 = subcategory_id)
   */
  parent_id?: number
  parent_id2?: number       // subbrand: subcategory_id
  parent_label?: string     // display name of the parent (e.g. group name)
  parent_label2?: string    // display name of parent_id2 (e.g. sub-category name for subbrand)
}

interface Props extends QuickAddConfig {
  onSuccess: (id: number, name: string) => void
  onClose: () => void
}

/** Which types REQUIRE a parent before saving */
const REQUIRES_PARENT: Partial<Record<QuickAddType, string>> = {
  subgroup:    'Item Group',
  category:    'Item Sub Group',
  subcategory: 'Category',
  subbrand:    'Brand + Sub Category',
}

const TYPE_ICONS: Record<QuickAddType, string> = {
  group: 'fa-layer-group',
  subgroup: 'fa-sitemap',
  category: 'fa-tags',
  subcategory: 'fa-tag',
  brand: 'fa-trademark',
  subbrand: 'fa-copyright',
  variant: 'fa-palette',
  flavour: 'fa-candy-cane',
  classification: 'fa-list-alt',
  manufacturer: 'fa-industry',
}

const TYPE_COLORS: Record<QuickAddType, string> = {
  group: 'blue',
  subgroup: 'indigo',
  category: 'violet',
  subcategory: 'purple',
  brand: 'emerald',
  subbrand: 'teal',
  variant: 'amber',
  flavour: 'rose',
  classification: 'slate',
  manufacturer: 'orange',
}

const COLOR_MAP: Record<string, { header: string; ring: string; btn: string; link_bg: string; link_border: string; link_text: string }> = {
  blue:   { header: 'from-blue-600 to-blue-700',     ring: 'focus:ring-blue-400',   btn: 'bg-blue-600 hover:bg-blue-700',     link_bg: 'bg-blue-50',   link_border: 'border-blue-200',   link_text: 'text-blue-700' },
  indigo: { header: 'from-indigo-600 to-indigo-700', ring: 'focus:ring-indigo-400', btn: 'bg-indigo-600 hover:bg-indigo-700', link_bg: 'bg-indigo-50', link_border: 'border-indigo-200', link_text: 'text-indigo-700' },
  violet: { header: 'from-violet-600 to-violet-700', ring: 'focus:ring-violet-400', btn: 'bg-violet-600 hover:bg-violet-700', link_bg: 'bg-violet-50', link_border: 'border-violet-200', link_text: 'text-violet-700' },
  purple: { header: 'from-purple-600 to-purple-700', ring: 'focus:ring-purple-400', btn: 'bg-purple-600 hover:bg-purple-700', link_bg: 'bg-purple-50', link_border: 'border-purple-200', link_text: 'text-purple-700' },
  emerald:{ header: 'from-emerald-600 to-emerald-700',ring:'focus:ring-emerald-400',btn: 'bg-emerald-600 hover:bg-emerald-700',link_bg:'bg-emerald-50',link_border:'border-emerald-200',link_text:'text-emerald-700'},
  teal:   { header: 'from-teal-600 to-teal-700',     ring: 'focus:ring-teal-400',   btn: 'bg-teal-600 hover:bg-teal-700',     link_bg: 'bg-teal-50',   link_border: 'border-teal-200',   link_text: 'text-teal-700' },
  amber:  { header: 'from-amber-500 to-amber-600',   ring: 'focus:ring-amber-400',  btn: 'bg-amber-500 hover:bg-amber-600',   link_bg: 'bg-amber-50',  link_border: 'border-amber-200',  link_text: 'text-amber-700' },
  rose:   { header: 'from-rose-500 to-rose-600',     ring: 'focus:ring-rose-400',   btn: 'bg-rose-500 hover:bg-rose-600',     link_bg: 'bg-rose-50',   link_border: 'border-rose-200',   link_text: 'text-rose-700' },
  slate:  { header: 'from-slate-600 to-slate-700',   ring: 'focus:ring-slate-400',  btn: 'bg-slate-600 hover:bg-slate-700',   link_bg: 'bg-slate-50',  link_border: 'border-slate-200',  link_text: 'text-slate-700' },
  orange: { header: 'from-orange-500 to-orange-600', ring: 'focus:ring-orange-400', btn: 'bg-orange-500 hover:bg-orange-600', link_bg: 'bg-orange-50', link_border: 'border-orange-200', link_text: 'text-orange-700' },
}

async function create_master(
  type: QuickAddType,
  name: string,
  code: string,
  parent_id?: number,
  parent_id2?: number,
): Promise<{ id: number; name: string }> {
  const trim = (s: string) => s.trim() || undefined
  switch (type) {
    case 'group':
      return (await masters_api.create_item_group({ name, code: trim(code) })).data
    case 'subgroup':
      if (!parent_id) throw new Error('Select an Item Group first')
      return (await masters_api.create_item_subgroup({ group_id: parent_id, name, code: trim(code) })).data
    case 'category':
      if (!parent_id) throw new Error('Select an Item Sub Group first')
      return (await masters_api.create_item_category({ subgroup_id: parent_id, name, code: trim(code) })).data
    case 'subcategory':
      if (!parent_id) throw new Error('Select a Category first')
      return (await masters_api.create_item_subcategory({ category_id: parent_id, name, code: trim(code) })).data
    case 'brand':
      return (await masters_api.create_brand({ name, code: trim(code) })).data
    case 'subbrand':
      if (!parent_id) throw new Error('Select a Brand first')
      if (!parent_id2) throw new Error('Select a Sub Category first')
      return (await masters_api.create_sub_brand({ name, brand_id: parent_id, subcategory_id: parent_id2, code: trim(code) })).data
    case 'variant':
      return (await masters_api.create_variant({ name, code: trim(code) })).data
    case 'flavour':
      return (await masters_api.create_flavour({ name, code: trim(code) })).data
    case 'classification':
      return (await masters_api.create_product_classification({ name })).data
    case 'manufacturer':
      return (await masters_api.create_manufacturer({ name, code: trim(code) })).data
    default:
      throw new Error('Unknown type')
  }
}

export default function QuickAddModal({
  type, label, parent_id, parent_id2, parent_label, parent_label2, onSuccess, onClose
}: Props) {
  const [name, set_name] = useState('')
  const [code, set_code] = useState('')
  const [saving, set_saving] = useState(false)

  const color = TYPE_COLORS[type]
  const icon  = TYPE_ICONS[type]
  const c     = COLOR_MAP[color] || COLOR_MAP.blue

  const required_parent = REQUIRES_PARENT[type]

  // For subbrand, need BOTH parent_id and parent_id2
  const parent_missing =
    required_parent &&
    (type === 'subbrand' ? (!parent_id || !parent_id2) : !parent_id)

  async function handle_save() {
    if (!name.trim()) { toast.error('Name is required'); return }
    if (parent_missing) {
      toast.error(`Select ${required_parent} in the form before adding here`)
      return
    }
    set_saving(true)
    try {
      const result = await create_master(type, name.trim(), code, parent_id, parent_id2)
      toast.success(`${label} "${result.name}" created successfully!`)
      onSuccess(result.id, result.name)
      onClose()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.message || 'Failed to create')
    } finally {
      set_saving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal card */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-150">

        {/* Header */}
        <div className={`bg-gradient-to-r ${c.header} px-5 py-4 flex items-center gap-3`}>
          <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <i className={`fas ${icon} text-white text-sm`}></i>
          </div>
          <div>
            <div className="text-white font-black text-sm tracking-wide">Quick Add</div>
            <div className="text-white/80 text-xs font-semibold">{label}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center text-white text-sm transition-colors"
          >
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">

          {/* ── Parent link indicator ── */}
          {required_parent && (
            <div className={`rounded-xl border px-3 py-2.5 ${parent_missing ? 'bg-red-50 border-red-200' : `${c.link_bg} ${c.link_border}`}`}>
              {parent_missing ? (
                <div className="flex items-start gap-2 text-xs text-red-700">
                  <i className="fas fa-exclamation-circle mt-0.5 text-red-500 shrink-0"></i>
                  <div>
                    <span className="font-black">Parent not selected!</span>
                    <div className="mt-0.5 text-red-500 font-medium">
                      Close this modal → select <b>{required_parent}</b> from the form → then click <b>+</b> again.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs">
                  <i className={`fas fa-link ${c.link_text} shrink-0`}></i>
                  <div>
                    <span className="text-slate-500 font-semibold">Linked to {required_parent}:</span>
                    <span className={`ml-1.5 font-black ${c.link_text}`}>{parent_label ?? `ID ${parent_id}`}</span>
                    {type === 'subbrand' && parent_label2 && (
                      <span className="ml-2 text-slate-400 font-medium">
                        · Sub Cat: <span className={`font-black ${c.link_text}`}>{parent_label2}</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Name input */}
          <div>
            <label className="block text-[11px] font-black text-slate-600 uppercase tracking-wider mb-1.5">
              {label} Name <span className="text-rose-500">*</span>
            </label>
            <input
              autoFocus
              disabled={!!parent_missing}
              value={name}
              onChange={e => set_name(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !parent_missing && handle_save()}
              placeholder={parent_missing ? 'Select parent first…' : `Enter ${label.toLowerCase()} name…`}
              className={`w-full px-4 py-2.5 border rounded-xl text-sm transition-all outline-none focus:ring-2 ${c.ring} ${parent_missing ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white focus:border-transparent'}`}
            />
          </div>

          {/* Code (optional) */}
          {type !== 'classification' && (
            <div>
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Short Code <span className="text-slate-400 normal-case font-normal">(optional)</span>
              </label>
              <input
                disabled={!!parent_missing}
                value={code}
                onChange={e => set_code(e.target.value.toUpperCase())}
                placeholder="e.g. GRP01"
                className={`w-full px-4 py-2.5 border rounded-xl text-sm font-mono transition-all outline-none focus:ring-2 focus:ring-slate-300 ${parent_missing ? 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed' : 'border-slate-200 bg-white'}`}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handle_save}
            disabled={saving || !name.trim() || !!parent_missing}
            title={parent_missing ? `Select ${required_parent} first` : ''}
            className={`px-5 py-2 text-xs font-black text-white ${c.btn} rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2`}
          >
            {saving
              ? <><i className="fas fa-spinner fa-spin"></i> Saving…</>
              : <><i className="fas fa-plus"></i> Create {label}</>
            }
          </button>
        </div>
      </div>
    </div>
  )
}
