import api from './axios'

export interface StockTakeSummary {
  id: number
  take_no: string
  location_id: number
  location_name: string
  status: 'in_progress' | 'completed' | 'cancelled'
  notes?: string | null
  started_by?: number | null
  started_by_name?: string | null
  started_at: string
  finalized_by?: number | null
  finalized_by_name?: string | null
  finalized_at?: string | null
  adjust_stock: boolean
  total_items: number
  counted_items: number
  progress_percent: number
}

export interface StockTakeItem {
  id: number
  product_id: number
  product_name: string
  item_code: string
  barcode?: string
  unit: string
  system_qty: number
  counted_qty: number | null
  variance: number | null
  value_impact: number
  cost_price: number
  selling_price: number
  mrp: number
  saved_at?: string | null
  batches?: StockTakeProductBatch[]
}

export interface StockTakeProductBatch {
  id?: number
  batch_id?: number | null
  batch_no: string
  mfg_date?: string | null
  expiry_date?: string | null
  exp_date?: string | null
  status?: string
  system_qty: number
  counted_qty?: number | null
  variance?: number
  reason?: string | null
}

export interface StockTakeDetail {
  id: number
  take_no: string
  location_id: number
  location_name: string
  status: 'in_progress' | 'completed' | 'cancelled'
  notes?: string | null
  started_by?: number | null
  started_by_name?: string | null
  started_at: string
  finalized_by?: number | null
  finalized_by_name?: string | null
  finalized_at?: string | null
  adjust_stock: boolean
  total_items: number
  counted_items: number
  not_yet_scanned: number
  items_with_variance: number
  surplus_items: number
  shortage_items: number
  total_variance_value: number
  items: StockTakeItem[]
}

export interface StockTakeLookupProduct {
  id: number
  name: string
  item_code: string
  barcode: string
  unit: string
  mrp: number
  selling_price: number
  cost_price: number
  system_qty: number
  counted_qty: number | null
  stock_qty: number
  has_batch_tracking?: boolean
  has_expiry_tracking?: boolean
  batches?: StockTakeProductBatch[]
}

export const stock_take_api = {
  list: (params?: { page?: number; per_page?: number; status?: string; location_id?: number }) =>
    api.get<{
      data: StockTakeSummary[]
      total: number
      page: number
      per_page: number
      in_progress_alert: any | null
    }>('/stock-take', { params }),

  create: (data: { location_id: number; notes?: string }) =>
    api.post<{ success: boolean; id: number; take_no: string; total_items: number }>('/stock-take/create', data),

  get: (id: number) =>
    api.get<StockTakeDetail>(`/stock-take/${id}`),

  lookup: (stock_take_id: number, q: string) =>
    api.post<{ success: boolean; products: StockTakeLookupProduct[] }>('/stock-take/lookup', { stock_take_id, q }),

  scan_save: (data: { stock_take_id: number; product_id: number; qty: number }) =>
    api.post<{
      success: boolean
      new_qty: number
      system_qty: number
      variance: number
      counted_items: number
      total_items: number
    }>('/stock-take/scan-save', data),

  save_batches: (data: { stock_take_id: number; product_id: number; batches: StockTakeProductBatch[] }) =>
    api.post<{
      success: boolean
      new_qty: number
      system_qty: number
      variance: number
      counted_items: number
      total_items: number
      batches: StockTakeProductBatch[]
    }>('/stock-take/save-batches', data),

  edit_count: (data: { stock_take_id: number; product_id: number; qty?: number; clear?: boolean }) =>
    api.post<{
      success: boolean
      new_qty: number | null
      system_qty: number
      variance: number | null
      counted_items: number
    }>('/stock-take/edit-count', data),

  zero_uncounted: (stock_take_id: number) =>
    api.post<{ success: boolean; counted_items: number }>('/stock-take/zero-uncounted', null, { params: { stock_take_id } }),

  finalize: (id: number, data: { adjust_stock: boolean; zero_uncounted?: boolean }) =>
    api.post<{ success: boolean; message: string; status: string }>(`/stock-take/finalize/${id}`, data),

  cancel: (id: number) =>
    api.post<{ success: boolean; message: string }>(`/stock-take/cancel/${id}`),

  import_batch: (id: number, items: Array<{
    item_code: string
    qty: number
    batch_no?: string
    expiry_date?: string
    mfg_date?: string
    mrp?: number
  }>) =>
    api.post<{
      success: boolean
      applied_count: number
      not_found_codes: string[]
      invalid_codes: string[]
      duplicate_codes: string[]
      counted_items: number
    }>(`/stock-take/import/${id}`, { items }),
}
