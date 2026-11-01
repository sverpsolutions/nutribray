import api from './axios'

// ── State & GST APIs ──────────────────────────────────────────────────────────
export interface state_item { id: number; state_name: string; state_code: string; is_ut: boolean }
export interface gstin_validate_result {
  valid: boolean; error?: string; pan?: string;
  state_code?: string; state_name?: string;
  state_mismatch?: boolean; mismatch_message?: string;
}

export const states_api = {
  list: () => api.get<state_item[]>('/states'),
  validate_gstin: (gstin: string, state_code?: string) =>
    api.post<gstin_validate_result>('/states/validate-gstin', { gstin, state_code }),
  validate_pan: (pan: string) => api.post<{ valid: boolean; error?: string }>('/states/validate-pan', { pan }),
  validate_cin: (cin: string, company_type?: string) => api.post<{ valid: boolean; error?: string }>('/states/validate-cin', { cin, company_type }),
}

export interface supplier_address {
  id?: number;
  address_type: string;
  address: string;
  country: string;
  state: string;
  city: string;
  pincode: string;
}

export interface supplier_legal {
  registration_type: string;
  gst_no?: string;
  pan_no?: string;
  tan_no?: string;
  cin_no?: string;
}

export interface supplier_contact {
  id?: number;
  name: string;
  mobile: string;
  email?: string;
  is_primary: boolean;
}

export interface supplier_director {
  id?: number;
  director_name: string;
  din?: string;
  email?: string;
  phone?: string;
}

export interface supplier_auth_person {
  id?: number;
  name: string;
  designation: string;
  mobile: string;
  email?: string;
  photo_path?: string;
  id_proof_path?: string;
  is_active: boolean;
}

export interface supplier_brand {
  brand_id: number;
  brand_name?: string;
  credit_days?: number;
}

export interface supplier_financial {
  bank_name?: string;
  account_no?: string;
  ifsc_code?: string;
  branch?: string;
  credit_limit: number;
  credit_days: number;
}

export interface supplier_document {
  id?: number;
  document_type: string;
  file_path: string;
  start_date?: string;
  end_date?: string;
  notes?: string;
}

export interface supplier_gstin_item {
  id?: number;
  gstin: string;
  state_code: string;
  state_name?: string;
  pan: string;
  registration_type: string;
  is_primary: boolean;
  is_active: boolean;
}

export interface supplier_note {
  id: number;
  note: string;
  note_type?: string;
  created_by_name?: string;
  created_at: string;
}

export interface approval_log {
  id: number;
  action: string;
  from_status: string | null;
  to_status: string | null;
  remarks: string | null;
  performed_by_name: string | null;
  created_at: string;
}

export interface supplier_list_item {
  id: number;
  supplier_code: string | null;
  name: string;
  supplier_name?: string;
  phone: string;
  city: string | null;
  gst_number: string | null;
  supplier_type: string;
  status: boolean;
  registration_status: string;
  opening_balance?: number;
  credit_limit_days?: number;
}

export interface supplier_detail extends supplier_list_item {
  company_type?: string;
  category?: string;
  contact_name?: string | null;
  email: string | null;
  address: string | null;
  state: string;
  state_code?: string | null;
  pincode: string | null;
  district: string | null;
  country: string | null;
  pan_number: string | null;
  cin_number?: string | null;
  website?: string | null;
  notes: string | null;
  registration_status: string;
  onboarding_token?: string | null;
  created_at: string;
  // Approval tracking
  approved_at?: string | null;
  rejection_reason?: string | null;
  correction_notes?: string | null;
  trade_name?: string | null;
  designation?: string | null;
  alt_phone?: string | null;
  alt_email?: string | null;
  msme_number?: string | null;
  fssai_number?: string | null;
  tan_number?: string | null;
  business_constitution?: string | null;
  product_categories?: string[] | any;
  company_description?: string | null;
  portal_sales_enabled?: boolean;
  portal_sales_config?: Record<string, boolean>;

  // Nested
  addresses: supplier_address[];
  legal: supplier_legal | null;
  contacts: supplier_contact[];
  directors: supplier_director[];
  auth_persons: supplier_auth_person[];
  brands: supplier_brand[];
  financial: supplier_financial | null;
  documents: supplier_document[];
  internal_notes: supplier_note[];
  gstins: supplier_gstin_item[];
  approval_logs: approval_log[];
}

export interface paginated<T> { data: T[]; total: number; page: number; per_page: number; total_pages: number }

export const suppliers_api = {
  list: (params?: { page?: number; per_page?: number; search?: string }) =>
    api.get<paginated<supplier_list_item>>('/suppliers', { params }),
  get: (id: number) => api.get<supplier_detail>(`/suppliers/${id}`),
  create: (data: any) => api.post<supplier_detail>('/suppliers', data),
  update: (id: number, data: any) => api.put<supplier_detail>(`/suppliers/${id}`, data),
  delete: (id: number) => api.delete(`/suppliers/${id}`),
  
  // Onboarding & Approvals
  generateOnboardingLink: (phone: string, name: string) =>
    api.post<supplier_detail>('/suppliers/onboarding/link', null, { params: { phone, name } }),
  getPublicRegistration: (token: string) =>
    api.get<supplier_detail>(`/suppliers/public/registration/${token}`),
  submitPublicRegistration: (token: string, data: any) =>
    api.post<supplier_detail>(`/suppliers/public/registration/${token}`, data),

  // Approval actions
  approve: (id: number, remarks?: string) =>
    api.post<supplier_detail>(`/suppliers/${id}/approve`, { remarks: remarks || '' }),
  reject: (id: number, remarks: string) =>
    api.post<supplier_detail>(`/suppliers/${id}/reject`, { remarks }),
  hold: (id: number, remarks?: string) =>
    api.post<supplier_detail>(`/suppliers/${id}/hold`, { remarks: remarks || '' }),
  requestCorrection: (id: number, remarks: string, correction_fields?: string[]) =>
    api.post<supplier_detail>(`/suppliers/${id}/request-correction`, { remarks, correction_fields: correction_fields || [] }),
  markUnderReview: (id: number) =>
    api.post<supplier_detail>(`/suppliers/${id}/under-review`, {}),
  addNote: (id: number, note: string, note_type?: string) =>
    api.post(`/suppliers/${id}/notes`, { note, note_type: note_type || 'internal' }),
  getApprovalLogs: (id: number) =>
    api.get<approval_log[]>(`/suppliers/${id}/approval-logs`),

  // List helpers
  listPending: (params?: { page?: number; per_page?: number; search?: string }) =>
    api.get<paginated<supplier_list_item>>('/suppliers', { params: { ...params, pending_review: true } }),
  listByStatus: (status: string, params?: { page?: number; per_page?: number; search?: string }) =>
    api.get<paginated<supplier_list_item>>('/suppliers', { params: { ...params, registration_status: status } }),

  // Extra
  get_brands: () => api.get<any[]>('/masters/brands'),
  upload_file: (formData: FormData) => api.post('/upload/supplier-doc', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  ledger: (id: number) => api.get<ledger_row[]>(`/suppliers/${id}/ledger`),
  get_terms: (id: number) => api.get<supplier_terms[]>(`/suppliers/${id}/terms`),
  add_terms: (id: number, terms_text: string) => api.post<supplier_terms>(`/suppliers/${id}/terms`, { terms_text }),
  delete_terms: (supplier_id: number, term_id: number) => api.delete(`/suppliers/${supplier_id}/terms/${term_id}`),
  
  // Vendor Portal & Supplier Master VMS endpoints
  get_pos: (id: number, params?: any) => api.get<any>(`/suppliers/${id}/pos`, { params }),
  get_grns: (id: number, params?: any) => api.get<any>(`/suppliers/${id}/grns`, { params }),
  get_sales: (id: number, params?: any) => api.get<any>(`/suppliers/${id}/sales`, { params }),
  get_item_requests: (id: number, params?: any) => api.get<any[]>(`/suppliers/${id}/item-requests`, { params }),
  review_item_request: (id: number, reqId: number, data: { action: string; review_notes?: string; create_product?: boolean }) =>
    api.post(`/suppliers/${id}/item-requests/${reqId}/review`, data),
  get_profile_requests: (id: number, params?: any) => api.get<any[]>(`/suppliers/${id}/profile-requests`, { params }),
  review_profile_request: (id: number, reqId: number, data: { action: string; review_notes?: string }) =>
    api.post(`/suppliers/${id}/profile-requests/${reqId}/review`, data),
  update_portal_settings: (id: number, data: { portal_sales_enabled: boolean; portal_sales_config: Record<string, boolean> }) =>
    api.put(`/suppliers/${id}/portal-settings`, data),
  upload_document: (supplierId: number, formData: FormData) =>
    api.post<supplier_document>(`/suppliers/${supplierId}/documents`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  delete_document: (supplierId: number, docId: number) =>
    api.delete(`/suppliers/${supplierId}/documents/${docId}`),
  
  // Vendor Portal Access & Login Management
  get_portal_access: (id: number) => api.get<any>(`/suppliers/${id}/portal-access`),
  create_portal_user: (id: number, data: any) => api.post<any>(`/suppliers/${id}/portal-access/create`, data),
  toggle_portal_status: (id: number) => api.post<any>(`/suppliers/${id}/portal-access/toggle-status`),
  reset_portal_password: (id: number, data: any) => api.post<any>(`/suppliers/${id}/portal-access/reset-password`, data),
  update_portal_permissions: (id: number, permissions: any) => api.put<any>(`/suppliers/${id}/portal-access/permissions`, { permissions }),
}

export interface supplier_terms {
  id: number;
  supplier_id: number;
  terms_text: string | null;
  is_active: boolean;
  created_at: string;
}

export interface ledger_row {
  date: string;
  ref_no: string;
  type: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}
