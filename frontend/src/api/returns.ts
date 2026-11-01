import api from './axios'

export interface returnable_line {
  product_id: number
  ho_product_id: number | null
  item_code: string | null
  name: string
  unit: string | null
  hsn_code: string | null
  gst_percent: number
  sold_qty: number
  returned_qty: number
  returnable_qty: number
  paid: number
  unit_price: number
}

export interface bill_lookup {
  invoice_no: string
  invoice_date: string
  outlet_name: string | null
  total_amount: number
  due_amount: number
  is_interstate: boolean
  lines: returnable_line[]
}

export interface credit_note_row {
  id: number
  invoice_no: string
  invoice_date: string
  outlet_name: string | null
  ref_invoice_no: string | null
  return_reason: string | null
  refund_method: string | null
  taxable_amount: number
  total_gst: number
  total_amount: number
  status: string
  source: 'HO' | 'OUTLET'
}

export interface credit_note_item {
  name: string
  item_code: string | null
  hsn_code: string | null
  qty: number
  unit: string | null
  rate: number
  taxable_amt: number
  gst_percent: number
  cgst_percent: number
  sgst_percent: number
  igst_percent: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  total: number
}

export interface credit_note extends Omit<credit_note_row, 'outlet_name'> {
  outlet_name: string | null
  ref_invoice_date: string | null
  adjusted_amount: number
  is_interstate: boolean
  notes: string | null
  subtotal: number
  discount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  customer: { name: string; address: string | null; city: string | null; state: string | null; phone: string | null; gst_number: string | null } | null
  items: credit_note_item[]
}

export const returns_api = {
  lookup: (invoice_no: string) => api.get<bill_lookup>('/billing/returns/lookup', { params: { invoice_no } }),
  create: (data: {
    invoice_no: string
    items: { product_id: number; qty: number }[]
    reason: string
    refund_method: 'cash' | 'adjust'
    return_date?: string
    notes?: string
  }) => api.post<{ id: number; invoice_no: string; total_amount: number }>('/billing/returns', data),
  list: (params: object) => api.get<{ total: number; items: credit_note_row[] }>('/billing/returns', { params }),
  get: (id: number) => api.get<credit_note>(`/billing/returns/${id}`),
  cancel: (id: number, reason: string) => api.post(`/billing/returns/${id}/cancel`, { reason }),
}
