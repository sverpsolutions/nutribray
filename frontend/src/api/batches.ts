import api from './axios'

export interface ProductBatch {
  id: number
  product_id: number
  product_name?: string
  item_code?: string
  barcode?: string | null
  category_name?: string | null
  brand_name?: string | null
  batch_no: string
  supplier_batch_no?: string | null
  supplier_id?: number | null
  supplier_name?: string | null
  supplier_phone?: string | null
  supplier_contact_name?: string | null
  supplier_code?: string | null
  supplier_email?: string | null
  mfg_date?: string | null
  exp_date?: string | null
  first_receipt_date?: string | null
  purchase_rate: number
  cost_price: number
  mrp: number
  selling_price: number
  status: 'Active' | 'Near Expiry' | 'Expired' | 'Quarantined' | 'Recalled' | 'Closed'
  notes?: string | null
  total_stock: number
  total_current_qty?: number
  days_to_expiry?: number | null
  value_at_risk_cost?: number
  value_at_risk_mrp?: number
  created_at?: string
  updated_at?: string
}

export interface BatchKPIs {
  total_batches: number
  active_batches: number
  near_expiry_5d?: number
  near_expiry_15d?: number
  near_expiry_7d?: number
  near_expiry_30d?: number
  near_expiry_60d?: number
  near_expiry_90d?: number
  expired_batches: number
  quarantined_batches: number
  recalled_batches?: number
  total_stock_units?: number
  value_at_risk_cost?: number
  value_at_risk_mrp?: number
  stock_value_at_risk?: number
}

export interface BatchFilterParams {
  page?: number
  limit?: number
  per_page?: number
  product_id?: number
  supplier_id?: number
  location_id?: number
  status?: string
  days_to_expiry?: number
  min_days?: number
  max_days?: number
  has_stock_only?: boolean
  search?: string
}

export interface BatchExpiryReportSummary {
  total_records: number
  total_stock_units: number
  total_cost_value: number
  total_mrp_value: number
  expired_count: number
  next_5d_count: number
  next_15d_count: number
  next_30d_count: number
}

export interface BatchExpiryReportResponse {
  summary: BatchExpiryReportSummary
  data: ProductBatch[]
  total: number
  page: number
  limit: number
}

export const batches_api = {
  list: (params?: BatchFilterParams) =>
    api.get<ProductBatch[]>('/batches', {
      params: {
        ...params,
        limit: params?.per_page || params?.limit || 50,
      }
    }),

  get_expiry_report: (params?: {
    window?: string
    custom_days?: number
    supplier_id?: number
    location_id?: number
    has_stock_only?: boolean
    search?: string
    page?: number
    limit?: number
  }) =>
    api.get<BatchExpiryReportResponse>('/batches/expiry-report', { params }),

  get_kpis: (location_id?: number) =>
    api.get<BatchKPIs>('/batches/kpis', { params: { location_id } }),

  get_available: (productId: number, locationId?: number, requiredQty?: number) =>
    api.get<Array<{
      batch_id: number
      batch_no: string
      mfg_date?: string | null
      exp_date?: string | null
      available_qty?: number
      current_qty?: number
      mrp: number
      selling_price: number
      cost_price: number
      status: string
      days_to_expiry?: number | null
    }>>(`/batches/product/${productId}/available`, { params: { location_id: locationId, required_qty: requiredQty } }),

  create: (data: Partial<ProductBatch>) =>
    api.post<ProductBatch>('/batches', data),

  update_status: (batchId: number, status: string, reason?: string) =>
    api.patch(`/batches/${batchId}/status`, { status, reason }),

  migrate_legacy: (dryRun = true) =>
    api.post<{ message: string; migrated_batches_created: number }>('/batches/migrate-legacy', null, { params: { dry_run: dryRun } }),
}
