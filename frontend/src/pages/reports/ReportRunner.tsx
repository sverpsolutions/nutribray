// One screen for every report-engine report (/reports/x/{key}): the filters the report asks for, a sortable table
// with totals, Excel export, print, and the report's own downloads (GSTR-1 JSON, Tally XML) or upload (GSTR-2B).
import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../../api/axios'
import { masters_api } from '../../api/masters'
import { suppliers_api } from '../../api/suppliers'

export interface report_meta { key: string; title: string; group: string; module: string; filters: string[]; note: string
  bill_level: boolean; download: 'gstr1' | 'tally' | null; upload: boolean }
type Col = { key: string; label: string; type: 'text' | 'num' | 'qty' | 'money' | 'pct' | 'date' }
type Res = { key: string; title: string; columns: Col[]; rows: Record<string, any>[]; notes?: string[]; no_totals?: boolean }

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const today = new Date()
const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
const errMsg = (e: any) => { const d = e?.response?.data?.detail; return typeof d === 'string' ? d : e?.message || 'Something went wrong' }
const NUMERIC = new Set(['num', 'qty', 'money', 'pct'])
function fmt(v: any, t: Col['type']) {
  if (v === null || v === undefined || v === '') return ''
  if (t === 'money') return Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (t === 'qty') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 })
  if (t === 'num') return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })
  if (t === 'pct') return `${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`
  if (t === 'date' && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return new Date(String(v).slice(0, 10) + 'T00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  return String(v)
}
async function saveBlob(url: string, params: Record<string, any>, fallback: string) {
  const r = await api.get(url, { params, responseType: 'blob' })
  const name = /filename="([^"]+)"/.exec(r.headers['content-disposition'] || '')?.[1] || fallback
  const a = document.createElement('a'); a.href = URL.createObjectURL(r.data); a.download = name; a.click()
}

export default function ReportRunner() {
  const { key = '' } = useParams()
  const nav = useNavigate()
  const [meta, setMeta] = useState<report_meta | null>(null)
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(iso(today))
  const [month, setMonth] = useState(`${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}`)
  const [outletId, setOutletId] = useState('')
  const [catId, setCatId] = useState('')
  const [brandId, setBrandId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [search, setSearch] = useState('')
  const [userId, setUserId] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [opts, setOpts] = useState<{ outlets: any[]; cats: any[]; brands: any[]; suppliers: any[]; users: any[] }>({ outlets: [], cats: [], brands: [], suppliers: [], users: [] })
  const [data, setData] = useState<Res | null>(null)
  const [loading, setLoading] = useState(false)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const has = (f: string) => !!meta?.filters.includes(f)

  useEffect(() => {
    setData(null); setSort(null)
    api.get<report_meta[]>('/reports/x').then(r => setMeta(r.data.find(m => m.key === key) || null)).catch(e => toast.error(errMsg(e)))
  }, [key])
  useEffect(() => {
    if (!meta) return
    if (has('outlet')) masters_api.get_outlets().then(r => setOpts(o => ({ ...o, outlets: r.data || [] }))).catch(() => {})
    if (has('category')) masters_api.get_item_categories().then(r => setOpts(o => ({ ...o, cats: (r.data as any[]) || [] }))).catch(() => {})
    if (has('brand')) masters_api.get_brands().then(r => setOpts(o => ({ ...o, brands: (r.data as any[]) || [] }))).catch(() => {})
    if (has('supplier')) suppliers_api.list({ per_page: 500 }).then((r: any) => setOpts(o => ({ ...o, suppliers: r.data?.data || r.data || [] }))).catch(() => {})
    if (has('user')) api.get('/access/users').then(r => setOpts(o => ({ ...o, users: r.data || [] }))).catch(() => {})
    if (!meta.upload) run()
  }, [meta])

  const params = () => {
    const p: Record<string, any> = {}
    if (has('date')) { p.from_date = from; p.to_date = to }
    if (has('month')) p.month = month
    if (outletId) p.outlet_id = outletId
    if (catId) p.category_id = catId
    if (brandId) p.brand_id = brandId
    if (supplierId) p.supplier_id = supplierId
    if (search.trim()) p.search = search.trim()
    if (userId) p.user_id = userId
    return p
  }
  async function run() {
    setLoading(true)
    try {
      if (meta?.upload && file) {
        const fd = new FormData(); fd.append('file', file)
        setData((await api.post<Res>(`/reports/x/${key}`, fd, { params: params() })).data)
      } else setData((await api.get<Res>(`/reports/x/${key}`, { params: params() })).data)
    } catch (e) { toast.error(errMsg(e)) } finally { setLoading(false) }
  }

  const rows = useMemo(() => {
    if (!data || !sort) return data?.rows || []
    const c = data.columns.find(x => x.key === sort.key)
    return [...data.rows].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key]
      if (x == null) return 1
      if (y == null) return -1
      return (c && NUMERIC.has(c.type) ? Number(x) - Number(y) : String(x).localeCompare(String(y))) * sort.dir
    })
  }, [data, sort])
  const totals = useMemo(() => {
    if (!data || data.no_totals) return null
    const t: Record<string, number> = {}
    for (const c of data.columns) if (['money', 'qty'].includes(c.type) || (c.type === 'num' && !/days|credit_days|lead/.test(c.key)))
      t[c.key] = data.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)
    return t
  }, [data])

  async function exportExcel() {
    if (!data) return
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(data.title.slice(0, 30).replace(/[\\/?*[\]:]/g, ' '))
    ws.addRow([data.title]).font = { bold: true, size: 13 }
    ws.addRow([filterText()])
    ws.addRow([])
    const head = ws.addRow(data.columns.map(c => c.label)); head.font = { bold: true }
    head.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1E8F6' } } })
    for (const r of rows) ws.addRow(data.columns.map(c => r[c.key] == null ? null : NUMERIC.has(c.type) ? Number(r[c.key]) : String(r[c.key])))
    if (totals) { const tr = ws.addRow(data.columns.map((c, i) => i === 0 ? 'Total' : c.key in totals ? Number(totals[c.key].toFixed(2)) : null)); tr.font = { bold: true } }
    data.columns.forEach((c, i) => { const w = ws.getColumn(i + 1); w.width = Math.min(40, Math.max(10, c.label.length + 2)); if (c.type === 'money') w.numFmt = '#,##0.00' })
    const buf = await wb.xlsx.writeBuffer()
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([buf])); a.download = `${data.key}_${has('month') ? month : `${from}_${to}`}.xlsx`; a.click()
  }
  const filterText = () => [has('month') ? `Period ${month}` : has('date') ? `${from} to ${to}` : '',
    has('outlet') && (outletId ? opts.outlets.find(o => String(o.id) === outletId)?.outlet_name : 'All my outlets'),
    catId && opts.cats.find(c => String(c.id) === catId)?.name, brandId && opts.brands.find(b => String(b.id) === brandId)?.name,
    supplierId && opts.suppliers.find(s => String(s.id) === supplierId)?.name, userId && opts.users.find(u => String(u.id) === userId)?.name,
    search && `"${search}"`].filter(Boolean).join(' · ')
  const preset = (a: Date, b: Date) => { setFrom(iso(a)); setTo(iso(b)) }

  if (!meta) return <div className="p-10 text-center text-slate-500">{data === null ? 'Loading report…' : 'Report not found'}</div>

  return (
    <div className="space-y-4 pb-16 report-runner">
      <style>{`@media print { .no-print { display: none !important } .report-runner table { font-size: 10px } }`}</style>
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <button className="no-print text-[12px] text-slate-500 hover:text-slate-800 mb-1" onClick={() => nav('/reports')}><i className="fas fa-arrow-left mr-1" />Reports</button>
          <h1 className="text-xl font-bold">{meta.title}</h1>
          {meta.note && <p className="text-[12px] text-slate-500 mt-1 max-w-3xl">{meta.note}</p>}
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          {meta.download === 'gstr1' && <button className="btn btn-secondary" onClick={() => saveBlob('/reports/x/gstr1/json', { month, outlet_id: outletId || undefined }, `GSTR1_${month}.json`).catch(e => toast.error(errMsg(e)))}>
            <i className="fas fa-file-code mr-2" />GSTR-1 JSON</button>}
          {meta.download === 'tally' && <button className="btn btn-secondary" onClick={() => saveBlob('/reports/x/tally/xml', { from_date: from, to_date: to, outlet_id: outletId || undefined }, 'tally.xml').catch(e => toast.error(errMsg(e)))}>
            <i className="fas fa-file-export mr-2" />Tally XML</button>}
          <button className="btn btn-secondary" disabled={!data?.rows.length} onClick={() => exportExcel().catch(e => toast.error(errMsg(e)))}><i className="fas fa-file-excel mr-2" />Excel</button>
          <button className="btn btn-secondary" disabled={!data?.rows.length} onClick={() => window.print()}><i className="fas fa-print mr-2" />Print</button>
        </div>
      </div>

      <div className="bg-app-card border border-border rounded-fiori p-4 flex flex-wrap items-end gap-3 no-print">
        {has('date') && <>
          <div><label className="form-label">From</label><input className="form-input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="form-label">To</label><input className="form-input" type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div className="flex gap-1 pb-1">
            <button className="btn btn-secondary !py-1 !px-2 text-[12px]" onClick={() => preset(today, today)}>Today</button>
            <button className="btn btn-secondary !py-1 !px-2 text-[12px]" onClick={() => { const y = new Date(today); y.setDate(y.getDate() - 1); preset(y, y) }}>Yesterday</button>
            <button className="btn btn-secondary !py-1 !px-2 text-[12px]" onClick={() => preset(new Date(today.getFullYear(), today.getMonth(), 1), today)}>This month</button>
            <button className="btn btn-secondary !py-1 !px-2 text-[12px]" onClick={() => preset(lastMonth, new Date(today.getFullYear(), today.getMonth(), 0))}>Last month</button>
          </div></>}
        {has('month') && <div><label className="form-label">Return period</label><input className="form-input" type="month" value={month} onChange={e => setMonth(e.target.value)} /></div>}
        {has('outlet') && <div><label className="form-label">Outlet</label>
          <select className="form-input !w-56" value={outletId} onChange={e => setOutletId(e.target.value)}>
            <option value="">All my outlets</option>{opts.outlets.map(o => <option key={o.id} value={o.id}>{o.outlet_name}</option>)}</select></div>}
        {has('category') && <div><label className="form-label">Category</label>
          <select className="form-input !w-44" value={catId} onChange={e => setCatId(e.target.value)}>
            <option value="">All</option>{opts.cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        {has('brand') && <div><label className="form-label">Brand</label>
          <select className="form-input !w-44" value={brandId} onChange={e => setBrandId(e.target.value)}>
            <option value="">All</option>{opts.brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
        {has('supplier') && <div><label className="form-label">Supplier</label>
          <select className="form-input !w-52" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">All</option>{opts.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>}
        {has('user') && <div><label className="form-label">User</label>
          <select className="form-input !w-52" value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">All users</option>{opts.users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.username})</option>)}</select></div>}
        {has('search') && <div><label className="form-label">Search</label>
          <input className="form-input !w-48" placeholder="Item, bill, party…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()} /></div>}
        {meta.upload && <div><label className="form-label">GSTR-2B JSON file</label>
          <input className="form-input !w-64" type="file" accept=".json,application/json" onChange={e => setFile(e.target.files?.[0] || null)} /></div>}
        <button className="btn btn-primary" disabled={loading || (meta.upload && !file)} onClick={run}><i className="fas fa-play mr-2" />{loading ? 'Running…' : 'Run'}</button>
      </div>

      {data && <>
        <div className="text-[12px] text-slate-500">{filterText()} · {data.rows.length} row(s){data.notes?.length ? ' · ' + data.notes.join(' · ') : ''}</div>
        <div className="bg-app-card border border-border rounded-fiori overflow-x-auto">
          <table className="ent-table" style={{ minWidth: Math.max(700, data.columns.length * 110) }}>
            <thead><tr>{data.columns.map(c => (
              <th key={c.key} className={`cursor-pointer select-none whitespace-nowrap ${NUMERIC.has(c.type) ? '!text-right' : ''}`}
                onClick={() => setSort(s => ({ key: c.key, dir: s?.key === c.key && s.dir === 1 ? -1 : 1 }))}>
                {c.label}{sort?.key === c.key && <i className={`fas fa-sort-${sort.dir === 1 ? 'up' : 'down'} ml-1`} />}</th>))}</tr></thead>
            <tbody>
              {!rows.length ? <tr><td colSpan={data.columns.length} className="text-center text-text-muted !py-10">No data for this selection</td></tr>
                : rows.map((r, i) => <tr key={i}>{data.columns.map(c => (
                  <td key={c.key} className={`${NUMERIC.has(c.type) ? '!text-right tabular-nums' : ''} ${NUMERIC.has(c.type) && Number(r[c.key]) < 0 ? 'text-red-600' : ''} text-[12px] whitespace-nowrap`}>
                    {fmt(r[c.key], c.type)}</td>))}</tr>)}
            </tbody>
            {totals && rows.length > 0 && <tfoot><tr className="font-bold">{data.columns.map((c, i) => (
              <td key={c.key} className={`${NUMERIC.has(c.type) ? '!text-right tabular-nums' : ''} text-[12px]`}>
                {i === 0 ? 'Total' : c.key in totals ? fmt(totals[c.key], c.type) : ''}</td>))}</tr></tfoot>}
          </table>
        </div>
      </>}
    </div>
  )
}

/** Report Center section listing every engine report, grouped. */
export function EngineReportList() {
  const nav = useNavigate()
  const [list, setList] = useState<report_meta[]>([])
  useEffect(() => { api.get<report_meta[]>('/reports/x').then(r => setList(r.data)).catch(() => {}) }, [])
  const groups = [...new Set(list.map(r => r.group))]
  if (!list.length) return null
  return (
    <div className="space-y-4">
      {groups.map(g => (
        <div key={g}>
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">{g}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {list.filter(r => r.group === g).map(r => (
              <button key={r.key} onClick={() => nav(`/reports/r/${r.key}`)}
                className="text-left bg-white border border-slate-100 rounded-xl p-3 hover:border-slate-300 hover:shadow-sm transition-all">
                <div className="font-bold text-slate-800 text-[13px]">{r.title}</div>
                {r.note && <div className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{r.note}</div>}
              </button>))}
          </div>
        </div>))}
    </div>
  )
}
