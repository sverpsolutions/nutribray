import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'react-hot-toast'
import PageHeader from '../../components/ui/PageHeader'
import { purchase_returns_api, type grn_lookup, type pr_product } from '../../api/purchaseReturns'
import { suppliers_api } from '../../api/suppliers'
import { getCompanySettings } from '../../api/company'
import { printDebitNote } from '../../utils/printDebitNote'

const inr = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const errMsg = (e: any) => e?.response?.data?.detail || e?.message || 'Something went wrong'

interface Row { product_id: number; name: string; item_code: string | null; hsn_code: string | null; unit: string | null
  gst_percent: number; rate: number; ho_stock: number; max?: number; received?: number; returned?: number }

export default function PurchaseReturn() {
  const nav = useNavigate()
  const [mode, setMode] = useState<'grn' | 'direct'>('grn')
  const [grnNo, setGrnNo] = useState('')
  const [grn, setGrn] = useState<grn_lookup | null>(null)
  const [suppliers, setSuppliers] = useState<{ id: number; name: string }[]>([])
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [interstate, setInterstate] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [qty, setQty] = useState<Record<number, string>>({})
  const [rates, setRates] = useState<Record<number, string>>({})
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<pr_product[]>([])
  const [reason, setReason] = useState('')
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    suppliers_api.list({ per_page: 500 }).then(r => setSuppliers((r.data.data || []).map((s: any) => ({ id: s.id, name: s.name }))))
  }, [])

  function reset(m: 'grn' | 'direct') {
    setMode(m); setGrn(null); setRows([]); setQty({}); setRates({}); setSupplierId(''); setInterstate(false); setHits([]); setQ('')
  }

  async function findGrn() {
    if (!grnNo.trim()) return
    setBusy(true)
    try {
      const r = await purchase_returns_api.grn_lookup(grnNo.trim())
      setGrn(r.data); setInterstate(r.data.is_interstate); setQty({})
      setRows(r.data.lines.map(l => ({ ...l, max: Number(l.returnable_qty), received: Number(l.received_qty), returned: Number(l.returned_qty) })))
    } catch (e) { setGrn(null); setRows([]); toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  async function pickSupplier(id: number | '') {
    setSupplierId(id)
    if (id) purchase_returns_api.supplier_state(id).then(r => setInterstate(r.data.is_interstate))
  }

  useEffect(() => {
    if (mode !== 'direct' || q.trim().length < 2) { setHits([]); return }
    const t = setTimeout(() => purchase_returns_api.products(q.trim()).then(r => setHits(r.data)), 300)
    return () => clearTimeout(t)
  }, [q, mode])

  function addProduct(p: pr_product) {
    if (!rows.some(r => r.product_id === p.id)) setRows([...rows, { ...p, product_id: p.id, rate: Number(p.rate), ho_stock: Number(p.ho_stock), gst_percent: Number(p.gst_percent) }])
    setQty({ ...qty, [p.id]: qty[p.id] || '1' }); setQ(''); setHits([])
  }

  const lines = rows.map(r => {
    const n = Math.max(0, Math.min(Number(qty[r.product_id] || 0), r.max ?? Infinity))
    const rate = mode === 'direct' ? Number(rates[r.product_id] ?? r.rate) : Number(r.rate)
    const taxable = n * rate
    return { r, n, rate, taxable, gst: taxable * Number(r.gst_percent) / 100 }
  })
  const picked = lines.filter(l => l.n > 0)
  const taxable = picked.reduce((s, l) => s + l.taxable, 0)
  const gstTot = picked.reduce((s, l) => s + l.gst, 0)
  const negative = picked.filter(l => l.n > Number(l.r.ho_stock))
  const ready = (mode === 'grn' ? !!grn : !!supplierId) && picked.length > 0 && picked.every(l => l.rate > 0) && reason.trim().length >= 3 && !busy

  async function save() {
    if (!ready) return
    if (!confirm(`Create debit note for ${inr(taxable + gstTot)}?${negative.length ? `\n\n${negative.length} item(s) exceed HO stock — stock will go negative.` : ''}`)) return
    setBusy(true)
    try {
      const res = await purchase_returns_api.create({
        ...(mode === 'grn' ? { purchase_no: grn!.purchase_no } : { supplier_id: Number(supplierId) }),
        items: picked.map(l => ({ product_id: l.r.product_id, qty: l.n, ...(mode === 'direct' ? { rate: l.rate } : {}) })),
        reason: reason.trim(), return_date: returnDate, notes: notes.trim() || undefined,
      })
      toast.success(`Debit note ${res.data.prn_no} created`)
      const [dn, company] = await Promise.all([purchase_returns_api.get(res.data.id), getCompanySettings()])
      printDebitNote(dn.data, company)
      nav('/purchase-returns')
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  return (
    <div className="p-4 space-y-4">
      <PageHeader title="Purchase Return / Debit Note" subtitle="Send goods back to a supplier — stock leaves HO" />

      <div className="bg-white rounded-xl shadow p-4 space-y-3">
        <div className="flex gap-2 text-sm">
          {(['grn', 'direct'] as const).map(m => (
            <button key={m} onClick={() => reset(m)}
              className={`px-4 py-1.5 rounded-lg border ${mode === m ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
              {m === 'grn' ? 'Against GRN' : 'Direct (no GRN)'}
            </button>
          ))}
        </div>

        {mode === 'grn' ? (
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs text-gray-500 mb-1">GRN No *</label>
              <input value={grnNo} onChange={e => setGrnNo(e.target.value)} onKeyDown={e => e.key === 'Enter' && findGrn()} autoFocus
                placeholder="e.g. GRN-202610010001" className="w-full border rounded-lg px-3 py-2 text-sm font-mono" />
            </div>
            <button onClick={findGrn} disabled={busy || !grnNo.trim()}
              className="bg-blue-700 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-800 disabled:opacity-50">
              <i className="fas fa-search mr-1" /> Find GRN
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Supplier *</label>
              <select value={supplierId} onChange={e => pickSupplier(e.target.value ? Number(e.target.value) : '')}
                className="w-full border rounded-lg px-3 py-2 text-sm">
                <option value="">-- Select Supplier --</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="relative">
              <label className="block text-xs text-gray-500 mb-1">Add item (name / code / barcode)</label>
              <input value={q} onChange={e => setQ(e.target.value)} disabled={!supplierId} placeholder={supplierId ? 'e.g. maggi noodles' : 'Select supplier first'}
                className="w-full border rounded-lg px-3 py-2 text-sm" />
              {hits.length > 0 && (
                <div className="absolute z-20 bg-white border rounded-lg shadow-lg mt-1 w-full max-h-64 overflow-y-auto">
                  {hits.map(p => (
                    <button key={p.id} onClick={() => addProduct(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 border-b last:border-0">
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs text-gray-400 ml-2 font-mono">{p.item_code} · {inr(Number(p.rate))} · GST {Number(p.gst_percent)}%</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {grn && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[['GRN', grn.purchase_no], ['Supplier', grn.supplier?.name || '—'], ['Supplier Inv', grn.invoice_no || '—'],
            ['GRN Total', inr(Number(grn.total_amount))], ['GRN Due', inr(Number(grn.due_amount))]].map(([k, v]) => (
            <div key={k} className="bg-white rounded-xl shadow p-3"><p className="text-xs text-gray-500">{k}</p><p className="font-semibold text-gray-800 truncate">{v}</p></div>
          ))}
        </div>
      )}

      {rows.length > 0 && (<>
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <div className="px-4 py-3 border-b flex justify-between">
            <p className="font-semibold text-gray-700 text-sm">Items ({rows.length}) · {interstate ? 'IGST (interstate supplier)' : 'CGST + SGST'}</p>
            {mode === 'grn' && <button onClick={() => setQty(Object.fromEntries(rows.map(r => [r.product_id, String(r.max)])))} className="text-xs text-blue-700 hover:underline">Return all</button>}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-blue-50 text-gray-600 text-left">
              <tr>
                <th className="px-3 py-2">Item</th><th className="px-3 py-2">HSN</th>
                {mode === 'grn' && <><th className="px-3 py-2 text-right">Received</th><th className="px-3 py-2 text-right">Returned</th><th className="px-3 py-2 text-right">Returnable</th></>}
                <th className="px-3 py-2 text-right">HO Stock</th><th className="px-3 py-2 text-right">Rate (excl. GST)</th>
                <th className="px-3 py-2 text-right">Return Qty</th><th className="px-3 py-2 text-right">Amount</th>
                {mode === 'direct' && <th />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map(({ r, n, rate, taxable: t, gst }) => (
                <tr key={r.product_id} className={r.max === 0 ? 'opacity-50' : ''}>
                  <td className="px-3 py-2"><p className="font-medium text-gray-800">{r.name}</p>
                    <p className="text-xs text-gray-400 font-mono">{r.item_code} · GST {Number(r.gst_percent)}%</p></td>
                  <td className="px-3 py-2 font-mono text-xs">{r.hsn_code || '—'}</td>
                  {mode === 'grn' && <><td className="px-3 py-2 text-right">{r.received}</td><td className="px-3 py-2 text-right text-gray-500">{r.returned || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold">{r.max}</td></>}
                  <td className={`px-3 py-2 text-right ${n > Number(r.ho_stock) ? 'text-orange-600 font-semibold' : 'text-gray-500'}`}>{Number(r.ho_stock)}</td>
                  <td className="px-3 py-2 text-right">
                    {mode === 'direct'
                      ? <input type="number" min={0} step="0.01" value={rates[r.product_id] ?? String(r.rate)} onChange={e => setRates({ ...rates, [r.product_id]: e.target.value })}
                          className={`w-24 border rounded px-2 py-1 text-right ${rate <= 0 ? 'border-red-500' : ''}`} />
                      : inr(rate)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min={0} max={r.max} step="0.001" disabled={r.max === 0} value={qty[r.product_id] ?? ''} placeholder="0"
                      onChange={e => setQty({ ...qty, [r.product_id]: e.target.value })}
                      className={`w-24 border rounded px-2 py-1 text-right ${r.max !== undefined && Number(qty[r.product_id] || 0) > r.max ? 'border-red-500' : ''}`} />
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{n > 0 ? inr(t + gst) : '—'}</td>
                  {mode === 'direct' && <td className="px-2"><button onClick={() => setRows(rows.filter(x => x.product_id !== r.product_id))} className="text-gray-400 hover:text-red-600"><i className="fas fa-times" /></button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {negative.length > 0 && (
          <div className="bg-amber-50 border-l-4 border-amber-400 text-amber-800 text-sm px-4 py-2 rounded">
            <i className="fas fa-exclamation-triangle mr-1" /> {negative.length} item(s) exceed HO stock — HO stock will go negative (HO stock is not maintained yet).
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-white rounded-xl shadow p-4 space-y-3 md:col-span-2">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-500 mb-1">Return Date</label>
                <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">Reason *</label>
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Damaged, expired, short shelf life" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            </div>
            <div><label className="block text-xs text-gray-500 mb-1">Notes</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div className="bg-white rounded-xl shadow p-4 flex flex-col">
            <p className="text-xs text-gray-500">Debit note total (estimate)</p>
            <p className="text-3xl font-bold text-blue-700">{inr(taxable + gstTot)}</p>
            <p className="text-xs text-gray-500 mt-1">Taxable {inr(taxable)} + GST {inr(gstTot)}</p>
            {grn && Number(grn.due_amount) > 0 && <p className="text-xs text-gray-500">Reduces GRN payable (due {inr(Number(grn.due_amount))})</p>}
            <button onClick={save} disabled={!ready}
              className="mt-auto bg-blue-700 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-800 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save & Print Debit Note'}
            </button>
          </div>
        </div>
      </>)}
    </div>
  )
}
