import api from './axios'

export interface grn_row {
  id: number; purchase_no: string; supplier_id: number; supplier_name: string; invoice_no: string | null; invoice_date: string
  total_amount: string; paid_amount: string; due_amount: string; status: string
  bill_status: 'pending' | 'verified' | 'disputed'; bill_no: string | null; bill_date: string | null; bill_amount: string | null
  bill_attachment: string | null; bill_remarks: string | null; bill_verified_at: string | null; verified_by_name: string | null
  created_by: number; created_by_name: string | null; due_on: string | null; outlet_name: string
}
export interface open_bill { id: number; purchase_no: string; bill_no: string | null; bill_date: string | null; total_amount: string; due_amount: string; open_amount: string; due_on: string }
export interface supplier_payment {
  id: number; payment_no: string; supplier_id: number; supplier_name: string; bank_account_id: number; bank_name: string
  payment_date: string; mode: string; reference_no: string; amount: string; allocated: string; discount: string; bills: string | null
  status: 'pending' | 'posted' | 'rejected' | 'void'; remarks: string | null; created_by: number; created_by_name: string
  created_at: string; actioned_by_name: string | null; action_remarks: string | null
}
export interface aging_row { supplier_id: number; supplier_name: string; not_due: string; d30: string; d60: string; d90: string; d90p: string; total: string; unverified: string; advance: string }
export interface recv_row { customer_id: number; customer_name: string; phone: string; credit_limit: string; credit_days: number; bills: number; not_due: string; d30: string; d60: string; d90: string; d90p: string; total: string; oldest: string }
export interface book_line { d: string; type: string; ref: string; doc: string | null; debit?: string; credit?: string; receipt?: string; payment?: string; balance: string }
export interface acc_dashboard {
  payable: string; overdue: string; due_7d: string; bills_pending: number; bills_pending_amt: string; bills_disputed: number
  payments_pending: number; payments_pending_amt: string; rec_receivable: string; rec_overdue: string
  rec_walkin_due: string; rec_walkin_bills: number
  in_safes: string; with_people: string; in_transit: string; deposits_unverified: string
  banks: { id: number; name: string; last4: string; balance: string }[]
  recent_payments: { id: number; payment_no: string; payment_date: string; amount: string; status: string; mode: string; supplier_name: string }[]
  top_payables: aging_row[]; is_accounts: boolean
}

export const accounts_api = {
  dashboard: () => api.get<acc_dashboard>('/accounts/dashboard'),
  grns: (params: { bill_status?: string; supplier_id?: number; search?: string }) => api.get<grn_row[]>('/accounts/grns', { params }),
  enter_bill: (id: number, b: { bill_no: string; bill_date: string; bill_amount: number; attachment: string; remarks?: string; accept_difference?: boolean }) =>
    api.post<{ status: string; difference: string }>(`/accounts/grns/${id}/bill`, b),
  open_bills: (supplier_id: number) => api.get<open_bill[]>('/accounts/open-bills', { params: { supplier_id } }),
  payments: (params: { status?: string; supplier_id?: number }) => api.get<supplier_payment[]>('/accounts/payments', { params }),
  create_payment: (b: object) => api.post('/accounts/payments', b),
  decide: (id: number, approve: boolean, remarks?: string) => api.post(`/accounts/payments/${id}/decision`, { approve, remarks }),
  void: (id: number, reason: string) => api.post(`/accounts/payments/${id}/void`, { reason }),
  allocate: (id: number, allocations: { purchase_id: number; amount: number; discount: number }[]) => api.post(`/accounts/payments/${id}/allocate`, { allocations }),
  aging: () => api.get<aging_row[]>('/accounts/aging'),
  ledger: (supplier_id: number, from_date: string, to_date: string) =>
    api.get<{ opening: string; lines: book_line[]; closing: string }>('/accounts/ledger', { params: { supplier_id, from_date, to_date } }),
  bank_book: (bank_account_id: number, from_date: string, to_date: string) =>
    api.get<{ opening: string; lines: book_line[]; closing: string }>('/accounts/bank-book', { params: { bank_account_id, from_date, to_date } }),
  receivables: () => api.get<recv_row[]>('/accounts/receivables'),
}
