import api from './axios'

export type entry_kind = 'expense' | 'pay_in' | 'pickup' | 'float_out' | 'shift_close' | 'handover' | 'deposit' | 'adjustment'
export type entry_status = 'posted' | 'pending' | 'rejected' | 'cancelled' | 'void'

export interface cash_entry {
  id: number; entry_no: string; kind: entry_kind; status: entry_status; outlet_id: number; outlet_name: string | null
  business_date: string; shift_id: number | null; amount: string
  from_type: string; from_ref: number | null; to_type: string; to_ref: number | null; from_label: string; to_label: string
  category_name: string | null; party: string | null; ref_no: string | null; description: string | null; attachment: string | null
  credited_amount: string | null; bank_ref: string | null; credited_date: string | null
  created_by: number; created_by_name: string; created_at: string
  actioned_by_name: string | null; actioned_at: string | null; action_remarks: string | null
}

export interface cash_category { id: number; name: string; type: 'expense' | 'pay_in'; approval_limit: string | null; requires_bill: boolean; is_active: boolean; sort_order: number }
export interface bank_account { id: number; name: string; bank_name: string; account_no: string; ifsc: string | null; branch: string | null; is_active: boolean }
export interface cash_meta {
  categories: cash_category[]; bank_accounts: bank_account[]
  users: { id: number; name: string; role: string; outlet_id: number | null }[]
  me: { id: number; role: string }; is_manager: boolean; is_accounts: boolean
}
export interface drawer_pos { shift_id: number; cashier_id: number; cashier_name: string; shift_name: string; expected_cash: string; opening_cash: string; pay_ins: string; expenses: string; pickups: string }
export interface cash_position {
  outlet_id: number; outlet_name: string; business_date: string | null; safe_balance: string; drawers: drawer_pos[]
  out_in_transit: string; entries: cash_entry[]; pending_expenses: cash_entry[]; incoming: cash_entry[]; outgoing: cash_entry[]
}
export interface my_cash { balance: string; incoming: cash_entry[]; outgoing: cash_entry[]; entries: cash_entry[] }
export interface cash_approvals { expenses: cash_entry[]; safe_handovers: cash_entry[]; deposits: cash_entry[] }
export interface cash_control {
  locations: { outlet_id: number; outlet_name: string; safe_balance: string; handover_in_transit: string; deposits_unverified: string
               last_verified_deposit: string | null; shortage_30d: string; pending_expenses: number; day_status: string | null }[]
  people: { id: number; name: string; role: string; balance: string; holding_since: string | null }[]
  banks: { id: number; name: string; bank_name: string; last4: string; verified_total: string; awaiting_verification: string; bank_shortfall: string }[]
}

export const cash_api = {
  meta: () => api.get<cash_meta>('/cash/meta'),
  position: (outlet_id: number) => api.get<cash_position>('/cash/position', { params: { outlet_id } }),
  my: () => api.get<my_cash>('/cash/my'),
  approvals: () => api.get<cash_approvals>('/cash/approvals'),
  control: () => api.get<cash_control>('/cash/control'),
  entries: (params: Record<string, unknown>) => api.get<cash_entry[]>('/cash/entries', { params }),
  upload: (file: File) => { const f = new FormData(); f.append('file', file); return api.post<{ path: string }>('/cash/upload', f, { headers: { 'Content-Type': 'multipart/form-data' } }) },
  expense: (b: object) => api.post('/cash/expense', b),
  pay_in: (b: object) => api.post('/cash/pay-in', b),
  pickup: (b: object) => api.post('/cash/pickup', b),
  handover: (b: object) => api.post('/cash/handover', b),
  deposit: (b: object) => api.post('/cash/deposit', b),
  expense_decision: (id: number, approve: boolean, remarks?: string) => api.post(`/cash/entries/${id}/expense-decision`, { approve, remarks }),
  handover_decision: (id: number, approve: boolean, remarks?: string) => api.post(`/cash/entries/${id}/handover-decision`, { approve, remarks }),
  verify: (id: number, b: object) => api.post(`/cash/entries/${id}/verify`, b),
  cancel: (id: number, reason: string) => api.post(`/cash/entries/${id}/cancel`, { reason }),
  void: (id: number, reason: string) => api.post(`/cash/entries/${id}/void`, { reason }),
  save_category: (b: object, id?: number) => id ? api.put(`/cash/categories/${id}`, b) : api.post('/cash/categories', b),
  save_bank: (b: object, id?: number) => id ? api.put(`/cash/bank-accounts/${id}`, b) : api.post('/cash/bank-accounts', b),
}
