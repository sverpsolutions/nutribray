import { Fragment, useEffect, useRef, useState } from 'react'
import Modal from '../../components/ui/Modal'
import { Link } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader'
import { inventory_api } from '../../api/inventory'
import { getCompanySettings } from '../../api/company'
import { useAuthStore } from '../../store/authStore'
import { printTransferOut, type transfer_print } from '../../utils/printTransferOut'

type direction = 'out' | 'in'
interface row {
  id: number; transfer_no: string; transfer_date: string | null; status: string; remarks: string | null
  received_qty: string | null
  from_name: string | null; to_name: string | null
  item_count: number; total_qty: string; cost_value: string; mrp_value: string
}
interface list_out { items: row[]; total: number; totals: { total_qty: string; cost_value: string; mrp_value: string } }

const n2 = (v: unknown) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (v: unknown) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })
const dmy = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
const PER_PAGE = 50
const STATUS_TONE: Record<string, string> = {
  pending: 'bg-[#FDF1DE] text-[#8A4B00]', completed: 'bg-[#E6F4EC] text-[#116B3A]', received: 'bg-[#E6F4EC] text-[#116B3A]',
  received_short: 'bg-[#FBE8E6] text-[#A3261E]',
}
const STATUS_LABEL: Record<string, string> = { received_short: 'received · short' }

export default function TransferRegister({ direction }: { direction: direction }) {
  const user = useAuthStore(s => s.user)
  const [locations, setLocations] = useState<{ id: number; outlet_name: string }[]>([])
  const [locationId, setLocationId] = useState<number | ''>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<list_out | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<Record<number, transfer_print | 'loading'>>({})
  const [receiving, setReceiving] = useState<(transfer_print & { id: number }) | null>(null)

  const isOut = direction === 'out'

  useEffect(() => {
    inventory_api.getBranches().then((list: { id: number; outlet_name: string }[]) => {
      setLocations(list)
      // default: user's outlet, else HO (outlets have no HO flag, only "(HO)" in the name)
      setLocationId(user?.outlet_id ?? list.find(l => /\(HO\)/i.test(l.outlet_name))?.id ?? '')
    }).catch(() => toast.error('Failed to load locations'))
  }, [])

  useEffect(() => {
    const t = setTimeout(load, 250)  // debounce typing in the search box
    return () => clearTimeout(t)
  }, [direction, locationId, dateFrom, dateTo, status, q, page])

  async function load() {
    setLoading(true)
    try {
      setData(await inventory_api.listTransfers({
        direction, location_id: locationId || undefined, date_from: dateFrom || undefined,
        date_to: dateTo || undefined, status: status || undefined, q: q.trim() || undefined, page, per_page: PER_PAGE,
      }))
    } catch {
      toast.error('Failed to load transfers')
    } finally {
      setLoading(false)
    }
  }

  async function toggle(id: number) {
    if (open[id]) return setOpen(({ [id]: _, ...rest }) => rest)
    setOpen(o => ({ ...o, [id]: 'loading' }))
    try {
      const doc = await inventory_api.getTransferPrint(id)
      setOpen(o => ({ ...o, [id]: doc }))
    } catch {
      toast.error('Failed to load transfer items')
      setOpen(({ [id]: _, ...rest }) => rest)
    }
  }

  async function print(id: number) {
    try {
      const [doc, company] = await Promise.all([inventory_api.getTransferPrint(id), getCompanySettings()])
      printTransferOut([doc], company)
    } catch {
      toast.error('Could not load transfer for printing')
    }
  }

  async function openReceive(id: number) {
    try {
      setReceiving({ ...(await inventory_api.getTransferPrint(id)), id })
    } catch {
      toast.error('Failed to load transfer')
    }
  }

  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1) }
  const pages = data ? Math.max(1, Math.ceil(data.total / PER_PAGE)) : 1

  return (
    <div>
      <PageHeader
        title={isOut ? 'Stock Transfer OUT' : 'Stock Transfer IN'}
        subtitle={isOut ? 'Transfers sent from the selected location' : 'Transfers received at the selected location'}
        action={isOut && (
          <Link to="/inventory/transfer/multi" className="btn btn-primary hover:no-underline">
            <i className="fas fa-plus"></i> New Transfer Out
          </Link>
        )}
      />

      <div className="p-6 space-y-4">
        {/* Filters */}
        <div className="bg-white border border-border rounded-xl p-4 grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <label className="col-span-2">
            <span className="form-label">{isOut ? 'From location' : 'To location'}</span>
            <select className="form-input" value={locationId} onChange={e => resetPage(setLocationId)(e.target.value ? Number(e.target.value) : '')}>
              <option value="">All locations</option>
              {locations.map(l => <option key={l.id} value={l.id}>{l.outlet_name}</option>)}
            </select>
          </label>
          <label>
            <span className="form-label">From date</span>
            <input type="date" className="form-input" value={dateFrom} onChange={e => resetPage(setDateFrom)(e.target.value)} />
          </label>
          <label>
            <span className="form-label">To date</span>
            <input type="date" className="form-input" value={dateTo} onChange={e => resetPage(setDateTo)(e.target.value)} />
          </label>
          <label>
            <span className="form-label">Status</span>
            <select className="form-input" value={status} onChange={e => resetPage(setStatus)(e.target.value)}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="received">Received</option>
              <option value="received_short">Received · short</option>
              <option value="completed">Completed</option>
            </select>
          </label>
          <label>
            <span className="form-label">Transfer no</span>
            <input className="form-input font-mono" placeholder="TRF-…" value={q} onChange={e => resetPage(setQ)(e.target.value)} />
          </label>
        </div>

        {/* Summary */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Transfers', data.total.toLocaleString('en-IN')],
              ['Total qty', qty(data.totals.total_qty)],
              ['Cost value', `₹${n2(data.totals.cost_value)}`],
              ['MRP value', `₹${n2(data.totals.mrp_value)}`],
            ].map(([k, v]) => (
              <div key={k} className="bg-white border border-border rounded-xl px-4 py-3">
                <div className="text-[12px] font-medium text-text-secondary">{k}</div>
                <div className="font-mono text-[20px] font-semibold">{v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Register */}
        <div className="bg-white border border-border rounded-xl overflow-x-auto">
          <table className="ent-table">
            <thead>
              <tr>
                <th className="w-8"><span className="sr-only">Expand</span></th>
                <th>Transfer no</th><th>Date</th><th>From</th><th>To</th>
                <th className="text-right">Items</th><th className="text-right">Qty</th>
                <th className="text-right">Cost value ₹</th><th className="text-right">MRP value ₹</th>
                <th>Status</th><th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map(r => {
                const detail = open[r.id]
                return (
                  <Fragment key={r.id}>
                    <tr className="cursor-pointer" onClick={() => toggle(r.id)}>
                      <td>
                        <button type="button" aria-label={detail ? 'Hide items' : 'Show items'} aria-expanded={!!detail}
                          className="w-7 h-7 rounded text-text-secondary hover:bg-app-bg">
                          <i className={`fas fa-chevron-${detail ? 'down' : 'right'} text-[11px]`}></i>
                        </button>
                      </td>
                      <td className="font-mono font-semibold text-primary">{r.transfer_no}</td>
                      <td className="whitespace-nowrap">{dmy(r.transfer_date)}</td>
                      <td>{r.from_name || '—'}</td>
                      <td>{r.to_name || '—'}</td>
                      <td className="text-right font-mono">{r.item_count}</td>
                      <td className="text-right font-mono">{qty(r.total_qty)}</td>
                      <td className="text-right font-mono">{n2(r.cost_value)}</td>
                      <td className="text-right font-mono">{n2(r.mrp_value)}</td>
                      <td><span className={`status-badge ${STATUS_TONE[r.status] || 'bg-app-bg text-text-secondary'}`}>{STATUS_LABEL[r.status] || r.status}</span></td>
                      <td className="text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {!isOut && r.status === 'pending' && (
                          <button type="button" className="btn btn-primary h-8 px-3 text-[12px] mr-2" onClick={() => openReceive(r.id)}>
                            <i className="fas fa-clipboard-check"></i> Receive
                          </button>
                        )}
                        <button type="button" className="btn btn-secondary h-8 px-3 text-[12px]" onClick={() => print(r.id)}>
                          <i className="fas fa-print"></i> Print
                        </button>
                      </td>
                    </tr>
                    {detail && (
                      <tr>
                        <td></td>
                        <td colSpan={10} className="!p-0 bg-app-bg">
                          {detail === 'loading' ? (
                            <div className="p-4 text-text-muted">Loading items…</div>
                          ) : (
                            <div className="p-4">
                              {detail.remarks?.trim() && <p className="mb-2 text-[13px]"><strong>Remarks:</strong> {detail.remarks}</p>}
                              <table className="w-full text-[13px] bg-white border border-border rounded-lg">
                                <thead className="text-[12px] text-text-secondary">
                                  <tr className="border-b border-border">
                                    <th className="text-left p-2">#</th><th className="text-left p-2">Item</th><th className="text-left p-2">Code</th>
                                    <th className="text-left p-2">Barcode</th><th className="text-right p-2">Qty</th>
                                    {detail.received_at && <th className="text-right p-2">Received</th>}
                                    <th className="text-right p-2">Cost ₹</th><th className="text-right p-2">MRP ₹</th>
                                    <th className="text-right p-2">Cost value ₹</th><th className="text-right p-2">MRP value ₹</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detail.items.map((it, i) => (
                                    <tr key={i} className="border-b border-border-table">
                                      <td className="p-2">{i + 1}</td>
                                      <td className="p-2 font-medium">{it.name}</td>
                                      <td className="p-2 font-mono">{it.item_code || '—'}</td>
                                      <td className="p-2 font-mono">{it.barcode || '—'}</td>
                                      <td className="p-2 text-right font-mono">{qty(it.qty)} {it.unit}</td>
                                      {detail.received_at && (
                                        <td className={`p-2 text-right font-mono ${Number(it.received_qty) !== Number(it.qty) ? 'text-[#A3261E] font-semibold' : ''}`}>{qty(it.received_qty)}</td>
                                      )}
                                      <td className="p-2 text-right font-mono">{n2(it.cost_price)}</td>
                                      <td className="p-2 text-right font-mono">{n2(it.mrp)}</td>
                                      <td className="p-2 text-right font-mono">{n2(it.total_val)}</td>
                                      <td className="p-2 text-right font-mono">{n2(Number(it.qty) * Number(it.mrp))}</td>
                                    </tr>
                                  ))}
                                  <tr className="font-semibold">
                                    <td className="p-2" colSpan={4}>Subtotal ({detail.items.length} items)</td>
                                    <td className="p-2 text-right font-mono">{qty(r.total_qty)}</td>
                                    {detail.received_at && <td className="p-2 text-right font-mono">{qty(r.received_qty)}</td>}
                                    <td></td><td></td>
                                    <td className="p-2 text-right font-mono">{n2(r.cost_value)}</td>
                                    <td className="p-2 text-right font-mono">{n2(r.mrp_value)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {data && !data.items.length && (
                <tr><td colSpan={11} className="text-center py-10 text-text-muted">{loading ? 'Loading…' : 'No transfers found for these filters.'}</td></tr>
              )}
              {!data && (
                <tr><td colSpan={11} className="text-center py-10 text-text-muted">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {receiving && (
          <ReceiveDialog trf={receiving} onClose={() => setReceiving(null)}
            onDone={() => { setOpen(({ [receiving.id]: _, ...rest }) => rest); setReceiving(null); load() }} />
        )}

        {data && data.total > PER_PAGE && (
          <div className="flex items-center justify-end gap-3 text-[14px]">
            <span className="text-text-secondary">Page {page} of {pages}</span>
            <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <button className="btn btn-secondary" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}

function ReceiveDialog({ trf, onClose, onDone }: { trf: transfer_print & { id: number }; onClose: () => void; onDone: () => void }) {
  // default: everything arrived as sent; staff correct only the lines that differ
  const [got, setGot] = useState<Record<number, string>>(() => Object.fromEntries(trf.items.map(i => [i.id!, String(Number(i.qty))])))
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [scan, setScan] = useState('')
  const box = useRef<HTMLDivElement>(null)

  const diff = trf.items.filter(i => Number(got[i.id!] || 0) !== Number(i.qty))

  function findLine() {
    const code = scan.trim().toLowerCase()
    const hit = trf.items.find(i => [i.barcode, i.item_code].some(c => c && c.toLowerCase() === code))
    setScan('')
    if (!hit) return toast.error('Item is not on this transfer')
    const el = box.current?.querySelector<HTMLInputElement>(`[data-recv="${hit.id}"]`)
    el?.focus(); el?.select()
  }

  async function submit() {
    if (diff.length && !remarks.trim()) return toast.error('Add a remark explaining the difference')
    setSaving(true)
    try {
      const res = await inventory_api.receiveTransfer(trf.id, {
        lines: trf.items.map(i => ({ item_id: i.id!, received_qty: Number(got[i.id!] || 0) })),
        remarks: remarks.trim() || undefined,
      })
      toast.success(res.message)
      onDone()
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Receive failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open title={`Receive ${trf.transfer_no}`} onClose={onClose} width="max-w-3xl">
      <div ref={box} className="flex flex-col gap-4">
        <p className="m-0 text-[14px] text-text-secondary">
          From <strong className="text-text-primary">{trf.from?.name}</strong> to <strong className="text-text-primary">{trf.to?.name}</strong> · sent {dmy(trf.transfer_date)}
        </p>
        <label className="block">
          <span className="form-label">Scan to jump to an item</span>
          <input className="form-input font-mono" placeholder="Barcode or item code, then Enter" value={scan} autoFocus
            onChange={e => setScan(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); findLine() } }} />
        </label>
        <table className="w-full text-[13px] border border-border rounded-lg">
          <thead className="text-[12px] text-text-secondary">
            <tr className="border-b border-border">
              <th className="text-left p-2">Item</th><th className="text-right p-2">Sent</th>
              <th className="text-right p-2 w-32">Received</th><th className="text-right p-2">Diff</th>
            </tr>
          </thead>
          <tbody>
            {trf.items.map(i => {
              const d = Number(got[i.id!] || 0) - Number(i.qty)
              return (
                <tr key={i.id} className="border-b border-border-table">
                  <td className="p-2"><div className="font-medium">{i.name}</div><div className="font-mono text-[11px] text-text-muted">{i.item_code} · {i.barcode}</div></td>
                  <td className="p-2 text-right font-mono">{qty(i.qty)}</td>
                  <td className="p-2 text-right">
                    <input type="number" min={0} step="any" data-recv={i.id} aria-label={`Received qty for ${i.name}`}
                      className="form-input !h-9 w-28 text-right font-mono" value={got[i.id!]}
                      onChange={e => setGot(g => ({ ...g, [i.id!]: e.target.value }))} />
                  </td>
                  <td className={`p-2 text-right font-mono font-semibold ${d < 0 ? 'text-[#A3261E]' : d > 0 ? 'text-[#2B4C9B]' : 'text-text-muted'}`}>
                    {d === 0 ? '—' : (d > 0 ? '+' : '') + qty(d)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <label className="block">
          <span className="form-label">Remarks {diff.length > 0 && <span className="text-[#A3261E]">(required: {diff.length} line{diff.length > 1 ? 's' : ''} differ)</span>}</span>
          <textarea className="form-input !h-20 py-2" value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. 1 can damaged in transit" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
            <i className="fas fa-check"></i> {diff.length ? 'Receive with difference' : 'Receive all as sent'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
