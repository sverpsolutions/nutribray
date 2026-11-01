import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { products_api, type product_search_item } from '../../api/products'
import { masters_api, type category_type, type brand_type, type unit_type, type gst_type } from '../../api/masters'
import ProductSearchInput from '../../components/ProductSearchInput'
import ChannelPricingModal from '../../components/ChannelPricingModal'


interface form_state {
  name: string; item_code: string; category: string; category_id: string
  brand: string; brand_id: string; hsn_id: string; hsn_code: string
  unit: string; unit_id: string; carton_size: string
  purchase_price: string; cost_price: string; selling_price: string
  wsp: string; mrp: string; gst_percent: string
  barcode: string; description: string; rack_no: string
  low_stock_threshold: string; min_stock: string; reorder_level: string
  allow_neg_stock: boolean; is_consumable: boolean; is_raw_material: boolean
  is_dual_unit: boolean; is_sellable: boolean; is_asset: boolean
}

const empty: form_state = {
  name: '', item_code: '', category: '', category_id: '',
  brand: '', brand_id: '', hsn_id: '', hsn_code: '',
  unit: 'PCS', unit_id: '', carton_size: '1',
  purchase_price: '0', cost_price: '0', selling_price: '0',
  wsp: '0', mrp: '0', gst_percent: '0',
  barcode: '', description: '', rack_no: '',
  low_stock_threshold: '5', min_stock: '0', reorder_level: '0',
  allow_neg_stock: false, is_consumable: false, is_raw_material: false,
  is_dual_unit: false, is_sellable: true, is_asset: false,
}

export default function product_form_page() {
  const { id } = useParams<{ id: string }>()
  const is_edit = Boolean(id)
  const navigate = useNavigate()

  const [form, set_form] = useState<form_state>(empty)
  const [categories, set_categories] = useState<category_type[]>([])
  const [brands, set_brands] = useState<brand_type[]>([])
  const [units, set_units] = useState<unit_type[]>([])
  const [gst_rates, set_gst_rates] = useState<gst_type[]>([])
  const [saving, set_saving] = useState(false)
  const [error, set_error] = useState('')
  const [showChannelModal, setShowChannelModal] = useState(false)


  useEffect(() => {
    // load dropdowns in parallel
    Promise.all([
      masters_api.get_categories(),
      masters_api.get_brands(),
      masters_api.get_units(),
      masters_api.get_gst(),
    ]).then(([cats, brs, uts, gst]) => {
      set_categories(cats.data)
      set_brands(brs.data)
      set_units(uts.data)
      set_gst_rates(gst.data)
    })

    if (is_edit) {
      products_api.get(Number(id)).then(res => {
        const p = res.data
        set_form({
          name: p.name, item_code: p.item_code ?? '', category: p.category,
          category_id: String(p.category_id ?? ''), brand: p.brand ?? '',
          brand_id: String(p.brand_id ?? ''), hsn_id: String(p.hsn_id ?? ''),
          hsn_code: p.hsn_code ?? '', unit: p.unit, unit_id: String(p.unit_id ?? ''),
          carton_size: '1', purchase_price: p.purchase_price, cost_price: p.cost_price,
          selling_price: p.selling_price, wsp: p.wsp, mrp: p.mrp, gst_percent: p.gst_percent,
          barcode: p.barcode ?? '', description: '', rack_no: p.rack_no ?? '',
          low_stock_threshold: String(p.low_stock_threshold), min_stock: p.min_stock,
          reorder_level: p.reorder_level, allow_neg_stock: p.allow_neg_stock,
          is_consumable: p.is_consumable, is_raw_material: p.is_raw_material,
          is_dual_unit: p.is_dual_unit, is_sellable: p.is_sellable, is_asset: p.is_asset,
        })
      })
    }
  }, [id])

  function field(key: keyof form_state, val: string | boolean) {
    set_form(f => ({ ...f, [key]: val }))
  }

  function on_category_change(cat_id: string) {
    const cat = categories.find(c => String(c.id) === cat_id)
    set_form(f => ({ ...f, category_id: cat_id, category: cat?.name ?? '' }))
  }

  function on_brand_change(bid: string) {
    const b = brands.find(x => String(x.id) === bid)
    set_form(f => ({ ...f, brand_id: bid, brand: b?.name ?? '' }))
  }

  function on_product_select(p: product_search_item) {
    set_form(f => ({
      ...f,
      name: p.name,
      item_code: p.item_code ?? f.item_code,
      barcode: p.barcode ?? f.barcode,
      selling_price: String(p.selling_price ?? f.selling_price),
      mrp: String(p.mrp ?? f.mrp),
      unit: p.unit ?? f.unit,
    }))
    // navigate to edit if we picked a different product
    if (!is_edit && p.id) {
      navigate(`/products/edit/${p.id}`)
    }
  }

  async function handle_submit(e: React.FormEvent) {
    e.preventDefault()
    set_saving(true); set_error('')
    try {
      const payload = {
        ...form,
        category_id: form.category_id ? Number(form.category_id) : null,
        brand_id: form.brand_id ? Number(form.brand_id) : null,
        hsn_id: form.hsn_id ? Number(form.hsn_id) : null,
        unit_id: form.unit_id ? Number(form.unit_id) : null,
        carton_size: Number(form.carton_size),
        purchase_price: Number(form.purchase_price),
        cost_price: Number(form.cost_price),
        selling_price: Number(form.selling_price),
        wsp: Number(form.wsp),
        mrp: Number(form.mrp),
        gst_percent: Number(form.gst_percent),
        low_stock_threshold: Number(form.low_stock_threshold),
        min_stock: Number(form.min_stock),
        reorder_level: Number(form.reorder_level),
        barcode: form.barcode || null,
      }
      if (is_edit) {
        await products_api.update(Number(id), payload)
      } else {
        await products_api.create(payload)
      }
      navigate('/products/item-master')
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string | { msg: string }[] } } })?.response?.data?.detail
      set_error(Array.isArray(detail) ? detail.map(d => d.msg).join(', ') : String(detail ?? 'error saving'))
    } finally { set_saving(false) }
  }

  const section = (title: string) => (
    <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mt-6 mb-3 pb-1 border-b">{title}</h3>
  )
  const inp = (label: string, key: keyof form_state, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={form[key] as string}
        onChange={e => field(key, e.target.value)} placeholder={placeholder}
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  )
  const chk = (label: string, key: keyof form_state) => (
    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
      <input type="checkbox" checked={form[key] as boolean}
        onChange={e => field(key, e.target.checked)}
        className="rounded border-gray-300 text-blue-600" />
      {label}
    </label>
  )

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-800 dark:text-white">
          {is_edit ? `Edit Product #${id}` : 'Add Product'}
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {is_edit ? 'Update product details below' : 'Fill in the details to create a new product'}
        </p>
      </div>

      <form onSubmit={handle_submit} className="bg-white rounded-xl shadow p-6">
        {/* Smart search — type name / item code / barcode to find & load a product */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Quick Search</label>
          <ProductSearchInput
            onSelect={on_product_select}
            placeholder="Type name, item code, EAN / UPC / CRT barcode…"
          />
          <p className="text-xs text-gray-400 mt-1">↑↓ to navigate · Enter to select · Esc to close</p>
        </div>
        {section('Basic Info')}
        <div className="grid grid-cols-2 gap-4">
          {inp('Product Name *', 'name', 'text', 'e.g. Rohu Fish')}
          {inp('Item Code', 'item_code', 'text', 'Auto-generated if empty')}
        </div>
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
            <select value={form.category_id} onChange={e => on_category_change(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Select Category —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
            <select value={form.brand_id} onChange={e => on_brand_change(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Select Brand —</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mt-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unit *</label>
            <select value={form.unit_id} onChange={e => {
              const u = units.find(x => String(x.id) === e.target.value)
              set_form(f => ({ ...f, unit_id: e.target.value, unit: u?.unit_code ?? f.unit }))
            }}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Select Unit —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.unit_code} – {u.unit_name}</option>)}
            </select>
          </div>
          {inp('Carton Size', 'carton_size', 'number', '1')}
          {inp('Barcode', 'barcode', 'text', 'Auto-generated if empty')}
        </div>

        {section('Pricing & GST')}
        <div className="grid grid-cols-3 gap-4">
          {inp('Purchase Price', 'purchase_price', 'number')}
          {inp('Cost Price', 'cost_price', 'number')}
          {inp('Selling Price', 'selling_price', 'number')}
          {inp('WSP', 'wsp', 'number')}
          {inp('MRP', 'mrp', 'number')}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GST %</label>
            <select value={form.gst_percent} onChange={e => field('gst_percent', e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="0">0%</option>
              {gst_rates.map(g => <option key={g.id} value={g.gst_percent}>{g.tax_name} ({g.gst_percent}%)</option>)}
            </select>
          </div>
        </div>

        {is_edit && (
          <div className="mt-4">
             <button 
                type="button"
                onClick={() => setShowChannelModal(true)}
                className="w-full py-3 bg-indigo-50 text-indigo-600 rounded-xl font-black text-[10px] uppercase tracking-[0.2em] border border-indigo-100 hover:bg-indigo-100 transition-all flex items-center justify-center gap-3"
             >
                <i className="fas fa-handshake text-lg"></i> Manage Online Channel Rates (Facebook, Amazon, etc.)
             </button>
          </div>
        )}


        {section('Inventory Settings')}
        <div className="grid grid-cols-3 gap-4">
          {inp('Low Stock Threshold', 'low_stock_threshold', 'number')}
          {inp('Min Stock', 'min_stock', 'number')}
          {inp('Reorder Level', 'reorder_level', 'number')}
          {inp('Rack No.', 'rack_no', 'text', 'e.g. A-01')}
        </div>

        {section('Flags')}
        <div className="flex flex-wrap gap-6">
          {chk('Allow Negative Stock', 'allow_neg_stock')}
          {chk('Dual Unit Product', 'is_dual_unit')}
          {chk('Consumable', 'is_consumable')}
          {chk('Raw Material', 'is_raw_material')}
          {chk('Sellable', 'is_sellable')}
          {chk('Asset', 'is_asset')}
        </div>

        {section('Description')}
        <textarea value={form.description} onChange={e => field('description', e.target.value)}
          rows={3} placeholder="Optional product description…"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3 mt-6">
          <button type="submit" disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : is_edit ? 'Update Product' : 'Create Product'}
          </button>
          <button type="button" onClick={() => navigate('/products/item-master')}
            className="px-6 py-2.5 border text-gray-600 rounded-lg text-sm hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>

      {showChannelModal && id && (
        <ChannelPricingModal 
          product_id={Number(id)}
          product_name={form.name}
          base_cost={form.cost_price}
          onClose={() => setShowChannelModal(false)}
        />
      )}
    </div>

  )
}
