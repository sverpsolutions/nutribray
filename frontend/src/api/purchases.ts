import api from './axios'

// ── Types ─────────────────────────────────────────────────────────────────────
export interface item_intel {
  product_id: number
  soh: number
  outlet_stock: number
  doh: number | null
  sale_7d: number
  sale_30d: number
  avg_daily_sale: number
  last_rate: number
  suggested_qty: number
  last_purchases: { date: string; rate: number }[]
}

export interface doh_outlet_row {
  outlet_name: string
  current_qty: number
  avg_sale: number
  doh: number | null
}

export interface po_item_payload {
  product_id: number
  order_qty: number
  rate: number
  gst_percent: number
  mrp: number
  markdown_percent: number
  warehouse_stock: number
  outlet_stock: number
  doh_value: number
  sale_7d: number
  sale_30d: number
  avg_daily_sale: number
  suggested_qty: number
}

export interface po_term_payload {
  term_type: 'FIXED' | 'DYNAMIC'
  title: string
  description?: string
  sequence_no?: number
}

export interface po_create_payload {
  po_no: string
  supplier_id: number
  outlet_id?: number
  po_date: string
  expected_date?: string
  delivery_days: number
  total_amount: number
  notes?: string
  terms?: string
  markdown_enabled: boolean
  status: string
  items: po_item_payload[]
  fixed_terms: po_term_payload[]
  dynamic_terms: po_term_payload[]
}

export interface multi_po_item_payload extends po_item_payload {
  distributions: Record<number, number>
}

export interface multi_po_create_payload extends Omit<po_create_payload, 'items'> {
  items: multi_po_item_payload[]
}

export interface po_list_item {
  id: number
  po_no: string
  supplier_id: number
  supplier_name: string
  outlet_id: number | null
  outlet_name: string | null
  po_date: string
  expected_date: string | null
  delivery_days: number
  total_amount: number
  status: string
  approval_status: string
  markdown_enabled: boolean
  is_master: boolean
  parent_po_id: number | null
  created_at: string
  item_count: number
}

export interface po_item_detail {
  id: number
  product_id: number
  product_name: string
  item_code: string
  hsn_code?: string
  base_unit: string
  order_qty: number
  qty: number
  rate: number
  gst_percent: number
  total: number
  amount: number
  received_qty: number
  warehouse_stock: number
  outlet_stock: number
  doh_value: number
  sale_7d: number
  sale_30d: number
  avg_daily_sale: number
  suggested_qty: number
  mrp: number
  markdown_percent: number
}

export interface po_term_detail {
  id: number
  term_type: string
  title: string
  description: string | null
  sequence_no: number
}

export interface po_audit_entry {
  id: number
  action: string
  description: string | null
  old_status: string | null
  new_status: string | null
  created_by: number | null
  created_at: string
}

export interface po_detail {
  id: number
  po_no: string
  supplier_id: number
  supplier_name: string
  supplier_details?: { address?: string; city?: string; state?: string; pincode?: string; gst_number?: string; email?: string; phone?: string; name?: string }
  outlet_id: number | null
  outlet_name: string | null
  outlet_details?: { address?: string; city?: string; state?: string; pincode?: string; email?: string; phone?: string; name?: string; gst_number?: string }
  po_date: string
  expected_date: string | null
  delivery_days: number
  total_amount: number
  status: string
  approval_status: string
  approved_by: number | null
  approved_at: string | null
  approval_remarks?: string | null
  reject_reason?: string | null
  markdown_enabled?: boolean | null
  terms?: string | null
  notes?: string | null
  is_master?: boolean
  parent_po_id?: number | null
  vendor_invoice_no?: string | null
  vendor_invoice_date?: string | null
  vendor_invoice_file?: string | null
  created_by?: number | null
  created_at: string
  items: po_item_detail[]
  terms_conditions: po_term_detail[]
  audit_logs: po_audit_entry[]
  distributions: any[]
}

export interface purchase_item_payload {
  product_id: number
  item_code?: string
  qty: number
  pcs?: number
  unit?: string
  price: number
  disc_val?: number
  disc_type?: string
  gst_percent: number
  hsn_code?: string
}

export interface purchase_create_payload {
  outlet_id?: number
  supplier_id: number
  invoice_no: string
  invoice_date: string
  discount?: number
  paid_amount?: number
  payment_mode?: string
  notes?: string
  items: purchase_item_payload[]
}

export interface purchase_list_item {
  id: number
  purchase_no: string
  supplier_id: number
  supplier_name: string
  invoice_no: string | null
  invoice_date: string
  subtotal: number
  total_gst: number
  total_amount: number
  paid_amount: number
  due_amount: number
  payment_mode: string
  status: string
  created_at: string
}

export interface purchase_detail_item {
  id: number
  product_id: number
  product_name: string
  product_code: string | null
  barcode?: string | null
  qty: number
  free_qty?: number
  pcs: number
  unit: string
  price: number
  disc_val: number
  disc_type?: string
  basic_amt: number
  taxable_amt: number
  gst_percent: number
  gst_amount: number
  total: number
  hsn_code: string | null
  mrp?: number
  cost_price?: number
  batch_no?: string | null
  batch_id?: number | null
  mfg_date?: string | null
  expiry_date?: string | null
  lp_date?: string | null
  lp_qty?: number | null
  sales_since_lp?: number | null
  sales_lp?: number | null
}

export interface purchase_detail extends purchase_list_item {
  outlet_id: number | null
  discount: number
  taxable_amount: number
  notes: string | null
  items: purchase_detail_item[]
}

// ── API Functions ──────────────────────────────────────────────────────────────

// Intelligence
export const purchases_api = {
  get_next_po_no: () =>
    api.get<{ po_no: string }>('/purchases/intelligence/next-po-no'),

  get_item_intel: (product_id: number, outlet_id?: number, lead_days = 7) =>
    api.get<item_intel>(`/purchases/intelligence/item/${product_id}`, {
      params: { outlet_id, lead_days },
    }),

  get_doh_popup: (product_id: number) =>
    api.get<{ product_id: number; rows: doh_outlet_row[] }>(
      `/purchases/intelligence/doh-popup/${product_id}`
    ),

  get_supplier_terms: (supplier_id: number) =>
    api.get(`/purchases/intelligence/supplier-terms/${supplier_id}`),

  save_supplier_terms: (supplier_id: number, data: any) =>
    api.post(`/purchases/intelligence/supplier-terms/${supplier_id}`, data),

  get_supplier_brands: (supplier_id: number) =>
    api.get<{ brand_id: number; brand: string }[]>(
      `/purchases/intelligence/supplier-brands/${supplier_id}`
    ),

  get_supplier_items: (supplier_id: number, outlet_id?: number, brand_ids?: string) =>
    api.get<any[]>(`/purchases/intelligence/supplier-items/${supplier_id}`, {
      params: { outlet_id, brand_ids },
    }),

  // PO CRUD
  list_pos: (params?: { page?: number; per_page?: number; status?: string; supplier_id?: number; is_master?: boolean }) =>
    api.get<{ data: po_list_item[]; total: number; page: number; per_page: number }>('/purchases/po', { params }),

  create_po: (data: po_create_payload) =>
    api.post<{ success: boolean; po_id: number; po_no: string }>('/purchases/po', data),

  create_multi_po: (data: multi_po_create_payload) =>
    api.post<{ success: boolean; po_id: number; po_no: string }>('/purchases/multi-po', data),

  get_po: (id: number) =>
    api.get<po_detail>(`/purchases/po/${id}`),

  get_guest_po: (id: number) =>
    api.get<po_detail>(`/purchases/po/guest/${id}`),

  submit_vendor_invoice: (id: number, data: { vendor_invoice_no: string; vendor_invoice_date: string; vendor_invoice_file?: string | null }) =>
    api.post(`/purchases/po/guest/${id}/submit-invoice`, data),

  update_po: (id: number, data: Partial<po_create_payload>) =>
    api.put(`/purchases/po/${id}`, data),

  approve_po: (id: number, status: string, remarks?: string) =>
    api.post(`/purchases/po/${id}/approve`, { status, remarks }),

  save_distribution: (po_id: number, data: any) =>
    api.post(`/purchases/po/${po_id}/distribution`, data),

  // GRN CRUD
  list_grn: (params?: { page?: number; per_page?: number; supplier_id?: number; status?: string; search?: string; from_date?: string; to_date?: string }) =>
    api.get<{ data: purchase_list_item[]; total: number; page: number; per_page: number }>('/purchases/grn', { params }),

  create_grn: (data: purchase_create_payload) =>
    api.post<{ success: boolean; purchase_id: number; purchase_no: string }>('/purchases/grn', data),

  get_grn: (id: number) =>
    api.get<purchase_detail>(`/purchases/grn/${id}`),

  get_product_history: (product_id: number) =>
    api.get<{ last_purchase_date: string; last_purchase_qty: number; sales_since_lp: number }>('/purchases/get_product_history_ajax', {
      params: { product_id },
    }),

  check_invoice: (supplier_id: number, invoice_no: string, exclude_purchase_id?: number) =>
    api.get<{
      is_duplicate: boolean
      is_blank: boolean
      existing_purchase_id?: number
      existing_purchase_no?: string
      existing_invoice_no?: string
      invoice_date?: string
      message: string
    }>('/purchases/check-invoice', {
      params: { supplier_id, invoice_no, exclude_purchase_id },
    }),
}

