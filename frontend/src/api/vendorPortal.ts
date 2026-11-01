import api from './axios'

export interface VendorDashboardData {
  supplier: {
    id: number
    name: string
    trade_name?: string | null
    supplier_code?: string | null
    supplier_type: string
    phone: string
    email?: string | null
    gst_number?: string | null
    pan_number?: string | null
    registration_status: string
    portal_sales_enabled: boolean
    portal_sales_config: Record<string, boolean>
    portal_permissions?: Record<string, boolean>
  }
  kpis: {
    total_pos: number
    open_pos: number
    partially_received_pos: number
    completed_pos: number
    total_grns: number
    total_prns: number
    total_cheques: number
    total_payments: number
    outstanding_balance: number
    pending_deliveries: number
    supplied_items_count: number
    pending_item_requests: number
    pending_profile_requests: number
    sales_summary_30d?: {
      sales_quantity: number
      sales_value: number
    } | null
  }
  recent_pos: any[]
  recent_grns: any[]
  recent_prns: any[]
  recent_cheques: any[]
}

export const vendor_portal_api = {
  // Auth
  login: (data: { username: string; password: string }) =>
    api.post<any>('/vendor-portal/auth/login', data),

  activate: (data: { token: string; password: string }) =>
    api.post<any>('/vendor-portal/auth/activate', data),

  forgot_password: (data: { username_or_email: string }) =>
    api.post<any>('/vendor-portal/auth/forgot-password', data),

  reset_password: (data: { token: string; new_password: string }) =>
    api.post<any>('/vendor-portal/auth/reset-password', data),

  // Dashboard & Profile
  get_dashboard: (supplier_id?: number) =>
    api.get<VendorDashboardData>('/vendor-portal/dashboard', { params: { supplier_id } }),

  get_profile: (supplier_id?: number) =>
    api.get<any>('/vendor-portal/profile', { params: { supplier_id } }),

  submit_profile_update_request: (changes: Record<string, any>, supplier_id?: number) =>
    api.post('/vendor-portal/profile-update-request', { changes }, { params: { supplier_id } }),

  // Purchase Orders
  list_purchase_orders: (params?: { status?: string; from_date?: string; to_date?: string; page?: number; per_page?: number; supplier_id?: number }) =>
    api.get<any>('/vendor-portal/purchase-orders', { params }),

  get_purchase_order: (id: number, supplier_id?: number) =>
    api.get<any>(`/vendor-portal/purchase-orders/${id}`, { params: { supplier_id } }),

  acknowledge_purchase_order: (
    id: number,
    data: { vendor_expected_delivery?: string; vendor_delivery_remarks?: string },
    supplier_id?: number
  ) =>
    api.post(`/vendor-portal/purchase-orders/${id}/acknowledge`, data, { params: { supplier_id } }),

  // GRNs
  list_grns: (params?: { from_date?: string; to_date?: string; po_no?: string; page?: number; per_page?: number; supplier_id?: number }) =>
    api.get<any>('/vendor-portal/grns', { params }),

  // PRNs (Purchase Return Notes)
  list_prns: (params?: { from_date?: string; to_date?: string; search?: string; status?: string; page?: number; per_page?: number; supplier_id?: number }) =>
    api.get<any>('/vendor-portal/prns', { params }),

  acknowledge_prn: (
    id: number,
    data: { vendor_remarks?: string },
    supplier_id?: number
  ) =>
    api.post(`/vendor-portal/prns/${id}/acknowledge`, data, { params: { supplier_id } }),

  // Cheques
  list_cheques: (params?: { from_date?: string; to_date?: string; status?: string; supplier_id?: number }) =>
    api.get<any[]>('/vendor-portal/cheques', { params }),

  // Payments & Ledger
  list_payments: (params?: { from_date?: string; to_date?: string; supplier_id?: number }) =>
    api.get<any[]>('/vendor-portal/payments', { params }),

  get_ledger: (params?: { from_date?: string; to_date?: string; supplier_id?: number }) =>
    api.get<any>('/vendor-portal/ledger', { params }),

  // Invoices
  list_invoices: (params?: { from_date?: string; to_date?: string; supplier_id?: number }) =>
    api.get<any[]>('/vendor-portal/invoices', { params }),

  // Sales
  get_item_sales: (params?: { from_date?: string; to_date?: string; supplier_id?: number }) =>
    api.get<any>('/vendor-portal/item-sales', { params }),

  // Item Requests
  list_item_requests: (params?: { status?: string; supplier_id?: number }) =>
    api.get<any[]>('/vendor-portal/item-requests', { params }),

  submit_item_request: (data: any, supplier_id?: number) =>
    api.post('/vendor-portal/item-requests', data, { params: { supplier_id } }),

  // Settings
  get_settings: (supplier_id?: number) =>
    api.get<any>('/vendor-portal/settings', { params: { supplier_id } }),
}
