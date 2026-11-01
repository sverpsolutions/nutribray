// Stock as at a date & time: "how much did we have at 2:10 pm?" — worked back from today's stock and every
// movement recorded after that moment (server: /stock-reports/as-at). Times are Indian time.
import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import api from '../../api/axios'
import { masters_api } from '../../api/masters'

type Row = { id: number; item_code: string | null; item_name: string; category: string | null; unit: string | null
  current_stock: number; in_after: number; out_after: number; stock_at: number; cost_price: number; mrp: number
  value_cost: number; value_mrp: number }
type Res = { as_at: string; summary: Record<string, number>; rows: Row[] }

const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
const inr = (v: number) => '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const qty = (v: number) => Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 })
const errMsg = (e: any) => e?.response?.data?.detail || e?.message || 'Something went wrong'
const label = (d: string, t: string) => new Date(`${d}T${t}`).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

export default function StockAsAtReport() {
  const [on, setOn] = useState(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`)
  const [at, setAt] = useState(`${pad(now.getHours())}:${pad(now.getMinutes())}`)
  const [outletId, setOutletId] = useState('')
  const [catId, setCatId] = useState('')
  const [search, setSearch] = useState('')
  const [showZero, setShowZero] = useState(false)
  const [outlets, setOutlets] = useState<{ id: number; outlet_name: string }[]>([])
  const [cats, setCats] = useState<{ id: number; name: string }[]>([])
  const [data, setData] = useState<Res | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    masters_api.get_outlets().then(r => setOutlets(r.data || [])).catch(() => {})
    masters_api.get_item_categories().then(r => setCats((r.data as any[]) || [])).catch(() => {})
    run()
  }, [])

  async function run() {
    setLoading(true)
    try {
      const params: Record<string, string | boolean> = { on, at, show_zero: showZero }
      if (outletId) params.outlet_id = outletId
      if (catId) params.category_id = catId
      if (search.trim()) params.search = search.trim()
      setData((await api.get<Res>('/stock-reports/as-at', { params })).data)
    } catch (e) { toast.error(errMsg(e)) } finally { setLoading(false) }
  }

  function exportCsv() {
    if (!data) return
    const head = ['Item code', 'Item', 'Category', 'Unit', `Stock at ${data.as_at}`, 'In after', 'Out after', 'Stock now', 'Cost', 'Value at cost', 'MRP', 'Value at MRP']
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [head, ...data.rows.map(r => [r.item_code, r.item_name, r.category, r.unit, r.stock_at, r.in_after, r.out_after, r.current_stock,
      r.cost_price, r.value_cost.toFixed(2), r.mrp, r.value_mrp.toFixed(2)])].map(l => l.map(esc).join(','))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }))
    a.download = `stock_as_at_${on}_${at.replace(':', '')}.csv`
    a.click()
  }

  const s = data?.summary
  const preset = (h: number, m: number) => setAt(`${pad(h)}:${pad(m)}`)

  return (
    <div className="space-y-4 pb-16">
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="bg-teal-600 text-white p-1 rounded"><i className="fas fa-clock" /></span>Stock as at Date &amp; Time</h1>
          <p className="text-[12px] text-slate-500 mt-1">How much stock was there at a given moment, e.g. today at 2:10 pm. Times are Indian time.</p>
        </div>
        <button className="btn btn-secondary" disabled={!data?.rows.length} onClick={exportCsv}><i className="fas fa-file-csv mr-2" />Export CSV</button>
      </div>

      <div className="bg-app-card border border-border rounded-fiori p-4 flex flex-wrap items-end gap-3">
        <div><label className="form-label">Date</label><input className="form-input" type="date" value={on} onChange={e => setOn(e.target.value)} /></div>
        <div><label className="form-label">Time</label><input className="form-input" type="time" value={at} onChange={e => setAt(e.target.value)} /></div>
        <div className="flex gap-1 pb-1">
          {[[10, 0, 'Opening 10:00'], [14, 0, '2:00 pm'], [18, 0, '6:00 pm'], [23, 59, 'Day end']].map(([h, m, l]) =>
            <button key={l as string} className="btn btn-secondary !py-1 !px-2 text-[12px]" onClick={() => preset(h as number, m as number)}>{l}</button>)}
        </div>
        <div><label className="form-label">Outlet</label>
          <select className="form-input !w-56" value={outletId} onChange={e => setOutletId(e.target.value)}>
            <option value="">All my outlets</option>{outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></div>
        <div><label className="form-label">Category</label>
          <select className="form-input !w-48" value={catId} onChange={e => setCatId(e.target.value)}>
            <option value="">All</option>{cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div><label className="form-label">Item</label>
          <input className="form-input !w-52" placeholder="Name, code or barcode" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} /></div>
        <label className="flex items-center gap-2 text-[13px] pb-2"><input type="checkbox" checked={showZero} onChange={e => setShowZero(e.target.checked)} />Show zero stock</label>
        <button className="btn btn-primary" disabled={loading} onClick={run}><i className="fas fa-search mr-2" />{loading ? 'Loading…' : 'Show stock'}</button>
      </div>

      {data && s && <>
        <div className="text-[13px] text-slate-600">Stock position at <b>{label(on, at)}</b>{outletId ? ` · ${outlets.find(o => String(o.id) === outletId)?.outlet_name}` : ''}</div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {([['Items in stock', String(s.items)], ['Qty at that time', qty(s.qty_at)], ['Qty now', qty(s.qty_now)],
             ['Received since', qty(s.in_after)], ['Sold / out since', qty(s.out_after)], ['Value at cost', inr(s.value_cost)]] as const).map(([k, v]) => (
            <div key={k} className="bg-app-card border border-border rounded-fiori p-3">
              <div className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">{k}</div>
              <div className="text-[18px] font-semibold tabular-nums">{v}</div></div>))}
        </div>
        {s.negative_items > 0 && <div className="rounded-lg bg-amber-50 text-amber-800 px-3 py-2 text-[12px]"><i className="fas fa-exclamation-triangle mr-1.5" />
          {s.negative_items} item(s) show negative stock at that time — usually stock sold before its GRN was entered.</div>}

        <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
          <table className="ent-table min-w-[1000px]">
            <thead><tr><th>Item</th><th>Category</th><th className="!text-right">Stock at {at}</th><th className="!text-right">In after</th>
              <th className="!text-right">Out after</th><th className="!text-right">Stock now</th><th className="!text-right">Value at cost</th><th className="!text-right">Value at MRP</th></tr></thead>
            <tbody>
              {!data.rows.length ? <tr><td colSpan={8} className="text-center text-text-muted !py-10">No stock found for this selection</td></tr>
                : data.rows.map(r => (
                  <tr key={r.id}>
                    <td><div className="font-semibold">{r.item_name}</div><div className="text-[11px] text-text-muted font-mono">{r.item_code}{r.unit ? ` · ${r.unit}` : ''}</div></td>
                    <td className="text-[12px]">{r.category}</td>
                    <td className={`!text-right font-bold tabular-nums ${r.stock_at < 0 ? 'text-red-600' : ''}`}>{qty(r.stock_at)}</td>
                    <td className="!text-right tabular-nums text-green-700">{r.in_after ? '+' + qty(r.in_after) : '—'}</td>
                    <td className="!text-right tabular-nums text-red-600">{r.out_after ? '−' + qty(r.out_after) : '—'}</td>
                    <td className="!text-right tabular-nums">{qty(r.current_stock)}</td>
                    <td className="!text-right tabular-nums">{inr(r.value_cost)}</td>
                    <td className="!text-right tabular-nums">{inr(r.value_mrp)}</td>
                  </tr>))}
            </tbody>
            {data.rows.length > 0 && <tfoot><tr className="font-bold">
              <td colSpan={2}>Total</td><td className="!text-right tabular-nums">{qty(s.qty_at)}</td><td className="!text-right tabular-nums">+{qty(s.in_after)}</td>
              <td className="!text-right tabular-nums">−{qty(s.out_after)}</td><td className="!text-right tabular-nums">{qty(s.qty_now)}</td>
              <td className="!text-right tabular-nums">{inr(s.value_cost)}</td><td className="!text-right tabular-nums">{inr(s.value_mrp)}</td></tr></tfoot>}
          </table>
        </div>
        <p className="text-[11px] text-slate-500">Stock at the chosen time = stock now − items received after it + items sold, transferred or adjusted out after it.</p>
      </>}
    </div>
  )
}
