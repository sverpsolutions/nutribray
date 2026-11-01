import api from './axios'

export type PackagingType = 'LOOSE' | 'INNER_OUTER' | 'ONLY_OUTER'

export interface storage_type_type { id: number; name: string; is_active: boolean }
export interface temperature_category_type { id: number; name: string; is_active: boolean }

export interface packaging_config {
  id: number
  product_id: number
  item_code: string | null
  packaging_type: PackagingType
  
  base_uom_id: number | null
  purchase_uom_id: number | null
  sales_uom_id: number | null
  inner_pack_uom_id: number | null
  outer_carton_uom_id: number | null

  inner_pack_qty: number
  inner_packs_per_carton: number
  total_units_per_carton: number
  outer_carton_qty: number

  carton_length_cm: string | null
  carton_width_cm: string | null
  carton_height_cm: string | null
  carton_volume_cbm: string | null
  gross_weight_kg: string | null
  net_weight_kg: string | null
  unit_barcode: string | null
  inner_barcode: string | null
  carton_barcode: string | null
  
  shelf_life_days: number | null
  storage_type_id: number | null
  temperature_category_id: number | null

  rack_location: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface packaging_form {
  product_id: number
  item_code?: string | null
  packaging_type: PackagingType
  
  base_uom_id?: number | null
  purchase_uom_id?: number | null
  sales_uom_id?: number | null
  inner_pack_uom_id?: number | null
  outer_carton_uom_id?: number | null

  inner_pack_qty: number
  inner_packs_per_carton: number
  outer_carton_qty: number

  carton_length_cm?: number | null
  carton_width_cm?: number | null
  carton_height_cm?: number | null
  gross_weight_kg?: number | null
  net_weight_kg?: number | null
  unit_barcode?: string | null
  inner_barcode?: string | null
  carton_barcode?: string | null
  
  shelf_life_days?: number | null
  storage_type_id?: number | null
  temperature_category_id?: number | null

  rack_location?: string | null
  notes?: string | null
}

export const packaging_api = {
  get: (product_id: number) =>
    api.get<packaging_config | null>(`/packaging/product/${product_id}`),

  create: (data: packaging_form) =>
    api.post<packaging_config>('/packaging', data),

  update: (pkg_id: number, data: Partial<packaging_form>) =>
    api.put<packaging_config>(`/packaging/${pkg_id}`, data),

  delete: (pkg_id: number) =>
    api.delete(`/packaging/${pkg_id}`),

  list_storage_types: () =>
    api.get<storage_type_type[]>('/packaging/storage-types'),

  list_temperature_categories: () =>
    api.get<temperature_category_type[]>('/packaging/temperature-categories'),

  // Reports
  summary: () =>
    api.get<any[]>('/packaging/reports/summary'),

  missing: () =>
    api.get<any[]>('/packaging/reports/missing'),
}

// ── Calculation helpers (mirror backend logic, run in browser) ─────────────────
export function calcTotalUnits(innerQty: number, innerPacks: number): number {
  return Math.max(1, innerQty) * Math.max(1, innerPacks)
}

export function calcVolumeCBM(
  l: number | null | undefined,
  w: number | null | undefined,
  h: number | null | undefined,
): number | null {
  if (l && w && h && l > 0 && w > 0 && h > 0) {
    return parseFloat(((l * w * h) / 1_000_000).toFixed(8))
  }
  return null
}
