import api from './axios'

export interface grn_line {
  product_id: number
  name: string
  item_code: string | null
  hsn_code: string | null
  unit: string | null
  gst_percent: number
  received_qty: number
  returned_qty: number
  returnable_qty: number
  rate: number
  ho_stock: number
}

export interface grn_lookup {
  purchase_no: string
  invoice_no: string | null
  invoice_date: string | null
  total_amount: number
  due_amount: number
  is_interstate: boolean
  supplier: { id: number; name: string; state: string | null; gst_number: string | null } | null
  lines: grn_line[]
}

export interface pr_product {
  id: number
  name: string
  item_code: string | null
  hsn_code: string | null
  unit: string | null
  gst_percent: number
  rate: number
  ho_stock: number
}

export interface debit_note_row {
  id: number
  prn_no: string
  return_date: string
  supplier_name: string | null
  outlet_name: string | null
  ref_purchase_no: string | null
  reason: string | null
  total_qty: number
  taxable_amount: number
  total_gst: number
  total_amount: number
  adjusted_amount: number
  status: string
  source: 'HO' | 'OUTLET'
}

export interface debit_note_item {
  name: string
  item_code: string | null
  hsn_code: string | null
  qty: number
  unit: string | null
  price: number
  taxable_amt: number
  gst_percent: number
  cgst_percent: number
  sgst_percent: number
  igst_percent: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  total: number
  mrp: number | null
  selling_price: number | null
}

export interface debit_note {
  id: number
  prn_no: string
  return_date: string
  status: string
  reason: string | null
  notes: string | null
  is_interstate: boolean
  ref_purchase_no: string | null
  grn_invoice_no: string | null
  grn_invoice_date: string | null
  taxable_amount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  total_gst: number
  total_amount: number
  adjusted_amount: number
  source: 'HO' | 'OUTLET'
  supplier: { name: string; address: string | null; state: string | null; gst_number: string | null; phone: string | null } | null
  items: debit_note_item[]
}

export const purchase_returns_api = {
  grn_lookup: (purchase_no: string) => api.get<grn_lookup>('/purchase-returns/grn-lookup', { params: { purchase_no } }),
  products: (q: string) => api.get<pr_product[]>('/purchase-returns/products', { params: { q } }),
  supplier_state: (id: number) => api.get<{ is_interstate: boolean; state: string | null }>(`/purchase-returns/supplier-state/${id}`),
  create: (data: {
    purchase_no?: string
    supplier_id?: number
    items: { product_id: number; qty: number; rate?: number }[]
    reason: string
    return_date?: string
    notes?: string
  }) => api.post<{ id: number; prn_no: string; total_amount: number }>('/purchase-returns', data),
  list: (params: object) => api.get<{ total: number; items: debit_note_row[] }>('/purchase-returns', { params }),
  get: (id: number) => api.get<debit_note>(`/purchase-returns/${id}`),
  cancel: (id: number, reason: string) => api.post(`/purchase-returns/${id}/cancel`, { reason }),
}
