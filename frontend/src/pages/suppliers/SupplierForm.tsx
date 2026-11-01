import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { suppliers_api } from '../../api/suppliers'
import PageHeader from '../../components/ui/PageHeader'
import { GstCheck } from '../retail/purchaseControls'

interface form_state {
  name: string; phone: string; supplier_code: string; supplier_type: string
  contact_name: string; email: string; address: string; city: string
  state: string; pincode: string; district: string; country: string
  gst_number: string; pan_number: string; opening_balance: string
  credit_limit_days: string; website: string; notes: string
}

const empty: form_state = {
  name: '', phone: '', supplier_code: '', supplier_type: 'L',
  contact_name: '', email: '', address: '', city: '',
  state: 'Delhi', pincode: '', district: '', country: 'India',
  gst_number: '', pan_number: '', opening_balance: '0',
  credit_limit_days: '0', website: '', notes: '',
}

const STATES = ['Delhi','Maharashtra','Gujarat','Rajasthan','Karnataka','Tamil Nadu','Uttar Pradesh','West Bengal','Madhya Pradesh','Punjab','Haryana','Bihar','Odisha','Telangana','Kerala']

export default function supplier_form_page() {
  const { id } = useParams<{ id: string }>()
  const is_edit = Boolean(id)
  const navigate = useNavigate()
  const [form, set_form] = useState<form_state>(empty)
  const [saving, set_saving] = useState(false)
  const [error, set_error] = useState('')

  useEffect(() => {
    if (is_edit) {
      suppliers_api.get(Number(id)).then(res => {
        const s = res.data
        set_form({
          name: s.name, phone: s.phone, supplier_code: s.supplier_code ?? '',
          supplier_type: s.supplier_type, contact_name: s.contact_name ?? '',
          email: s.email ?? '', address: s.address ?? '', city: s.city ?? '',
          state: s.state, pincode: s.pincode ?? '', district: s.district ?? '',
          country: 'India', gst_number: s.gst_number ?? '', pan_number: s.pan_number ?? '',
          opening_balance: s.opening_balance != null ? String(s.opening_balance) : '0', credit_limit_days: String(s.credit_limit_days),
          website: '', notes: s.notes ?? '',
        })
      })
    }
  }, [id])

  function field(key: keyof form_state, val: string) {
    set_form(f => ({ ...f, [key]: val }))
  }

  async function handle_submit(e: React.FormEvent) {
    e.preventDefault(); set_saving(true); set_error('')
    try {
      const payload = {
        ...form,
        opening_balance: Number(form.opening_balance),
        credit_limit_days: Number(form.credit_limit_days),
        gst_number: form.gst_number || null,
        pan_number: form.pan_number || null,
        email: form.email || null,
        city: form.city || null,
        pincode: form.pincode || null,
        district: form.district || null,
        notes: form.notes || null,
        website: form.website || null,
        contact_name: form.contact_name || null,
        supplier_code: form.supplier_code || null,
      }
      if (is_edit) await suppliers_api.update(Number(id), payload)
      else await suppliers_api.create(payload)
      navigate('/suppliers')
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string | { msg: string }[] } } })?.response?.data?.detail
      set_error(Array.isArray(detail) ? detail.map(d => d.msg).join(', ') : String(detail ?? 'error'))
    } finally { set_saving(false) }
  }

  const inp = (label: string, key: keyof form_state, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={form[key]} onChange={e => field(key, e.target.value)} placeholder={placeholder}
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  )
  const sec = (t: string) => <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mt-6 mb-3 pb-1 border-b">{t}</h3>

  return (
    <div className="max-w-3xl">
      <PageHeader title={is_edit ? 'Edit Supplier' : 'Add Supplier'} subtitle={is_edit ? `Editing #${id}` : 'Create new supplier'} />

      <form onSubmit={handle_submit} className="bg-white rounded-xl shadow p-6">
        {sec('Basic Info')}
        <div className="grid grid-cols-2 gap-4">
          {inp('Supplier Name *', 'name')}
          {inp('Phone *', 'phone', 'tel', '9XXXXXXXXX')}
          {inp('Supplier Code', 'supplier_code', 'text', 'Auto if empty')}
          {inp('Contact Person', 'contact_name')}
          {inp('Email', 'email', 'email')}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Type</label>
            <select value={form.supplier_type} onChange={e => field('supplier_type', e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="L">Local (Intra-state)</option>
              <option value="I">Interstate</option>
              <option value="U">Unregistered</option>
            </select>
          </div>
        </div>

        {sec('Address')}
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <textarea value={form.address} onChange={e => field('address', e.target.value)} rows={2}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {inp('City', 'city')}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <select value={form.state} onChange={e => field('state', e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {STATES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          {inp('Pincode', 'pincode')}
          {inp('District', 'district')}
        </div>

        {sec('GST & PAN')}
        <div className="grid grid-cols-2 gap-4">
          {inp('GST Number', 'gst_number', 'text', '07ABCDE1234F1Z5')}
          {inp('PAN Number', 'pan_number', 'text', 'ABCDE1234F')}
          <GstCheck gstin={form.gst_number} supplierId={id ? Number(id) : undefined}
            onFill={d => set_form(f => ({ ...f, name: f.name || d.name || '', address: f.address || d.address || '' }))} />
        </div>

        {sec('Financial & Terms')}
        <div className="grid grid-cols-2 gap-4">
          {inp('Opening Balance (₹)', 'opening_balance', 'number')}
          {inp('Credit Limit Days', 'credit_limit_days', 'number')}
          {inp('Website', 'website', 'url', 'https://…')}
        </div>

        {sec('Notes')}
        <textarea value={form.notes} onChange={e => field('notes', e.target.value)} rows={3}
          placeholder="Internal notes about this supplier…"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />

        {error && <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 mt-6">
          <button type="submit" disabled={saving}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium text-sm hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : is_edit ? 'Update Supplier' : 'Create Supplier'}
          </button>
          <button type="button" onClick={() => navigate('/suppliers')}
            className="px-6 py-2.5 border text-gray-600 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
        </div>
      </form>
    </div>
  )
}
