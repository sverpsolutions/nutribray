// Head Office: 24-hour stores — live shift monitor + shift plan / auto day-end settings for one, some or all stores.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { shifts_api, type monitor_row, type shift_slot, type store_setting } from '../../api/shifts'
import Modal from '../../components/ui/Modal'

const DEFAULT_PLAN: shift_slot[] = [{ name: 'Night', start: '00:00', end: '08:00' }, { name: 'Morning', start: '08:00', end: '16:00' }, { name: 'Evening', start: '16:00', end: '23:59' }]
const tm = (v?: string | null) => v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const errMsg = (e: any) => e?.response?.data?.detail || e?.message || 'Something went wrong'

export default function StoreShifts() {
  const [rows, setRows] = useState<monitor_row[]>([])
  const [stores, setStores] = useState<store_setting[]>([])
  const [form, setForm] = useState<{ ids: number[]; mode: 'STANDARD' | '24H'; plan: shift_slot[]; auto: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  const load = () => {
    shifts_api.monitor().then(r => setRows(r.data)).catch(() => {})
    shifts_api.store_settings().then(r => setStores(r.data)).catch(() => {})
  }
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t) }, [])

  const edit = () => {
    const first = stores.find(s => s.operating_mode === '24H')
    setForm({ ids: stores.map(s => s.outlet_id), mode: '24H', plan: first?.shift_plan ?? DEFAULT_PLAN, auto: first?.auto_rollover ?? true })
  }
  const setSlot = (i: number, k: keyof shift_slot, v: string) => setForm(f => f && ({ ...f, plan: f.plan.map((s, j) => j === i ? { ...s, [k]: v } : s) }))
  const save = async () => {
    if (!form) return
    setSaving(true)
    try {
      const { data } = await shifts_api.save_store_settings({ outlet_ids: form.ids, operating_mode: form.mode, shift_plan: form.mode === '24H' ? form.plan : undefined, auto_rollover: form.auto })
      toast.success(`${data.updated} store(s) updated`); setForm(null); load()
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }

  const n24 = rows.filter(r => r.mode === '24H').length
  const overdue = rows.filter(r => r.overdue).length

  return (
    <section className="bg-app-card border border-border rounded-fiori p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold m-0"><i className="fas fa-clock mr-2 text-primary" />Store shifts — {n24} of {rows.length} stores on 24 hours
          {overdue > 0 && <span className="ml-2 text-red-600 text-[13px]"><i className="fas fa-exclamation-triangle mr-1" />{overdue} store(s) with an overdue shift</span>}</h3>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={load}><i className="fas fa-sync" /></button>
          <button className="btn btn-primary" onClick={edit}><i className="fas fa-sliders-h mr-2" />Shift plan settings</button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="ent-table min-w-[760px]">
          <thead><tr><th>Store</th><th>Mode</th><th>Now</th><th>Shifts (open day)</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.outlet_id} className={r.overdue ? 'bg-red-50' : ''}>
              <td className="font-semibold">{r.store}</td>
              <td>{r.mode === '24H' ? <span className="text-primary font-semibold">24 h{r.auto_rollover ? ' · auto' : ''}</span> : 'Standard'}</td>
              <td>{r.current_slot || '—'}</td>
              <td className="text-[12px]">{!r.shifts.length ? <span className="text-text-muted">No shift</span> : r.shifts.map(s => (
                <div key={s.id} className={s.overdue ? 'text-red-600 font-semibold' : s.status === 'open' ? 'text-green-700' : 'text-text-muted'}>
                  Shift {s.shift_no} {s.shift_name} · {s.cashier} · {s.status === 'open' ? `open since ${tm(s.opened_at)}${s.planned_end ? `, due ${tm(s.planned_end)}` : ''}${s.overdue ? ' — OVERDUE' : ''}`
                    : `closed ${tm(s.closed_at)}${s.auto_closed ? ' (auto)' : ''}`}
                </div>
              ))}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title="Store shift plan" width="max-w-3xl">
        {form && (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="form-label">Working</label>
                <select className="form-input" value={form.mode} onChange={e => setForm(f => f && ({ ...f, mode: e.target.value as '24H' | 'STANDARD' }))}>
                  <option value="24H">24 hours (day-end 23:59, next day from 00:00)</option><option value="STANDARD">Standard (store closing time)</option>
                </select></div>
              {form.mode === '24H' && (
                <label className="flex items-center gap-2 text-[13px] mt-6">
                  <input type="checkbox" checked={form.auto} onChange={e => setForm(f => f && ({ ...f, auto: e.target.checked }))} />
                  Auto day-end at 00:15 if the store forgets (system figures, sent for review)
                </label>
              )}
            </div>
            {form.mode === '24H' && (
              <div className="space-y-2">
                <div className="text-[13px] font-semibold text-primary">Shifts (first starts 00:00, each starts when the previous ends, last ends 23:59)</div>
                {form.plan.map((s, i) => (
                  <div key={i} className="grid grid-cols-[1fr_120px_120px_40px] gap-2 items-center">
                    <input className="form-input" value={s.name} onChange={e => setSlot(i, 'name', e.target.value)} aria-label="Shift name" />
                    <input className="form-input" type="time" value={s.start} onChange={e => setSlot(i, 'start', e.target.value)} aria-label="Start" />
                    <input className="form-input" type="time" value={s.end} onChange={e => setSlot(i, 'end', e.target.value)} aria-label="End" />
                    <button className="btn btn-secondary" aria-label="Remove shift" disabled={form.plan.length < 2}
                      onClick={() => setForm(f => f && ({ ...f, plan: f.plan.filter((_, j) => j !== i) }))}><i className="fas fa-times" /></button>
                  </div>
                ))}
                <button className="btn btn-secondary" onClick={() => setForm(f => f && ({ ...f, plan: [...f.plan, { name: '', start: f.plan[f.plan.length - 1]?.end ?? '00:00', end: '23:59' }] }))}>
                  <i className="fas fa-plus mr-2" />Add shift</button>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">Apply to {form.ids.length} of {stores.length} stores</span>
                <span className="flex gap-3 text-[12px]">
                  <button className="text-primary" onClick={() => setForm(f => f && ({ ...f, ids: stores.map(s => s.outlet_id) }))}>All</button>
                  <button className="text-primary" onClick={() => setForm(f => f && ({ ...f, ids: [] }))}>None</button>
                </span>
              </div>
              <div className="grid sm:grid-cols-3 gap-1 max-h-48 overflow-y-auto border border-border rounded-md p-2 mt-1">
                {stores.map(s => (
                  <label key={s.outlet_id} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={form.ids.includes(s.outlet_id)}
                      onChange={e => setForm(f => f && ({ ...f, ids: e.target.checked ? [...f.ids, s.outlet_id] : f.ids.filter(x => x !== s.outlet_id) }))} />
                    {s.store}{s.operating_mode === '24H' && <span className="text-primary text-[11px]">24h</span>}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || !form.ids.length} onClick={save}><i className="fas fa-save mr-2" />Save</button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}
