import api from './axios'

export interface customer_list_item {
  id: number; customer_code: string | null; name: string; phone: string; email: string | null
  contact_person: string | null; city: string | null; state: string | null; type: string
  gst_registration_type: string | null; gst_number: string | null
  balance: string; credit_limit: string; credit_days: number | null; status: boolean
}

export interface customer_detail extends customer_list_item {
  alt_phone: string | null; address: string | null; state: string; state_code: string | null; pincode: string | null
  shipping_address: string | null; shipping_city: string | null; shipping_state: string | null; shipping_pincode: string | null
  pan_number: string | null; discount_percent: string | null; notes: string | null
  opening_balance: string; show_outstanding_in_print: boolean
  portal_active: boolean; created_at: string; updated_at: string
}

export interface customer_summary { total: number; active: number; wholesale: number; b2b: number; outstanding: string }

export interface ledger_row {
  date: string; ref_no: string; type: string
  description: string; debit: string; credit: string; balance: string
}

export interface paginated<T> { data: T[]; total: number; page: number; per_page: number; total_pages: number }

export interface customer_query { page?: number; per_page?: number; search?: string; type?: string; status?: 'active' | 'inactive' | 'all'; gst?: 'b2b' | 'b2c' }

export const customers_api = {
  list: (params?: customer_query) =>
    api.get<paginated<customer_list_item>>('/customers', { params }),
  summary: () => api.get<customer_summary>('/customers/summary'),
  get: (id: number) => api.get<customer_detail>(`/customers/${id}`),
  create: (data: object) => api.post<customer_detail>('/customers', data),
  update: (id: number, data: object) => api.put<customer_detail>(`/customers/${id}`, data),
  delete: (id: number) => api.delete(`/customers/${id}`),
  ledger: (id: number) => api.get<ledger_row[]>(`/customers/${id}/ledger`),
}
