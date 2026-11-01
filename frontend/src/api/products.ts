import api from './axios'

export interface product_list_item {
  item_type?: string | null
  id: number
  name: string
  item_code: string | null
  category: string
  brand: string | null
  manufacturer_name?: string | null
  needs_printing?: boolean
  unit: string
  selling_price: string
  mrp: string
  gst_percent: string
  stock_qty: string
  barcode: string | null
  is_active: boolean
  status: boolean
  inner_pack_qty?: number
  outer_carton_qty?: number
  total_pcs_in_carton?: number
  thumbnail_img?: string | null
}

export interface product_detail extends product_list_item {
  print_name: string | null
  category_id: number | null
  subcategory: string | null
  subcategory_id: number | null
  brand_id: number | null
  sub_category_brand_id: number | null
  hsn_code: string | null
  hsn_id: number | null
  unit_id: number | null
  purchase_price: string
  cost_price: string
  basic_cost: string
  wsp: string
  barcode_crt: string | null
  model_no: string | null
  manufacturer_id: number | null
  manufacturer_name: string | null
  needs_printing?: boolean
  group_id: number | null
  subgroup_id: number | null
  supplier_id: number | null
  country_id: number | null
  low_stock_threshold: number
  min_stock: string
  reorder_level: string
  max_stock_level: string
  rack_no: string | null
  aisle_no: string | null
  variant: string | null
  size: string | null
  weight_kg: string | null
  shelf_life_days: number | null
  expiry_date: string | null
  ref_item_code: string | null
  thumbnail_img: string | null
  img_front?: string | null
  img_back?: string | null
  img_top?: string | null
  img_side?: string | null
  code?: string | null
  allow_neg_stock: boolean
  is_dual_unit: boolean
  is_consumable: boolean
  is_raw_material: boolean
  is_sellable: boolean
  is_raw_non_sellable: boolean
  is_batch_required: boolean
  has_batch_tracking?: boolean
  has_expiry_tracking?: boolean
  mfg_date_required?: boolean
  exp_date_required?: boolean
  min_shelf_life_purchase_days?: number | null
  min_shelf_life_sale_days?: number | null
  near_expiry_alert_days?: number
  allow_expired_sale?: boolean
  allow_neg_batch_stock?: boolean
  batch_wise_purchase_rate?: boolean
  batch_wise_selling_price?: boolean
  is_fefo_enabled?: boolean
  is_asset: boolean
  multiplier_to_base: string
  conversion_factor: string
  purchase_unit: string | null
  cp_margin: string
  mrp_margin: string
  sp_margin: string
  wsp_margin: string
  created_at: string
  updated_at: string
}

export interface paginated<T> {
  data: T[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface product_search_item {
  id: number
  name: string
  item_code: string | null
  barcode: string | null
  unit: string
  purchase_price?: number | string
  cost_price?: number | string
  basic_cost?: number | string
  selling_price: string | number
  mrp: string | number
  barcode_crt?: string | null
  gst_percent?: string | number
  hsn_code?: string | null
  stock_qty?: string | number | null
  has_batch_tracking?: boolean
  has_expiry_tracking?: boolean
  is_batch_required?: boolean
  shelf_life_days?: number | null
}


export const products_api = {
  list: (params?: {
    page?: number; per_page?: number; search?: string
    category_id?: number; brand_id?: number; classification_id?: number
    is_active?: boolean; low_stock?: boolean; item_type?: string
    base_uom_id?: number; purchase_uom_id?: number; storage_type_id?: number
  }) => api.get<paginated<product_list_item>>('/products', { params }),

  search: (q: string, limit = 20, outlet_id?: number) =>
    api.get<product_search_item[]>('/products/search', { params: { q, limit, outlet_id } }),

  get: (id: number) => api.get<product_detail>(`/products/${id}`),
  create: (data: object) => api.post<product_detail>('/products', data),
  update: (id: number, data: object) => api.put<product_detail>(`/products/${id}`, data),
  delete: (id: number) => api.delete(`/products/${id}`),

  get_barcodes: (product_id: number) => api.get(`/products/${product_id}/barcodes`),
  generate_barcode: (data: { product_id: number; barcode?: string; barcode_type?: string; is_primary?: boolean }) =>
    api.post('/products/barcode/generate', data),
  delete_barcode: (id: number) => api.delete(`/products/barcode/${id}`),
  lookup_barcode: (code: string) => api.get<product_detail>(`/products/lookup/barcode/${code}`),

  get_outlet_pricing: (id: number) => api.get<any[]>(`/products/${id}/outlet-pricing`),
  update_outlet_pricing: (id: number, data: any[]) => api.post(`/products/${id}/outlet-pricing`, data),
  get_activity: (id: number) => api.get<any[]>(`/products/${id}/activity`),
}
