import api from './axios'

type num = string | number

export interface dashboard_summary {
  date: string
  kpi: {
    today_sales: num; today_bills: number; yesterday_sales: num; month_sales: num
    today_returns: num; receivables: num; unpaid_bills: number; avg_bill: num
  }
  daily: { day: string; sales: num; bills: number }[]
  stores: { id: number; name: string; code: string | null; today_sales: num; today_bills: number; month_sales: num; last_bill_date: string | null }[]
  top_items: { item_code: string | null; name: string; qty: num; value: num }[]
  stockouts: { outlet_id: number; outlet: string; product_id: number; name: string; item_code: string | null; sold_qty: num; stock_qty: num }[]
  stockout_count: number
  recent_invoices: { id: number; invoice_no: string; invoice_date: string; total_amount: num; due_amount: num; status: string; invoice_type: string; outlet: string | null; customer: string | null }[]
  transfers: { pending: number; today: number }
}

export interface store_health_row {
  id: number; name: string; code: string | null; has_server: boolean
  last_sync_ok: string | null; last_sync_fail: string | null; last_error: string | null
  last_bill_date: string | null; today_sales: num
}

export const dashboard_api = {
  summary: (days = 7) => api.get<dashboard_summary>('/dashboard/summary', { params: { days } }).then(r => r.data),
  storeHealth: () => api.get<store_health_row[]>('/dashboard/store-health').then(r => r.data),
  ping: () => api.get<Record<number, boolean>>('/dashboard/store-health/ping').then(r => r.data),
}
