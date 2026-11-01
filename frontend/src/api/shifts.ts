import api from './axios'

export interface shift_row {
  id: number; shift_no: number | null; shift_name: string; terminal_no: string | null; status: 'open' | 'closed'
  opened_at: string; closed_at: string | null; opening_cash: string; cashier_name: string
  total_bills: number; total_sales: string; expected_cash: string; actual_cash: string
  short_amount: string; excess_amount: string
  business_date?: string; outlet_name?: string; business_day_id?: number
}

export interface mode_row { mode: string; system: string; actual: string; diff: string }

export interface shift_live {
  modes: Record<string, string>; total_collected: string; system_cash: string; cash_refunds: string
  pay_ins: string; expenses: string; pickups: string; pending_expenses: number
  expected_cash: string; total_bills: number; total_sales: string; total_returns: string; credit_sales: string
}

export interface shift_detail extends shift_row {
  business_day_id: number; outlet_id: number; outlet_name: string; business_date: string; cashier_id: number
  open_remarks: string | null; close_remarks: string | null; closed_by_name: string | null
  total_returns: string; cash_refunds: string; credit_sales: string; system_cash: string
  mode_totals: mode_row[] | null; diff_total: string; denominations: Record<string, number | string> | null
  first_bill: string | null; last_bill: string | null
  outlet: { address: string | null; city: string | null; state: string | null; pincode: string | null; store_phone: string | null; gst_number: string | null } | null
  live?: shift_live
}

export interface day_detail {
  id: number; outlet_id: number; outlet_name: string; business_date: string; status: 'open' | 'closed'
  opened_at: string; opened_by_name: string | null; open_remarks: string | null
  closed_at: string | null; closed_by_name: string | null; close_remarks: string | null
  total_bills: number; cancelled_bills: number; gross_sales: string; total_discount: string; total_gst: string
  net_sales: string; total_returns: string; total_credit: string; total_collected: string; total_cash: string
  mode_totals: Record<string, string> | null; total_shortage: string; total_excess: string
  safe_balance?: string; safe_expected_at_close?: string
  safe_expected: string | null; safe_counted: string | null; safe_variance: string | null
  shifts: shift_row[]; open_shifts: shift_row[]
}

export interface day_row {
  id: number; outlet_id: number; outlet_name: string; business_date: string; status: 'open' | 'closed'
  opened_at: string; closed_at: string | null; opened_by_name: string | null; closed_by_name: string | null
  total_bills: number; net_sales: string; total_collected: string; total_cash: string
  total_shortage: string; total_excess: string
}

export interface shift_status {
  outlet_id: number; outlet_name: string; day: day_detail | null; my_shift: shift_detail | null
  suggested_opening: string; last_closed_date: string | null; can_manage_day: boolean
  operating_mode: 'STANDARD' | '24H'; shift_plan: shift_slot[] | null; auto_rollover: boolean; current_slot: string | null; today: string
}

export interface shift_slot { name: string; start: string; end: string }

export interface store_setting {
  outlet_id: number; store: string; operating_mode: 'STANDARD' | '24H'; shift_plan: shift_slot[] | null
  auto_rollover: boolean; closing_time: string | null; closing_review: boolean | null
}

export interface monitor_row {
  outlet_id: number; store: string; mode: 'STANDARD' | '24H'; auto_rollover: boolean; current_slot: string | null
  plan: shift_slot[] | null; overdue: boolean
  shifts: { id: number; shift_no: number | null; shift_name: string; status: 'open' | 'closed'; opened_at: string; planned_end: string | null
    closed_at: string | null; auto_closed: boolean; cashier: string; overdue: boolean }[]
}

export const shifts_api = {
  status: (outlet_id: number) => api.get<shift_status>('/shifts/status', { params: { outlet_id } }),
  day_open: (body: { outlet_id: number; business_date: string; remarks?: string }) => api.post<day_detail>('/shifts/day/open', body),
  day_reopen: (outlet_id: number, reason: string) => api.post<any>('/shifts/day/reopen', null, { params: { outlet_id, reason } }),
  day_checklist: (day_id: number) => api.get<{ key: string; label: string; count: number; blocking: boolean }[]>(`/shifts/day/${day_id}/checklist`),
  day_close: (id: number, body: { remarks?: string; force?: boolean; safe_counted?: number }) => api.post<day_detail>(`/shifts/day/${id}/close`, body),
  day: (id: number) => api.get<day_detail>(`/shifts/day/${id}`),
  days: (params: { outlet_id?: number; from_date?: string; to_date?: string }) => api.get<day_row[]>('/shifts/days', { params }),
  open: (body: { outlet_id: number; opening_cash: number; shift_name: string; terminal_no?: string; remarks?: string }) =>
    api.post<shift_detail>('/shifts/open', body),
  get: (id: number) => api.get<shift_detail>(`/shifts/${id}`),
  list: (params: { outlet_id?: number; day_id?: number; from_date?: string; to_date?: string }) => api.get<shift_row[]>('/shifts', { params }),
  close: (id: number, body: { actual: Record<string, number>; denominations?: Record<string, number>; remarks?: string }) =>
    api.post<shift_detail>(`/shifts/${id}/close`, body),
  close_and_open: (day_id: number, body: { safe_counted: number; remarks?: string }) =>
    api.post<{ closed: day_detail; next_day: day_detail | null; message?: string }>(`/shifts/day/${day_id}/close-and-open`, body),
  store_settings: () => api.get<store_setting[]>('/shifts/store-settings'),
  save_store_settings: (body: { outlet_ids: number[]; operating_mode: 'STANDARD' | '24H'; shift_plan?: shift_slot[]; auto_rollover: boolean }) =>
    api.put<{ updated: number }>('/shifts/store-settings', body),
  monitor: () => api.get<monitor_row[]>('/shifts/monitor'),
}
