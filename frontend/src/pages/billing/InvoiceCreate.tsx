import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { billing_api, type invoice_item_in } from '../../api/billing'
import { customers_api } from '../../api/customers'
import { products_api } from '../../api/products'
import PageHeader from '../../components/ui/PageHeader'

interface customer_opt { id: number; name: string }
interface product_opt  { id: number; name: string; item_code: string; sale_price: number; gst_percent: number; hsn_code: string; unit: string }

const empty_item = (): invoice_item_in => ({
  product_id: 0, item_code: '', name: '', qty: 1, pcs: 0,
  unit: 'PCS', rate: 0, disc_val: 0, disc_type: '₹', gst_percent: 0, hsn_code: '',
})

export default function invoice_create_page() {
  const nav = useNavigate()
  const today = new Date().toISOString().slice(0, 10)

  const [customers, set_customers] = useState<customer_opt[]>([])
  const [products, set_products]   = useState<product_opt[]>([])
  const [customer_id, set_customer_id] = useState(0)
  const [invoice_date, set_invoice_date] = useState(today)
  const [payment_mode, set_payment_mode] = useState('cash')
  const [is_interstate, set_is_interstate] = useState(false)
  const [cd_percent, set_cd_percent] = useState(0)
  const [notes, set_notes] = useState('')
  const [paid_amount, set_paid_amount] = useState(0)
  const [items, set_items] = useState<invoice_item_in[]>([empty_item()])
  const [saving, set_saving] = useState(false)
  const [error, set_error] = useState('')

  useEffect(() => {
    customers_api.list({ per_page: 200 }).then(r => set_customers(r.data.data))
    products_api.list({ per_page: 1000, is_active: true }).then(r => {
      const rows = r.data.data ?? []
      set_products(rows.map((p: any) => ({
        id: p.id, name: p.name, item_code: p.item_code,
        sale_price: Number(p.sale_price), gst_percent: Number(p.gst_percent),
        hsn_code: p.hsn_code ?? '', unit: p.unit ?? 'PCS',
      })))
    })
  }, [])

  function select_product(index: number, product_id: number) {
    const p = products.find(x => x.id === product_id)
    if (!p) return
    set_items(prev => prev.map((it, i) =>
      i === index ? {
        ...it, product_id: p.id, name: p.name, item_code: p.item_code,
        rate: p.sale_price, gst_percent: p.gst_percent, hsn_code: p.hsn_code, unit: p.unit,
      } : it
    ))
  }

  function update_item(index: number, field: keyof invoice_item_in, value: unknown) {
    set_items(prev => prev.map((it, i) =>
      i === index ? { ...it, [field]: value } : it
    ))
  }

  function add_row() { set_items(p => [...p, empty_item()]) }
  function remove_row(i: number) { set_items(p => p.filter((_, idx) => idx !== i)) }

  // ── live totals ──────────────────────────────────────────────────────────
  function calc_item(it: invoice_item_in) {
    const gross = it.qty * it.rate
    const disc  = it.disc_type === '%' ? gross * it.disc_val / 100 : it.disc_val * it.qty
    const taxable = (gross - disc) * (1 - cd_percent / 100)  // CD comes off before GST (billing_service)
    const half = it.gst_percent / 2
    const cgst = is_interstate ? 0 : taxable * half / 100
    const sgst = is_interstate ? 0 : taxable * half / 100
    const igst = is_interstate ? taxable * it.gst_percent / 100 : 0
    return { taxable, cgst, sgst, igst, total: taxable + cgst + sgst + igst }
  }

  const calc_rows    = items.map(calc_item)
  const sum_taxable  = calc_rows.reduce((a, r) => a + r.taxable, 0)
  const sum_cgst     = calc_rows.reduce((a, r) => a + r.cgst, 0)
  const sum_sgst     = calc_rows.reduce((a, r) => a + r.sgst, 0)
  const sum_igst     = calc_rows.reduce((a, r) => a + r.igst, 0)
  const grand_total  = sum_taxable + sum_cgst + sum_sgst + sum_igst
  const cd_amount    = cd_percent > 0 && cd_percent < 100 ? grand_total * cd_percent / (100 - cd_percent) : 0  // saving incl. GST
  const due          = grand_total - paid_amount

  async function submit() {
    if (!customer_id) { set_error('Select a customer'); return }
    const valid_items = items.filter(it => it.product_id > 0 && it.qty > 0 && it.rate > 0)
    if (!valid_items.length) { set_error('Add at least one item'); return }
    set_saving(true); set_error('')
    try {
      const res = await billing_api.create_invoice({
        customer_id, invoice_date, payment_mode, is_interstate,
        cd_percent, notes, paid_amount,
        items: valid_items,
      })
      nav(`/billing/invoices/${res.data.id}`)
    } catch (e: any) {
      set_error(e.response?.data?.detail ?? 'Error saving invoice')
      set_saving(false)
    }
  }

  return (
    <div>
      <PageHeader title="New Invoice" subtitle="Create sales invoice" />

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}

      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* customer */}
        <div className="bg-white rounded-xl shadow p-4 col-span-2">
          <p className="text-xs font-medium text-gray-500 mb-3 uppercase">Invoice Details</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Customer *</label>
              <select value={customer_id} onChange={e => set_customer_id(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value={0}>Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Invoice Date *</label>
              <input type="date" value={invoice_date} onChange={e => set_invoice_date(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Payment Mode</label>
              <select value={payment_mode} onChange={e => set_payment_mode(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {['cash','card','upi','bank_transfer','credit'].map(m => (
                  <option key={m} value={m}>{m.replace('_', ' ').toUpperCase()}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">CD% (Cash Discount)</label>
              <input type="number" min={0} max={100} step={0.01} value={cd_percent}
                onChange={e => set_cd_percent(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <input type="text" value={notes} onChange={e => set_notes(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional notes…" />
            </div>
            <div className="flex items-center gap-2 col-span-2">
              <input type="checkbox" id="interstate" checked={is_interstate}
                onChange={e => set_is_interstate(e.target.checked)}
                className="w-4 h-4 accent-blue-600" />
              <label htmlFor="interstate" className="text-sm text-gray-700">Inter-state sale (IGST applies)</label>
            </div>
          </div>
        </div>

        {/* summary card */}
        <div className="bg-white rounded-xl shadow p-4">
          <p className="text-xs font-medium text-gray-500 mb-3 uppercase">Summary</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Taxable</span><span>₹{sum_taxable.toFixed(2)}</span></div>
            {!is_interstate && <>
              <div className="flex justify-between"><span className="text-gray-500">CGST</span><span>₹{sum_cgst.toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">SGST</span><span>₹{sum_sgst.toFixed(2)}</span></div>
            </>}
            {is_interstate && <div className="flex justify-between"><span className="text-gray-500">IGST</span><span>₹{sum_igst.toFixed(2)}</span></div>}
            {cd_percent > 0 && <div className="flex justify-between text-orange-600"><span>CD ({cd_percent}%)</span><span>−₹{cd_amount.toFixed(2)}</span></div>}
            <div className="border-t pt-2 flex justify-between font-bold text-lg">
              <span>Total</span><span>₹{grand_total.toFixed(2)}</span>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Paid Amount</label>
              <input type="number" min={0} step={0.01} value={paid_amount}
                onChange={e => set_paid_amount(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className={`flex justify-between font-semibold ${due > 0 ? 'text-red-600' : 'text-green-600'}`}>
              <span>Due</span><span>₹{due.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* items table */}
      <div className="bg-white rounded-xl shadow overflow-x-auto mb-6">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <p className="font-medium text-gray-700 text-sm">Items</p>
          <button onClick={add_row}
            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700">
            + Add Row
          </button>
        </div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left w-40">Product</th>
              <th className="px-3 py-2 text-left w-20">Code</th>
              <th className="px-3 py-2 text-right w-16">Qty</th>
              <th className="px-3 py-2 text-left w-14">Unit</th>
              <th className="px-3 py-2 text-right w-20">Rate</th>
              <th className="px-3 py-2 text-right w-20">Disc</th>
              <th className="px-3 py-2 text-left w-12">Type</th>
              <th className="px-3 py-2 text-right w-16">GST%</th>
              <th className="px-3 py-2 text-right w-20">Taxable</th>
              <th className="px-3 py-2 text-right w-20">Total</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((it, i) => {
              const c = calc_item(it)
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <select value={it.product_id} onChange={e => select_product(i, Number(e.target.value))}
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                      <option value={0}>Select…</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-500">{it.item_code}</td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step={0.001} value={it.qty}
                      onChange={e => update_item(i, 'qty', Number(e.target.value))}
                      className="w-full border rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-3 py-2 text-gray-500">{it.unit}</td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step={0.01} value={it.rate}
                      onChange={e => update_item(i, 'rate', Number(e.target.value))}
                      className="w-full border rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step={0.01} value={it.disc_val}
                      onChange={e => update_item(i, 'disc_val', Number(e.target.value))}
                      className="w-full border rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-3 py-2">
                    <select value={it.disc_type} onChange={e => update_item(i, 'disc_type', e.target.value)}
                      className="border rounded px-1 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                      <option value="₹">₹</option>
                      <option value="%">%</option>
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{it.gst_percent}%</td>
                  <td className="px-3 py-2 text-right text-gray-700">₹{c.taxable.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right font-semibold">₹{c.total.toFixed(2)}</td>
                  <td className="px-3 py-2">
                    {items.length > 1 && (
                      <button onClick={() => remove_row(i)}
                        className="text-red-400 hover:text-red-600 text-base leading-none">✕</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-3 justify-end">
        <button onClick={() => nav('/billing/invoices')}
          className="px-5 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button onClick={submit} disabled={saving}
          className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : '💾 Save Invoice'}
        </button>
      </div>
    </div>
  )
}
