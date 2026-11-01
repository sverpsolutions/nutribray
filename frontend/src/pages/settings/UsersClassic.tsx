// Users & Locations: who works where and with which role. Location drives the POS counter, day/shift and
// cash rules (branch managers accept cash into their own branch safe). Server blocks moving or deactivating
// anyone with an open shift or cash in hand.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { masters_api } from '../../api/masters'
import { users_api, USER_ROLES, type user_row } from '../../api/users'
import { dashboardBuilderApi, type DashboardTemplate } from '../../api/dashboardBuilder'
import { useAuthStore } from '../../store/authStore'
import PageHeader from '../../components/ui/PageHeader'
import Modal from '../../components/ui/Modal'
import StatusBadge from '../../components/ui/StatusBadge'

const PER_PAGE = 50
const ROLE_HELP: Record<string, string> = {
  admin: 'Full administrative access across all stores and modules',
  superadmin: 'Complete system control, template configuration, and unrestricted access',
  manager: 'Day open/close, approves expenses, safe handovers & deposits at their location',
  category_manager: 'Assigned product categories: sales, margins, purchases, inventory, and expiry',
  area_sales_manager: 'Assigned multi-store cluster: sales, targets, transfers, and store stock',
  store_manager: 'Store-level cockpit: day operations, cashier shifts, local GRN & stock',
  purchase_manager: 'Vendor PO approvals, price revisions, and incoming procurement',
  accounts_manager: 'Vendor bills, cheque registers, bank reconciliations, and receivables',
  staff: 'Billing — must open their own shift at their location',
  viewer: 'Read-only access across authorized modules',
}
const errMsg = (e: any) => {
  const d = e?.response?.data?.detail
  if (typeof d !== 'string') return e?.message || 'Something went wrong'
  const m = [...d.matchAll(/'msg': ["'](?:Value error, )?(.*?)["'], 'input'/g)].map(x => x[1])
  return m.length ? m.join(' • ') : d
}
const dt = (v?: string | null) => v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Never'

type Form = { id?: number; name: string; username: string; email: string; role: string; outlet_id: string; password: string; status: boolean }
const EMPTY: Form = { name: '', username: '', email: '', role: 'staff', outlet_id: '0', password: '', status: true }

export default function UserManagement() {
  const me = useAuthStore(s => s.user)
  const isAdmin = me?.role === 'admin' || me?.role === 'superadmin'
  const [outlets, setOutlets] = useState<{ id: number; outlet_name: string }[]>([])
  const [rows, setRows] = useState<user_row[]>([])
  const [total, setTotal] = useState(0)
  const [q, setQ] = useState<{ page: number; search: string; role: string; outlet: string; status: string }>({ page: 1, search: '', role: '', outlet: '', status: 'true' })
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [pwd, setPwd] = useState<{ u: user_row; p: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Data Scope & Assignments states
  const [scopeUser, setScopeUser] = useState<user_row | null>(null)
  const [allCategories, setAllCategories] = useState<{ id: number; name: string }[]>([])
  const [allTemplates, setAllTemplates] = useState<DashboardTemplate[]>([])
  const [assignedStoreIds, setAssignedStoreIds] = useState<number[]>([])
  const [assignedCatIds, setAssignedCatIds] = useState<number[]>([])
  const [assignedTemplateId, setAssignedTemplateId] = useState<number | null>(null)
  const [storeSearch, setStoreSearch] = useState('')
  const [catSearch, setCatSearch] = useState('')
  const [savingScope, setSavingScope] = useState(false)
  const [loadingScope, setLoadingScope] = useState(false)

  useEffect(() => {
    masters_api.get_outlets().then(r => setOutlets(r.data || [])).catch(() => {})
    masters_api.get_item_categories().then(r => setAllCategories((r.data || []).map((c: any) => ({ id: c.id, name: c.name })))).catch(() => {})
    dashboardBuilderApi.getTemplates().then(r => setAllTemplates(r || [])).catch(() => {})
  }, [])
  const load = () => users_api.list({
    page: q.page, per_page: PER_PAGE, search: q.search || undefined, role: q.role || undefined,
    outlet_id: q.outlet === '' ? undefined : Number(q.outlet), status: q.status === '' ? undefined : q.status === 'true',
  }).then(r => { setRows(r.data.data); setTotal(r.data.total) }).catch(e => toast.error(errMsg(e)))
  useEffect(() => { load() }, [q])
  useEffect(() => { const h = setTimeout(() => setQ(x => x.search === search.trim() ? x : { ...x, search: search.trim(), page: 1 }), 300); return () => clearTimeout(h) }, [search])

  const openScopeModal = async (u: user_row) => {
    setScopeUser(u)
    setLoadingScope(true)
    setStoreSearch('')
    setCatSearch('')
    try {
      const res = await dashboardBuilderApi.getUserAssignments(u.id)
      setAssignedStoreIds(res.assigned_stores.map(s => s.outlet_id))
      setAssignedCatIds(res.assigned_categories.map(c => c.category_id))
      setAssignedTemplateId(res.user.default_dashboard_template_id ?? null)
    } catch (e) {
      toast.error('Failed to load user assignments')
    } finally {
      setLoadingScope(false)
    }
  }

  const saveScope = async () => {
    if (!scopeUser) return
    setSavingScope(true)
    try {
      await dashboardBuilderApi.updateUserAssignments(scopeUser.id, {
        outlet_ids: assignedStoreIds,
        category_ids: assignedCatIds,
        default_template_id: assignedTemplateId
      })
      toast.success(`Data scope updated for ${scopeUser.name}`)
      setScopeUser(null)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setSavingScope(false)
    }
  }

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!form) return
    setBusy(true)
    const outlet_id = Number(form.outlet_id) || null
    try {
      if (form.id) await users_api.update(form.id, { name: form.name.trim(), email: form.email.trim() || null, role: form.role, outlet_id, status: form.status })
      else await users_api.create({ name: form.name.trim(), username: form.username.trim(), password: form.password, email: form.email.trim() || null, role: form.role, outlet_id })
      toast.success(form.id ? 'User updated — they see the new location after their next login' : 'User created')
      setForm(null); load()
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  const resetPwd = async () => {
    if (!pwd) return
    setBusy(true)
    try { await users_api.reset_password(pwd.u.id, pwd.p); toast.success(`Password reset for ${pwd.u.name}`); setPwd(null) }
    catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  const toggle = async (u: user_row) => {
    if (u.status && !confirm(`Deactivate ${u.name}? They will not be able to log in.`)) return
    try { u.status ? await users_api.deactivate(u.id) : await users_api.update(u.id, { status: true }); toast.success(u.status ? 'Deactivated' : 'Activated'); load() }
    catch (e) { toast.error(errMsg(e)) }
  }

  const pages = Math.max(1, Math.ceil(total / PER_PAGE))
  const locSelect = (value: string, onChange: (v: string) => void, withAll = false) => (
    <select className="form-input" value={value} onChange={e => onChange(e.target.value)} aria-label="Location">
      {withAll && <option value="">All locations</option>}
      <option value="0">Head Office</option>
      {outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}
    </select>
  )

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Users & Locations" subtitle="Assign every user a role and the location they work at"
        action={isAdmin && <button className="btn btn-primary" onClick={() => setForm({ ...EMPTY })}><i className="fas fa-user-plus mr-2" />New User</button>} />

      <div className="bg-app-card border border-border rounded-fiori p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm" />
          <input className="form-input !pl-9" placeholder="Search name, username, email…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="w-56">{locSelect(q.outlet, v => setQ(x => ({ ...x, outlet: v, page: 1 })), true)}</div>
        <select className="form-input !w-auto" value={q.role} onChange={e => setQ(x => ({ ...x, role: e.target.value, page: 1 }))} aria-label="Role">
          <option value="">All roles</option>{['superadmin', ...USER_ROLES].map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
        </select>
        <select className="form-input !w-auto" value={q.status} onChange={e => setQ(x => ({ ...x, status: e.target.value, page: 1 }))} aria-label="Status">
          <option value="true">Active</option><option value="false">Inactive</option><option value="">All</option>
        </select>
      </div>

      <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
        <table className="ent-table min-w-[860px]">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Location</th><th>Last login</th><th>Status</th>{isAdmin && <th className="!text-right">Actions</th>}</tr></thead>
          <tbody>
            {!rows.length ? <tr><td colSpan={7} className="text-center text-text-muted !py-10">No users found</td></tr> : rows.map(u => (
              <tr key={u.id}>
                <td className="font-semibold">{u.name}{u.id === me?.id && <span className="text-[11px] text-text-muted"> (you)</span>}{u.email && <div className="text-[12px] text-text-muted font-normal">{u.email}</div>}</td>
                <td className="font-mono text-[12px]">{u.username}</td>
                <td><span className="text-[12px] px-2 py-0.5 rounded-full bg-primary-light text-primary capitalize">{u.role}</span></td>
                <td>{u.outlet_id ? u.outlet_name : <span className="text-text-muted">Head Office</span>}
                  {u.role === 'staff' && !u.outlet_id && <div className="text-[11px] text-amber-600">No branch — can bill at any counter</div>}</td>
                <td className="text-[12px]">{dt(u.last_login)}</td>
                <td><StatusBadge active={u.status} /></td>
                {isAdmin && <td className="text-right whitespace-nowrap">
                  <button className="w-8 h-8 rounded-md text-text-secondary hover:bg-app-bg hover:text-primary" title="Edit" aria-label={`Edit ${u.name}`}
                    onClick={() => setForm({ id: u.id, name: u.name, username: u.username, email: u.email || '', role: u.role, outlet_id: String(u.outlet_id || 0), password: '', status: u.status })}><i className="fas fa-pen" /></button>
                  <button className="w-8 h-8 rounded-md text-text-secondary hover:bg-app-bg hover:text-blue-600" title="Data Scope & Store/Category Assignments" aria-label={`Configure data scope of ${u.name}`}
                    onClick={() => openScopeModal(u)}><i className="fas fa-shield-alt" /></button>
                  <button className="w-8 h-8 rounded-md text-text-secondary hover:bg-app-bg hover:text-primary" title="Reset password" aria-label={`Reset password of ${u.name}`}
                    onClick={() => setPwd({ u, p: '' })}><i className="fas fa-key" /></button>
                  {u.id !== me?.id && <button className={`w-8 h-8 rounded-md text-text-secondary hover:bg-app-bg ${u.status ? 'hover:text-red-600' : 'hover:text-green-600'}`}
                    title={u.status ? 'Deactivate' : 'Activate'} aria-label={`${u.status ? 'Deactivate' : 'Activate'} ${u.name}`} onClick={() => toggle(u)}>
                    <i className={`fas ${u.status ? 'fa-ban' : 'fa-undo'}`} /></button>}
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-border text-[13px] text-text-secondary">
          <span>{total} user{total === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <button className="btn btn-secondary" disabled={q.page <= 1} onClick={() => setQ(x => ({ ...x, page: x.page - 1 }))}>Prev</button>
            <span>Page {q.page} of {pages}</span>
            <button className="btn btn-secondary" disabled={q.page >= pages} onClick={() => setQ(x => ({ ...x, page: x.page + 1 }))}>Next</button>
          </div>
        </div>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `Edit • ${form.username}` : 'New User'} width="max-w-xl">
        {form && (
          <form onSubmit={save} className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className="form-label">Full name <span className="text-red-500">*</span></label>
              <input className="form-input" required minLength={2} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="form-label">Username <span className="text-red-500">*</span></label>
              <input className="form-input font-mono" required minLength={3} pattern="[A-Za-z0-9_.@-]+" disabled={!!form.id} value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value.trim() })} /></div>
            <div><label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            {!form.id && <div className="sm:col-span-2"><label className="form-label">Password <span className="text-red-500">*</span></label>
              <input className="form-input" type="password" required minLength={6} autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              <span className="form-helper">At least 6 characters</span></div>}
            <div><label className="form-label">Role <span className="text-red-500">*</span></label>
              <select className="form-input capitalize" value={form.role} disabled={form.id === me?.id || (form.role === 'superadmin' && me?.role !== 'superadmin')}
                onChange={e => setForm({ ...form, role: e.target.value })}>
                {[...(me?.role === 'superadmin' || form.role === 'superadmin' ? ['superadmin'] : []), ...USER_ROLES].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <span className="form-helper">{ROLE_HELP[form.role]}</span></div>
            <div><label className="form-label">Location <span className="text-red-500">*</span></label>
              {locSelect(form.outlet_id, v => setForm({ ...form, outlet_id: v }))}
              <span className="form-helper">{form.role === 'staff' ? 'Their POS counter is locked to this location' : form.role === 'manager' ? 'Accepts cash into this location\'s safe' : 'Head Office = not tied to a branch'}</span></div>
            {form.id && form.id !== me?.id && <label className="sm:col-span-2 flex items-center gap-2 text-[13px] text-text-secondary">
              <input type="checkbox" checked={form.status} onChange={e => setForm({ ...form, status: e.target.checked })} /> Active (can log in)</label>}
            <p className="sm:col-span-2 text-[12px] text-text-muted m-0">A user with an open shift or cash in hand can't be moved or deactivated until that is settled.</p>
            <div className="sm:col-span-2 flex justify-end gap-2 pt-2 border-t border-border">
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : form.id ? 'Update User' : 'Create User'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!pwd} onClose={() => setPwd(null)} title={`Reset password • ${pwd?.u.name ?? ''}`}>
        {pwd && <div className="space-y-3">
          <div><label className="form-label">New password</label>
            <input className="form-input" type="password" autoComplete="new-password" minLength={6} value={pwd.p} onChange={e => setPwd({ ...pwd, p: e.target.value })} />
            <span className="form-helper">At least 6 characters. Share it with the user privately.</span></div>
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => setPwd(null)}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || pwd.p.length < 6} onClick={resetPwd}>Reset Password</button>
          </div>
        </div>}
      </Modal>

      {/* Data Scope & Role Assignments Modal */}
      <Modal
        open={!!scopeUser}
        onClose={() => setScopeUser(null)}
        title={`Data Scope & Access Boundaries • ${scopeUser?.name ?? ''}`}
        width="max-w-3xl"
      >
        {scopeUser && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 flex items-start gap-2.5 text-xs text-blue-900 dark:text-blue-200">
              <i className="fas fa-shield-alt text-blue-600 mt-0.5" />
              <div>
                <strong>Role: {scopeUser.role.replace(/_/g, ' ').toUpperCase()}</strong>
                <p className="m-0 mt-0.5 text-blue-800 dark:text-blue-300">
                  Data isolation is strictly enforced at the backend database query layer. The user cannot view, filter, or query stores or product categories outside their assigned boundaries.
                </p>
              </div>
            </div>

            {loadingScope ? (
              <div className="py-12 text-center text-xs text-text-muted">Loading user assignments…</div>
            ) : (
              <div className="space-y-4">
                {/* 1. Default Landing Dashboard Template */}
                <div>
                  <label className="form-label text-xs font-semibold">Default Dashboard Template</label>
                  <select
                    className="form-input text-xs"
                    value={assignedTemplateId ?? ''}
                    onChange={e => setAssignedTemplateId(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Role Default (Auto-assigned)</option>
                    {allTemplates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} {t.is_default ? '★ (Global Default)' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="form-helper">Specifies which dashboard layout loads when this user logs in.</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border">
                  {/* 2. Permitted Stores (e.g. 6 stores for ASM) */}
                  <div className="border border-border rounded-xl p-3 bg-app-bg/50 flex flex-col h-[320px]">
                    <div className="flex items-center justify-between pb-2 border-b border-border">
                      <span className="text-xs font-semibold text-text-primary">
                        Assigned Outlets ({assignedStoreIds.length})
                      </span>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => setAssignedStoreIds(outlets.map(o => o.id))}
                        >
                          All
                        </button>
                        <span>·</span>
                        <button
                          type="button"
                          className="text-text-muted hover:underline"
                          onClick={() => setAssignedStoreIds([])}
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <input
                      className="form-input text-xs !py-1 my-2"
                      placeholder="Filter stores…"
                      value={storeSearch}
                      onChange={e => setStoreSearch(e.target.value)}
                    />

                    <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs">
                      {outlets
                        .filter(o => !storeSearch || o.outlet_name.toLowerCase().includes(storeSearch.toLowerCase()))
                        .map(o => {
                          const checked = assignedStoreIds.includes(o.id)
                          return (
                            <label
                              key={o.id}
                              className={`flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-colors ${
                                checked ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-app-card text-text-secondary'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  if (e.target.checked) setAssignedStoreIds([...assignedStoreIds, o.id])
                                  else setAssignedStoreIds(assignedStoreIds.filter(id => id !== o.id))
                                }}
                              />
                              <span className="truncate">{o.outlet_name}</span>
                            </label>
                          )
                        })}
                    </div>
                  </div>

                  {/* 3. Permitted Product Categories (e.g. for Category Manager) */}
                  <div className="border border-border rounded-xl p-3 bg-app-bg/50 flex flex-col h-[320px]">
                    <div className="flex items-center justify-between pb-2 border-b border-border">
                      <span className="text-xs font-semibold text-text-primary">
                        Assigned Categories ({assignedCatIds.length})
                      </span>
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <button
                          type="button"
                          className="text-primary hover:underline"
                          onClick={() => setAssignedCatIds(allCategories.map(c => c.id))}
                        >
                          All
                        </button>
                        <span>·</span>
                        <button
                          type="button"
                          className="text-text-muted hover:underline"
                          onClick={() => setAssignedCatIds([])}
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <input
                      className="form-input text-xs !py-1 my-2"
                      placeholder="Filter categories…"
                      value={catSearch}
                      onChange={e => setCatSearch(e.target.value)}
                    />

                    <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 text-xs">
                      {allCategories
                        .filter(c => !catSearch || c.name.toLowerCase().includes(catSearch.toLowerCase()))
                        .map(c => {
                          const checked = assignedCatIds.includes(c.id)
                          return (
                            <label
                              key={c.id}
                              className={`flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-colors ${
                                checked ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-app-card text-text-secondary'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e => {
                                  if (e.target.checked) setAssignedCatIds([...assignedCatIds, c.id])
                                  else setAssignedCatIds(assignedCatIds.filter(id => id !== c.id))
                                }}
                              />
                              <span className="truncate">{c.name}</span>
                            </label>
                          )
                        })}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
                  <button type="button" className="btn btn-secondary text-xs" onClick={() => setScopeUser(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary text-xs"
                    disabled={savingScope}
                    onClick={saveScope}
                  >
                    <i className="fas fa-save mr-1" /> {savingScope ? 'Saving…' : 'Save Scope & Assignments'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
