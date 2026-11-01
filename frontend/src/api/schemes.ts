import api from './axios'

export type scheme_type = 'QTY_SLAB' | 'VALUE_DISC' | 'FREE_ITEM' | 'MIX_MATCH' | 'CARTON' | 'TARGET' | 'CASH_DISC' | 'CREDIT_NOTE' | 'CHEAPEST_FREE' | 'BULK_TIER'

export interface scheme_slab { min_qty: number; max_qty: number; min_value: number; free_qty: number
  discount_percent: number; discount_percent2: number; discount_value: number; free_item_id: number | null }
export interface scheme_group { name: string; min_qty: number; product_ids: number[] }

export interface scheme_form {
  name: string; scheme_type: scheme_type; apply_on: string; priority: number
  start_date: string; end_date: string; start_time: string | null; end_time: string | null
  is_active: boolean; outlet_ids: number[]; customer_ids: number[]; product_ids: number[]
  customer_types: string[]; qty_basis: 'line' | 'total'
  brand_id: number | null; category_id: number | null
  min_qty: number; min_value: number; discount_percent: number; discount_percent2: number; discount_value: number
  free_qty: number; free_item_id: number | null; is_recursive: boolean; is_combination_allowed: boolean
  max_benefit_per_invoice: number; expiry_days_trigger: number | null; target_amount: number
  credit_note_percent: number; credit_note_timing: string; carton_size: number
  slabs: scheme_slab[]; free_items: { product_id: number; qty: number }[]; mix_groups: scheme_group[]; notes: string | null
}

export interface scheme_row {
  id: number; name: string; scheme_type: scheme_type; type_label: string; apply_on: string; priority: number
  start_date: string; end_date: string; start_time: string | null; end_time: string | null
  is_active: boolean; is_combination_allowed: boolean; state: 'active' | 'inactive' | 'expired' | 'upcoming'
  discount_percent: string; discount_percent2: string; discount_value: string; free_qty: string; min_qty: string; min_value: string
  outlet_ids: number[] | null; brand_name: string | null; category_name: string | null; item_count: number
  bills: number; discount_given: string
  slabs: scheme_slab[]; customer_types: string[] | null; qty_basis: 'line' | 'total'; max_benefit_per_invoice: string
}

export interface scheme_detail extends scheme_form {
  id: number; type_label: string; product_names: Record<string, string>; customer_names: Record<string, string>
  log: { applied_at: string; invoice_id: number; invoice_no: string; benefit_type: string; discount_given: string; free_qty: string; note: string }[]
}

export interface eval_result {
  applied: { scheme_id: number; scheme_name: string; scheme_type: string; benefit_type: string; discount: string; note: string
             free_items: { product_id: number; name: string; qty: string }[]; credit_note: { amount: string; timing: string } | null }[]
  free_items: { product_id: number; name: string; qty: string; scheme_name: string; mrp: string; gst_percent: string }[]
  credit_notes: { amount: string; timing: string; scheme_name: string }[]
  info: string[]; line_discount: string[]; line_disc_val: string[]; total_discount: string
}

export interface eval_payload {
  items: { product_id: number; qty: number; rate: number; gst?: number }[]
  customer_id?: number; outlet_id?: number | null; payment_mode?: string; bill_date?: string; at?: string
}

export const schemes_api = {
  types: () => api.get<{ code: scheme_type; label: string }[]>('/schemes/types'),
  list: (params: { status?: string; search?: string; kind?: 'scheme' | 'bulk' }) => api.get<scheme_row[]>('/schemes', { params }),
  get: (id: number) => api.get<scheme_detail>(`/schemes/${id}`),
  create: (data: scheme_form) => api.post<{ id: number }>('/schemes', data),
  update: (id: number, data: scheme_form) => api.put(`/schemes/${id}`, data),
  toggle: (id: number) => api.post<{ is_active: boolean }>(`/schemes/${id}/toggle`),
  clone: (id: number) => api.post<{ id: number }>(`/schemes/${id}/clone`),
  remove: (id: number) => api.delete(`/schemes/${id}`),
  evaluate: (data: eval_payload) => api.post<eval_result>('/schemes/evaluate', data),
  report: (params: { from_date: string; to_date: string; scheme_id?: number; outlet_id?: number }) =>
    api.get<{ summary: any[]; detail: any[] }>('/schemes/report', { params }),
}
