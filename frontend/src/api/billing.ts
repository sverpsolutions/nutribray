import api from './axios'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface invoice_item_in {
  product_id: number
  item_code?: string
  name?: string
  qty: number
  pcs?: number
  unit: string
  rate: number
  disc_val: number
  disc_type: '₹' | '%'
  gst_percent: number
  hsn_code?: string
  challan_item_id?: number
}

export interface invoice_item_out extends invoice_item_in {
  id: number
  invoice_id: number
  taxable_amt: number
  cgst_percent: number
  sgst_percent: number
  igst_percent: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  total: number
}

export interface payment_out {
  id: number
  payment_no: string
  outlet_id?: number
  customer_id: number
  invoice_id?: number
  amount: number
  payment_date: string
  payment_mode: string
  reference_no?: string
  notes?: string
  created_at: string
}

export interface invoice_out {
  id: number
  outlet_id?: number
  invoice_no: string
  customer_id: number
  invoice_type: string
  invoice_date: string
  invoice_datetime?: string
  subtotal: number
  discount: number
  taxable_amount: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  total_gst: number
  cd_percent: number
  cd_amount: number
  round_off?: number
  total_amount: number
  paid_amount: number
  due_amount: number
  payment_mode: string
  is_interstate: boolean
  notes?: string
  status: string
  created_by?: number
  created_at: string
  updated_at: string
  items: invoice_item_out[]
  payments: payment_out[]
}

export interface invoice_list_out {
  id: number
  invoice_no: string
  customer_id: number
  invoice_date: string
  total_amount: number
  paid_amount: number
  due_amount: number
  payment_mode: string
  status: string
  created_at: string
  outlet_id: number | null
  outlet_name: string | null
  split: { payment_mode: string; amount: number }[]
}

export interface invoice_create {
  outlet_id?: number
  customer_id: number
  invoice_type?: string
  invoice_date: string
  payment_mode?: string
  is_interstate?: boolean
  cd_percent?: number
  notes?: string
  items: invoice_item_in[]
  paid_amount?: number
  round_off?: boolean
  payments?: { payment_mode: string; amount: number }[]  // split payment
  apply_schemes?: boolean  // POS: server applies active schemes
  discount_approval_no?: string  // approved High Discount request (used once)
}

export interface estimate_item_in {
  product_id?: number
  item_code?: string
  description?: string
  qty: number
  unit: string
  rate: number
  discount: number
  tax_percent: number
  cost_price?: number
}

export interface estimate_item_out extends estimate_item_in {
  id: number
  estimate_id: number
  tax_amount: number
  total: number
}

export interface estimate_out {
  id: number
  estimate_no: string
  customer_id: number
  customer_name: string
  customer_mobile?: string
  estimate_date: string
  valid_until?: string
  subtotal: number
  total_discount: number
  total_tax: number
  total_amount: number
  notes?: string
  status: string
  converted_to?: number
  created_at: string
  updated_at: string
  items: estimate_item_out[]
}

export interface estimate_list_out {
  id: number
  estimate_no: string
  customer_id: number
  customer_name: string
  estimate_date: string
  valid_until?: string
  total_amount: number
  status: string
  converted_to?: number | null
  created_at: string
}

export interface estimate_create {
  customer_id: number
  customer_name: string
  customer_mobile?: string
  estimate_date: string
  valid_until?: string
  notes?: string
  items: estimate_item_in[]
}

export interface paginated<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

// ─── Billing API ──────────────────────────────────────────────────────────────

export const billing_api = {
  // invoices
  create_invoice:   (data: invoice_create) => api.post<invoice_out>('/billing/invoices', data),
  list_invoices:    (params?: object) => api.get<paginated<invoice_list_out>>('/billing/invoices', { params }),
  get_invoice:      (id: number) => api.get<invoice_out>(`/billing/invoices/${id}`),
  add_payment:      (id: number, data: object) => api.post<invoice_out>(`/billing/invoices/${id}/payment`, data),
  cancel_invoice:   (id: number, reason: string) => api.post<{ message: string }>(`/billing/invoices/${id}/cancel?reason=${encodeURIComponent(reason)}`),

  // estimates
  create_estimate:  (data: estimate_create) => api.post<estimate_out>('/estimates', data),
  list_estimates:   (params?: object) => api.get<paginated<estimate_list_out>>('/estimates', { params }),
  get_estimate:     (id: number) => api.get<estimate_out>(`/estimates/${id}`),
  convert_estimate: (id: number, payment_mode: string, paid: number) =>
    api.post<invoice_out>(`/estimates/${id}/convert?payment_mode=${payment_mode}&paid_amount=${paid}`),
  close_estimate:   (id: number) => api.post(`/estimates/${id}/close`),
}
