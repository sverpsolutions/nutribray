// Administration → User Management: users, their outlets / categories / groups and module / report permissions.
// Everything shown here is enforced by the server (core/access.py); the screen only edits it.
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { access_api, type access_catalog, type access_form, type access_user_row } from '../../api/access'
import { useAuthStore } from '../../store/authStore'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import UsersClassic from './UsersClassic'

const errMsg = (e: any): string => {
  const d = e?.response?.data?.detail
  if (typeof d !== 'string') return e?.message || 'Something went wrong'
  const msgs = [...d.matchAll(/'msg': ["'](?:Value error, )?(.*?)["'], 'input'/g)].map(m => m[1])
  return msgs.length ? msgs.join(' • ') : d
}
const dt = (v: string | null) => v ? new Date(v).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const ADMIN = ['admin', 'superadmin']
const EMPTY: access_form = {
  name: '', username: '', password: '', email: null, mobile: null, employee_code: null, department: null, designation: null,
  role: 'staff', outlet_id: null, status: true, valid_from: null, valid_until: null,
  all_outlets: false, outlet_ids: [], all_categories: false, category_ids: [], group_ids: [], permissions: [], mfg_store_ids: [],
}
const STEPS = ['Basic information', 'Outlets', 'Categories', 'Groups', 'Module permissions', 'Report permissions', 'Review & save'] as const

export default function UserManagement() {
  const [tab, setTab] = useState<'users' | 'roles' | 'audit' | 'classic'>('users')
  const [cat, setCat] = useState<access_catalog | null>(null)
  useEffect(() => { access_api.catalog().then(r => setCat(r.data)).catch(e => toast.error(errMsg(e))) }, [])
  const isAdmin = ADMIN.includes(useAuthStore(s => (s.user as any)?.role) || '')

  return (
    <div className="space-y-4">
      <PageHeader title="User Management" subtitle="Who can log in, at which outlets, for which categories and groups, and what they may do in each module" />
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {([['users', 'Users', 'fa-users'], ['roles', 'Role templates', 'fa-user-shield'], ['audit', 'Permission audit', 'fa-history'],
           ['classic', 'Locations & dashboards', 'fa-store']] as const).filter(([k]) => isAdmin || (k !== 'roles' && k !== 'audit')).map(([k, l, i]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px whitespace-nowrap ${tab === k ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
            <i className={`fas ${i} mr-2`} />{l}</button>))}
      </div>
      {!cat ? <div className="text-text-muted py-10 text-center">Loading…</div> : <>
        {tab === 'users' && <Users cat={cat} />}
        {tab === 'roles' && <RoleTemplates cat={cat} />}
        {tab === 'audit' && <Audit />}
      </>}
      {tab === 'classic' && <UsersClassic />}
    </div>
  )
}

// ── users list + editor ─────────────────────────────────────────────────────

function Users({ cat }: { cat: access_catalog }) {
  const [rows, setRows] = useState<access_user_row[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [editing, setEditing] = useState<{ id: number | null; form: access_form; original?: access_form; audit?: any[]; meta?: any } | null>(null)
  const [pwFor, setPwFor] = useState<access_user_row | null>(null)
  const [pw, setPw] = useState('')
  const me = useAuthStore(s => (s.user as any)?.id)

  const load = () => access_api.users({ search, status }).then(r => setRows(r.data)).catch(e => toast.error(errMsg(e)))
  useEffect(() => { const h = setTimeout(load, 250); return () => clearTimeout(h) }, [search, status])

  const open = async (id: number | null) => {
    if (!id) return setEditing({ id: null, form: { ...EMPTY, permissions: [...(cat.role_permissions.staff || [])] } })
    try {
      const { data } = await access_api.user(id)
      const form = Object.fromEntries(Object.keys(EMPTY).map(k => [k, (data as any)[k] ?? (EMPTY as any)[k]])) as access_form
      form.password = ''
      setEditing({ id, form, original: JSON.parse(JSON.stringify(form)), audit: data.audit, meta: data })
    } catch (e) { toast.error(errMsg(e)) }
  }
  const act = async (fn: () => Promise<unknown>, msg: string) => { try { await fn(); toast.success(msg); load() } catch (e) { toast.error(errMsg(e)) } }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input className="form-input !w-72" placeholder="Search name, username, code, mobile…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-input !w-auto" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <button className="btn btn-primary ml-auto" onClick={() => open(null)}><i className="fas fa-user-plus mr-2" />New user</button>
      </div>
      <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
        <table className="ent-table min-w-[1150px]">
          <thead><tr><th>ID</th><th>Employee</th><th>Username</th><th>Department</th><th>Role</th>
            <th className="!text-center">Outlets</th><th className="!text-center">Categories</th><th className="!text-center">Groups</th>
            <th>Status</th><th>Last login</th><th className="!text-right">Actions</th></tr></thead>
          <tbody>
            {!rows.length ? <tr><td colSpan={11} className="text-center text-text-muted !py-10">No users</td></tr> : rows.map(u => {
              const admin = ADMIN.includes(u.role)
              return (
                <tr key={u.id}>
                  <td className="font-mono text-[12px]">{u.id}</td>
                  <td><button className="font-semibold text-text-link hover:underline text-left" onClick={() => open(u.id)}>{u.name}</button>
                    <div className="text-[11px] text-text-muted">{[u.employee_code, u.designation, u.mobile].filter(Boolean).join(' · ')}</div></td>
                  <td className="font-mono text-[12px]">{u.username}</td>
                  <td className="text-[12px]">{u.department || '—'}</td>
                  <td><span className="text-[12px] px-2 py-0.5 rounded-full bg-primary-light text-primary">{cat.roles.find(r => r.slug === u.role)?.name || u.role}</span></td>
                  <td className="!text-center text-[12px]">{admin || u.all_outlets ? 'All' : u.outlet_count}{u.default_outlet && <div className="text-text-muted">{u.default_outlet}</div>}</td>
                  <td className="!text-center text-[12px]">{admin || u.all_categories ? 'All' : u.category_count}</td>
                  <td className="!text-center text-[12px]">{admin || !u.group_count ? 'All' : u.group_count}</td>
                  <td><span className={`text-[11px] px-2 py-0.5 rounded-full ${u.status ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>{u.status ? 'Active' : 'Inactive'}</span>
                    {u.valid_until && <div className="text-[11px] text-text-muted">till {u.valid_until}</div>}</td>
                  <td className="text-[12px] whitespace-nowrap">{dt(u.last_login)}</td>
                  <td className="!text-right whitespace-nowrap">
                    <button className="btn btn-secondary !px-2" title="Edit & permissions" onClick={() => open(u.id)}><i className="fas fa-user-cog" /></button>{' '}
                    {u.id !== me && <>
                      <button className="btn btn-secondary !px-2" title="Reset password" onClick={() => { setPwFor(u); setPw('') }}><i className="fas fa-key" /></button>{' '}
                      <button className="btn btn-secondary !px-2" title={u.status ? 'Deactivate' : 'Activate'}
                        onClick={() => window.confirm(`${u.status ? 'Deactivate' : 'Activate'} ${u.name}?`) && act(() => access_api.toggle(u.id), u.status ? 'Deactivated' : 'Activated')}>
                        <i className={`fas ${u.status ? 'fa-user-slash' : 'fa-user-check'}`} /></button></>}
                  </td>
                </tr>)
            })}
          </tbody>
        </table>
      </div>

      {editing && <Editor cat={cat} rows={rows} state={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}

      <Modal open={!!pwFor} onClose={() => setPwFor(null)} title={`Reset password — ${pwFor?.name}`}>
        <label className="form-label">New password (8+ characters)</label>
        <input className="form-input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-secondary" onClick={() => setPwFor(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={pw.length < 8} onClick={() => pwFor && act(() => access_api.reset_password(pwFor.id, pw), 'Password reset').then(() => setPwFor(null))}>Reset</button>
        </div>
      </Modal>
    </div>
  )
}

function Editor({ cat, rows, state, onClose, onSaved }: {
  cat: access_catalog; rows: access_user_row[]; onClose: () => void; onSaved: () => void
  state: { id: number | null; form: access_form; original?: access_form; audit?: any[]; meta?: any }
}) {
  const [f, setF] = useState<access_form>(state.form)
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof access_form>(k: K, v: access_form[K]) => setF(x => ({ ...x, [k]: v }))
  const admin = ADMIN.includes(f.role)

  async function copyFrom(id: number) {
    try {
      const { data } = await access_api.user(id)
      setF(x => ({ ...x, role: data.role, all_outlets: data.all_outlets, outlet_ids: data.outlet_ids, outlet_id: data.outlet_id,
                   all_categories: data.all_categories, category_ids: data.category_ids, group_ids: data.group_ids, permissions: data.permissions }))
      toast.success(`Copied ${data.name}'s access — review each tab, then save`)
    } catch (e) { toast.error(errMsg(e)) }
  }

  const o = state.original
  const removed = o ? {
    outlets: o.all_outlets && !f.all_outlets ? ['All outlets'] : o.outlet_ids.filter(i => !f.all_outlets && !f.outlet_ids.includes(i)).map(i => cat.outlets.find(x => x.id === i)?.outlet_name || `#${i}`),
    categories: o.all_categories && !f.all_categories ? ['All categories'] : o.category_ids.filter(i => !f.all_categories && !f.category_ids.includes(i)).map(i => cat.categories.find(x => x.id === i)?.name || `#${i}`),
    groups: f.group_ids.length ? o.group_ids.filter(i => !f.group_ids.includes(i)).map(i => cat.groups.find(x => x.id === i)?.name || `#${i}`) : [],
    permissions: o.permissions.filter(p => !f.permissions.includes(p)),
  } : null

  async function save() {
    if (removed && Object.values(removed).some(v => v.length)) {
      const lines = Object.entries(removed).filter(([, v]) => v.length).map(([k, v]) => `• ${k}: ${v.slice(0, 8).join(', ')}${v.length > 8 ? ` … (+${v.length - 8})` : ''}`)
      if (!window.confirm(`This removes existing access:\n\n${lines.join('\n')}\n\nContinue?`)) return
    }
    setSaving(true)
    try {
      const body = { ...f, password: f.password || undefined }
      if (state.id) await access_api.update(state.id, body); else await access_api.create(body)
      toast.success(state.id ? 'User updated' : 'User created'); onSaved()
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={state.id ? `Edit user — ${state.form.name}` : 'New user'} width="max-w-6xl">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {STEPS.map((s, i) => <button key={s} onClick={() => setStep(i)}
          className={`text-[12px] px-3 py-1.5 rounded-full border ${step === i ? 'bg-primary text-white border-primary' : 'border-border text-text-secondary hover:border-primary'}`}>{i + 1}. {s}</button>)}
        <select className="form-input !w-56 !h-8 ml-auto text-[12px]" value="" onChange={e => e.target.value && copyFrom(Number(e.target.value))}>
          <option value="">Copy access from user…</option>
          {rows.filter(r => r.id !== state.id).map(r => <option key={r.id} value={r.id}>{r.name} ({r.role})</option>)}</select>
      </div>

      <div className="min-h-[380px]">
        {step === 0 && <Basic f={f} set={set} cat={cat} isNew={!state.id} meta={state.meta} />}
        {step === 1 && (admin ? <AdminNote /> : <Outlets f={f} set={set} cat={cat} />)}
        {step === 2 && (admin ? <AdminNote /> : <Categories f={f} set={set} cat={cat} />)}
        {step === 3 && (admin ? <AdminNote /> : <Groups f={f} set={set} cat={cat} />)}
        {step === 4 && (admin ? <AdminNote /> : <Matrix cat={cat} kind="module" value={f.permissions} onChange={v => set('permissions', v)} role={f.role} />)}
        {step === 5 && (admin ? <AdminNote /> : <Matrix cat={cat} kind="report" value={f.permissions} onChange={v => set('permissions', v)} role={f.role} />)}
        {step === 6 && <Review f={f} cat={cat} audit={state.audit} removed={removed} />}
      </div>

      <div className="flex justify-between gap-2 pt-4 mt-4 border-t border-border">
        <button className="btn btn-secondary" disabled={step === 0} onClick={() => setStep(step - 1)}><i className="fas fa-arrow-left mr-2" />Back</button>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {step < STEPS.length - 1 && <button className="btn btn-secondary" onClick={() => setStep(step + 1)}>Next<i className="fas fa-arrow-right ml-2" /></button>}
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : state.id ? 'Save changes' : 'Create user'}</button>
        </div>
      </div>
    </Modal>
  )
}

const AdminNote = () => <div className="rounded-lg bg-amber-50 text-amber-800 px-4 py-3 text-[13px]"><i className="fas fa-crown mr-2" />
  Administrators always have every outlet, category and permission. Pick another role to restrict this user.</div>

type FP = { f: access_form; set: <K extends keyof access_form>(k: K, v: access_form[K]) => void; cat: access_catalog }

function Basic({ f, set, cat, isNew, meta }: FP & { isNew: boolean; meta?: any }) {
  const field = (label: string, k: keyof access_form, type = 'text', req = false) => (
    <div><label className="form-label">{label}{req && <span className="text-red-500"> *</span>}</label>
      <input className="form-input" type={type} value={(f[k] as any) ?? ''} autoComplete={type === 'password' ? 'new-password' : 'off'}
        onChange={e => set(k, (e.target.value || (k === 'password' ? '' : null)) as any)} /></div>)
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {field('Employee name', 'name', 'text', true)}
      {field('Login username', 'username', 'text', true)}
      {field(isNew ? 'Password (8+ characters)' : 'New password (leave blank to keep)', 'password', 'password', isNew)}
      {field('Employee code', 'employee_code')}
      {field('Mobile number', 'mobile', 'tel')}
      {field('Email address', 'email', 'email')}
      {field('Department', 'department')}
      {field('Designation', 'designation')}
      <div><label className="form-label">User role <span className="text-red-500">*</span></label>
        <select className="form-input" value={f.role} onChange={e => {
          const r = e.target.value
          set('role', r)
          if (!ADMIN.includes(r) && window.confirm('Load this role’s starting permissions? (You can still change them.)')) set('permissions', [...(cat.role_permissions[r] || [])])
        }}>{cat.roles.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}</select></div>
      <div><label className="form-label">Default outlet</label>
        <select className="form-input" value={f.outlet_id ?? ''} onChange={e => set('outlet_id', e.target.value ? Number(e.target.value) : null)}>
          <option value="">Head Office</option>{cat.outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></div>
      {field('Account valid from', 'valid_from', 'date')}
      {field('Account valid until', 'valid_until', 'date')}
      <label className="flex items-center gap-2 text-[13px] md:col-span-3"><input type="checkbox" checked={f.status} onChange={e => set('status', e.target.checked)} />Active (can log in)</label>
      {!ADMIN.includes(f.role) && <div className="md:col-span-3 border rounded-lg p-3 bg-slate-50">
        <div className="text-sm font-semibold text-slate-700 mb-1"><i className="fas fa-industry mr-1 text-primary" />Manufacturing departments</div>
        <div className="text-xs text-slate-500 mb-2">This user sees stock, ledgers and transfers of the ticked departments only. Leave all unticked for no manufacturing stock access.</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1">{(cat.mfg_stores || []).map(s => {
          const on = (f.mfg_store_ids || []).includes(s.id)
          return <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={on}
            onChange={() => set('mfg_store_ids', on ? (f.mfg_store_ids || []).filter(x => x !== s.id) : [...(f.mfg_store_ids || []), s.id])} />{s.name}</label>
        })}</div>
      </div>}
      {meta && <div className="md:col-span-3 text-[12px] text-text-muted grid grid-cols-2 md:grid-cols-4 gap-2 border-t border-border pt-3">
        <span>Last login: <b>{dt(meta.last_login)}</b></span><span>Created: <b>{dt(meta.created_at)}</b>{meta.created_by_name && ` by ${meta.created_by_name}`}</span>
        <span>Modified: <b>{dt(meta.updated_at)}</b>{meta.updated_by_name && ` by ${meta.updated_by_name}`}</span><span>User ID: <b>{meta.id}</b></span></div>}
    </div>
  )
}

function Checklist<T extends { id: number }>({ items, label, selected, onChange, group }: {
  items: T[]; label: (t: T) => string; selected: number[]; onChange: (v: number[]) => void; group?: (t: T) => string
}) {
  const [q, setQ] = useState('')
  const shown = items.filter(t => label(t).toLowerCase().includes(q.toLowerCase()) || (group?.(t) || '').toLowerCase().includes(q.toLowerCase()))
  const groups = group ? [...new Set(shown.map(group))] : ['']
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <input className="form-input !w-64" placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn btn-secondary !py-1" onClick={() => onChange([...new Set([...selected, ...shown.map(t => t.id)])])}>Select all{q && ' shown'}</button>
        <button className="btn btn-secondary !py-1" onClick={() => onChange(selected.filter(id => !shown.some(t => t.id === id)))}>Clear{q && ' shown'}</button>
        <span className="text-[12px] text-text-muted">{selected.length} selected</span>
      </div>
      <div className="max-h-80 overflow-y-auto border border-border rounded-lg p-2 space-y-2">
        {groups.map(g => <div key={g}>
          {g && <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1">{g}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
            {shown.filter(t => !group || group(t) === g).map(t => <label key={t.id} className="flex items-center gap-2 text-[13px] cursor-pointer">
              <input type="checkbox" checked={selected.includes(t.id)} onChange={e => onChange(e.target.checked ? [...selected, t.id] : selected.filter(x => x !== t.id))} />{label(t)}</label>)}
          </div></div>)}
        {!shown.length && <div className="text-text-muted text-[13px] p-2">Nothing matches</div>}
      </div>
    </div>
  )
}

function Outlets({ f, set, cat }: FP) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-[14px] font-semibold"><input type="checkbox" checked={f.all_outlets} onChange={e => set('all_outlets', e.target.checked)} />
        All outlets (includes outlets added later)</label>
      {!f.all_outlets && <Checklist items={cat.outlets} label={o => `${o.outlet_name} (${o.unit_code})`} selected={f.outlet_ids} onChange={v => set('outlet_ids', v)} />}
      <div className="text-[12px] text-text-muted">The user sees and works only in these outlets — dropdowns, reports, stock, GRN, transfers and billing. The default outlet is always included.</div>
    </div>
  )
}

function Categories({ f, set, cat }: FP) {
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-[14px] font-semibold"><input type="checkbox" checked={f.all_categories} onChange={e => set('all_categories', e.target.checked)} />
        All categories (includes categories added later)</label>
      {!f.all_categories && <Checklist items={cat.categories} label={c => c.name} group={c => c.department || 'Other'} selected={f.category_ids}
        onChange={v => { set('category_ids', v); set('group_ids', f.group_ids.filter(g => v.includes(cat.groups.find(x => x.id === g)?.category_id ?? -1))) }} />}
      <div className="text-[12px] text-text-muted">Items outside these categories are hidden from Item Master, item search, GRN, PO, transfers, stock and item-level reports.</div>
    </div>
  )
}

function Groups({ f, set, cat }: FP) {
  const avail = cat.groups.filter(g => f.all_categories || f.category_ids.includes(g.category_id))
  const catName = (id: number) => cat.categories.find(c => c.id === id)?.name || '—'
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-blue-50 text-blue-800 px-3 py-2 text-[12px]"><i className="fas fa-info-circle mr-1.5" />
        Groups are the item sub-categories. Leave all unticked to allow <b>every group</b> of the chosen categories; tick some to allow only those.</div>
      {!avail.length ? <div className="text-text-muted text-[13px]">Pick categories first.</div>
        : <Checklist items={avail} label={g => g.name} group={g => catName(g.category_id)} selected={f.group_ids} onChange={v => set('group_ids', v)} />}
    </div>
  )
}

function Matrix({ cat, kind, value, onChange, role }: { cat: access_catalog; kind: 'module' | 'report'; value: string[]; onChange: (v: string[]) => void; role?: string }) {
  const mods = cat.modules.filter(m => m.kind === kind)
  const acts = cat.actions.filter(a => mods.some(m => m.actions.includes(a)))
  const has = (s: string) => value.includes(s)
  const toggle = (slugs: string[], on: boolean) => onChange(on ? [...new Set([...value, ...slugs])] : value.filter(s => !slugs.includes(s)))
  const tmpl = role ? cat.role_permissions[role] || [] : null
  return (
    <div className="space-y-2">
      {tmpl && <div className="flex items-center gap-2 text-[12px]">
        <button className="btn btn-secondary !py-1" onClick={() => onChange([...value.filter(s => !mods.some(m => s.startsWith(m.key + '.'))), ...tmpl.filter(s => mods.some(m => s.startsWith(m.key + '.')))])}>
          Reset to role template</button>
        <span className="text-text-muted">Ticks that differ from the role template are saved as this user's own exceptions. View does not imply create, edit or delete.</span></div>}
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="ent-table min-w-[820px]">
          <thead><tr><th>{kind === 'report' ? 'Report group' : 'Module'}</th>
            {acts.map(a => <th key={a} className="!text-center capitalize">
              <button className="capitalize hover:text-primary" title="Toggle column" onClick={() => {
                const slugs = mods.filter(m => m.actions.includes(a)).map(m => `${m.key}.${a}`); toggle(slugs, !slugs.every(has)) }}>{a}</button></th>)}
            <th className="!text-center">All</th></tr></thead>
          <tbody>{mods.map(m => {
            const slugs = m.actions.map(a => `${m.key}.${a}`)
            return <tr key={m.key}>
              <td className="font-semibold text-[13px]">{m.label}</td>
              {acts.map(a => <td key={a} className="!text-center">{m.actions.includes(a)
                ? <input type="checkbox" checked={has(`${m.key}.${a}`)} onChange={e => toggle([`${m.key}.${a}`], e.target.checked)}
                    className={tmpl && has(`${m.key}.${a}`) !== tmpl.includes(`${m.key}.${a}`) ? 'outline outline-2 outline-amber-400' : ''} />
                : <span className="text-text-muted">·</span>}</td>)}
              <td className="!text-center"><input type="checkbox" checked={slugs.every(has)} onChange={e => toggle(slugs, e.target.checked)} /></td>
            </tr>
          })}</tbody>
        </table>
      </div>
    </div>
  )
}

function Review({ f, cat, audit, removed }: { f: access_form; cat: access_catalog; audit?: any[]; removed: Record<string, string[]> | null }) {
  const admin = ADMIN.includes(f.role)
  const byModule = useMemo(() => cat.modules.map(m => ({ m, acts: m.actions.filter(a => f.permissions.includes(`${m.key}.${a}`)) })).filter(x => x.acts.length), [f.permissions, cat])
  const names = (ids: number[], list: { id: number; name?: string; outlet_name?: string }[]) => ids.map(i => { const x = list.find(y => y.id === i); return x?.outlet_name || x?.name || `#${i}` })
  const Line = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="grid grid-cols-[160px_1fr] gap-2 text-[13px] py-1 border-b border-border/60"><span className="text-text-secondary">{k}</span><span>{v}</span></div>
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="text-[12px] font-bold uppercase tracking-wide text-text-secondary mb-1">Permission summary</div>
        <Line k="User" v={<><b>{f.name || '—'}</b> ({f.username || '—'}) · {cat.roles.find(r => r.slug === f.role)?.name}</>} />
        <Line k="Status" v={`${f.status ? 'Active' : 'Inactive'}${f.valid_from || f.valid_until ? ` · valid ${f.valid_from || '…'} → ${f.valid_until || '…'}` : ''}`} />
        <Line k="Default outlet" v={cat.outlets.find(o => o.id === f.outlet_id)?.outlet_name || 'Head Office'} />
        <Line k="Outlets" v={admin || f.all_outlets ? 'All outlets' : names(f.outlet_ids, cat.outlets).join(', ') || <span className="text-red-600">none</span>} />
        <Line k="Categories" v={admin || f.all_categories ? 'All categories' : names(f.category_ids, cat.categories).join(', ') || <span className="text-red-600">none</span>} />
        <Line k="Groups" v={admin || !f.group_ids.length ? 'All groups of those categories' : names(f.group_ids, cat.groups).join(', ')} />
        <div className="mt-2 space-y-1">{admin ? <div className="text-[13px]">Every module and report — full access.</div> : byModule.length ? byModule.map(({ m, acts }) =>
          <div key={m.key} className="text-[12px]"><b>{m.label}:</b> {acts.join(', ')}</div>) : <div className="text-red-600 text-[13px]">No module permissions — the user can log in but open nothing.</div>}</div>
        {removed && Object.values(removed).some(v => v.length) && <div className="mt-3 rounded-lg bg-red-50 text-red-700 px-3 py-2 text-[12px]">
          <b>Will be removed:</b> {Object.entries(removed).filter(([, v]) => v.length).map(([k, v]) => `${k} (${v.length})`).join(', ')}</div>}
      </div>
      <div>
        <div className="text-[12px] font-bold uppercase tracking-wide text-text-secondary mb-1">Access history</div>
        {!audit?.length ? <div className="text-text-muted text-[13px]">No changes recorded yet.</div> :
          <div className="max-h-96 overflow-y-auto space-y-2">{audit.map((a, i) => <div key={i} className="text-[12px] border-b border-border/60 pb-1">
            <div className="text-text-muted">{dt(a.created_at)} · {a.changed_by_name}</div><div>{a.summary}</div></div>)}</div>}
      </div>
    </div>
  )
}

// ── role templates ──────────────────────────────────────────────────────────

function RoleTemplates({ cat }: { cat: access_catalog }) {
  const roles = cat.roles.filter(r => !ADMIN.includes(r.slug))
  const [role, setRole] = useState(roles[0]?.slug || '')
  const [perms, setPerms] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  useEffect(() => { setPerms([...(cat.role_permissions[role] || [])]) }, [role, cat])
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="form-input !w-64" value={role} onChange={e => setRole(e.target.value)}>{roles.map(r => <option key={r.slug} value={r.slug}>{r.name}</option>)}</select>
        <span className="text-[12px] text-text-muted">Starting permissions for everyone with this role. A user's own exceptions (set on the user) still apply on top.</span>
        <button className="btn btn-primary ml-auto" disabled={saving} onClick={async () => {
          setSaving(true)
          try { await access_api.set_role_template(role, perms); cat.role_permissions[role] = perms; toast.success('Role template saved') }
          catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
        }}>{saving ? 'Saving…' : 'Save template'}</button>
      </div>
      <Matrix cat={cat} kind="module" value={perms} onChange={setPerms} />
      <Matrix cat={cat} kind="report" value={perms} onChange={setPerms} />
    </div>
  )
}

// ── audit ───────────────────────────────────────────────────────────────────

function Audit() {
  const [data, setData] = useState<{ changes: any[]; denials: any[] } | null>(null)
  useEffect(() => { access_api.audit().then(r => setData(r.data)).catch(e => toast.error(errMsg(e))) }, [])
  if (!data) return <div className="text-text-muted py-10 text-center">Loading…</div>
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
        <div className="px-4 py-2 font-semibold text-[13px] border-b border-border">Permission changes</div>
        <table className="ent-table"><thead><tr><th>When</th><th>User</th><th>Changed by</th><th>What changed</th></tr></thead>
          <tbody>{!data.changes.length ? <tr><td colSpan={4} className="text-center text-text-muted !py-6">None yet</td></tr> : data.changes.map((c, i) =>
            <tr key={i}><td className="text-[12px] whitespace-nowrap">{dt(c.created_at)}</td><td className="text-[12px]">{c.user_id === 0 ? 'Role template' : c.user_name}</td>
              <td className="text-[12px]">{c.changed_by_name}<div className="text-text-muted">{c.ip_address}</div></td><td className="text-[12px]">{c.summary}</td></tr>)}</tbody></table>
      </div>
      <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
        <div className="px-4 py-2 font-semibold text-[13px] border-b border-border">Blocked access attempts</div>
        <table className="ent-table"><thead><tr><th>When</th><th>User</th><th>Attempt</th></tr></thead>
          <tbody>{!data.denials.length ? <tr><td colSpan={3} className="text-center text-text-muted !py-6">None</td></tr> : data.denials.map((d, i) =>
            <tr key={i}><td className="text-[12px] whitespace-nowrap">{dt(d.created_at)}</td><td className="text-[12px]">{d.user_name}<div className="text-text-muted">{d.ip_address}</div></td>
              <td className="text-[12px]">{d.description}</td></tr>)}</tbody></table>
      </div>
    </div>
  )
}
