import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { billing_api, type estimate_item_in } from '../../api/billing'
import { customers_api } from '../../api/customers'
import { products_api } from '../../api/products'
import PageHeader from '../../components/ui/PageHeader'

interface customer_opt { id: number; name: string; phone: string }
interface product_opt  { id: number; name: string; item_code: string; sale_price: number; gst_percent: number }

const empty_row = (): estimate_item_in => ({
  product_id: undefined, item_code: '', description: '',
  qty: 1, unit: 'PCS', rate: 0, discount: 0, tax_percent: 0, cost_price: 0,
})

export default function estimate_create_page() {
  const nav = useNavigate()
  const today = new Date().toISOString().slice(0, 10)

  const [customers, set_customers]  = useState<customer_opt[]>([])
  const [products, set_products]    = useState<product_opt[]>([])
  const [customer_id, set_customer_id] = useState(0)
  const [customer_name, set_customer_name] = useState('')
  const [customer_mobile, set_customer_mobile] = useState('')
  const [estimate_date, set_estimate_date] = useState(today)
  const [valid_until, set_valid_until] = useState('')
  const [notes, set_notes] = useState('')
  const [items, set_items] = useState<estimate_item_in[]>([empty_row()])
  const [saving, set_saving] = useState(false)
  const [error, set_error] = useState('')

  useEffect(() => {
    customers_api.list({ per_page: 200 }).then(r => set_customers(r.data.data))
    products_api.list({ per_page: 1000, is_active: true }).then(r => {
      const rows = r.data.data ?? []
      set_products(rows.map((p: any) => ({
        id: p.id, name: p.name, item_code: p.item_code,
        sale_price: Number(p.sale_price), gst_percent: Number(p.gst_percent),
      })))
    })
  }, [])

  function select_customer(id: number) {
    set_customer_id(id)
    const c = customers.find(x => x.id === id)
    if (c) { set_customer_name(c.name); set_customer_mobile(c.phone) }
  }

  function select_product(index: number, product_id: number) {
    const p = products.find(x => x.id === product_id)
    if (!p) return
    set_items(prev => prev.map((it, i) =>
      i === index ? { ...it, product_id: p.id, description: p.name, item_code: p.item_code, rate: p.sale_price, tax_percent: p.gst_percent } : it
    ))
  }

  function update_item(index: number, field: keyof estimate_item_in, value: unknown) {
    set_items(prev => prev.map((it, i) => i === index ? { ...it, [field]: value } : it))
  }

  function add_row() { set_items(p => [...p, empty_row()]) }
  function remove_row(i: number) { set_items(p => p.filter((_, idx) => idx !== i)) }

  function calc(it: estimate_item_in) {
    const gross = it.qty * it.rate
    const taxable = gross - it.discount
    const tax = taxable * it.tax_percent / 100
    return { taxable, tax, total: taxable + tax }
  }

  const calc_rows    = items.map(calc)
  const grand_total  = calc_rows.reduce((a, r) => a + r.total, 0)

  async function submit() {
    if (!customer_id || !customer_name) { set_error('Select a customer'); return }
    const valid_items = items.filter(it => it.qty > 0 && it.rate > 0)
    if (!valid_items.length) { set_error('Add at least one item'); return }
    set_saving(true); set_error('')
    try {
      const res = await billing_api.create_estimate({
        customer_id, customer_name, customer_mobile: customer_mobile || undefined,
        estimate_date, valid_until: valid_until || undefined, notes,
        items: valid_items,
      })
      nav('/billing/estimates')
    } catch (e: any) {
      set_error(e.response?.data?.detail ?? 'Error saving estimate')
      set_saving(false)
    }
  }

  return (
    <div>
      <PageHeader title="New Estimate" subtitle="Create quotation / estimate" />

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl shadow p-4 col-span-2">
          <p className="text-xs font-medium text-gray-500 mb-3 uppercase">Estimate Details</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Customer *</label>
              <select value={customer_id} onChange={e => select_customer(Number(e.target.value))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value={0}>Select customer…</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mobile</label>
              <input type="text" value={customer_mobile} onChange={e => set_customer_mobile(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Estimate Date</label>
              <input type="date" value={estimate_date} onChange={e => set_estimate_date(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Valid Until</label>
              <input type="date" value={valid_until} onChange={e => set_valid_until(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <input type="text" value={notes} onChange={e => set_notes(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional notes…" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          <p className="text-xs font-medium text-gray-500 mb-3 uppercase">Summary</p>
          <div className="space-y-2 text-sm">
            {calc_rows.map((r, i) => items[i].description && (
              <div key={i} className="flex justify-between text-xs text-gray-600">
                <span className="truncate max-w-32">{items[i].description}</span>
                <span>₹{r.total.toFixed(2)}</span>
              </div>
            ))}
            <div className="border-t pt-2 flex justify-between font-bold text-lg">
              <span>Total</span><span>₹{grand_total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* items */}
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
              <th className="px-3 py-2 text-left w-48">Product</th>
              <th className="px-3 py-2 text-left">Description</th>
              <th className="px-3 py-2 text-right w-16">Qty</th>
              <th className="px-3 py-2 text-left w-14">Unit</th>
              <th className="px-3 py-2 text-right w-20">Rate</th>
              <th className="px-3 py-2 text-right w-20">Discount₹</th>
              <th className="px-3 py-2 text-right w-16">Tax%</th>
              <th className="px-3 py-2 text-right w-20">Total</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.map((it, i) => {
              const c = calc(it)
              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <select value={it.product_id ?? 0}
                      onChange={e => select_product(i, Number(e.target.value))}
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                      <option value={0}>Select…</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input type="text" value={it.description ?? ''} onChange={e => update_item(i, 'description', e.target.value)}
                      className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step={0.001} value={it.qty}
                      onChange={e => update_item(i, 'qty', Number(e.target.value))}
                      className="w-full border rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="text" value={it.unit} onChange={e => update_item(i, 'unit', e.target.value)}
                      className="w-16 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step={0.01} value={it.rate}
                      onChange={e => update_item(i, 'rate', Number(e.target.value))}
                      className="w-full border rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-3 py-2">
                    <input type="number" min={0} step={0.01} value={it.discount}
                      onChange={e => update_item(i, 'discount', Number(e.target.value))}
                      className="w-full border rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600">{it.tax_percent}%</td>
                  <td className="px-3 py-2 text-right font-semibold">₹{c.total.toFixed(2)}</td>
                  <td className="px-3 py-2">
                    {items.length > 1 && (
                      <button onClick={() => remove_row(i)} className="text-red-400 hover:text-red-600 text-base leading-none">✕</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-3 justify-end">
        <button onClick={() => nav('/billing/estimates')}
          className="px-5 py-2 text-sm border rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
        <button onClick={submit} disabled={saving}
          className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : '💾 Save Estimate'}
        </button>
      </div>
    </div>
  )
}
