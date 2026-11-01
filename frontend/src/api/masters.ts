import api from './axios'

export interface brand_type { id: number; name: string; code?: string; manufacturer_id: number | null; subcategory_id?: number; subcategory_name?: string; short_name?: string; is_active: boolean; created_by_name?: string }
export interface category_type { id: number; name: string; parent_id: number; short_name?: string; status: boolean }
export interface unit_type { id: number; unit_code: string; unit_name: string; unit_type: string; is_active: boolean }
export interface gst_type { id: number; tax_name: string; gst_percent: string; cgst_pct: string; sgst_pct: string; igst_pct: string; is_active: boolean }
export interface hsn_type { id: number; hsn_code: string; code_type: string; category_type: string; description: string | null; gst_percent: string; cgst_pct: string; sgst_pct: string; igst_pct: string; is_active: boolean }
export interface manufacturer_type { id: number; name: string; code: string | null; country: string | null; is_active: boolean }
export interface item_group_type { id: number; name: string; code: string | null; short_name?: string; is_active: boolean; created_by_name?: string }
export interface item_subgroup_type { id: number; group_id: number; group_name?: string; name: string; code: string | null; short_name?: string; is_active: boolean; created_by_name?: string }
export interface item_subcategory_type { id: number; category_id: number; category_name?: string; name: string; code: string | null; short_name?: string; default_hsn_id?: number; is_active: boolean; created_by_name?: string }
export interface sub_category_brand_type { id: number; name: string; brand_id: number; brand_name?: string; subcategory_id: number; code?: string | null; short_name?: string; is_active: boolean; created_by_name?: string }
export interface item_category_type { id: number; subgroup_id: number | null; subgroup_name?: string; name: string; code: string | null; short_name?: string; is_active: boolean; created_by_name?: string }
export interface country_type { id: number; name: string; code: string | null; is_active: boolean }
export interface sub_manufacturer_type { id: number; manufacturer_id: number; name: string; code: string | null; is_active: boolean }
export interface variant_type { id: number; name: string; code: string | null; is_active: boolean }
export interface flavour_type { id: number; name: string; code: string | null; is_active: boolean }
export interface product_classification_type { id: number; name: string; meaning: string | null; is_active: boolean }

export const masters_api = {
  // brands
  get_brands: () => api.get<brand_type[]>('/masters/brands'),
  get_sub_brands: (brand_id?: number, subcategory_id?: number) => {
    const params: any = {};
    if (brand_id) params.brand_id = brand_id;
    if (subcategory_id) params.subcategory_id = subcategory_id;
    return api.get<sub_category_brand_type[]>('/masters/sub-brands', { params });
  },
  create_brand: (data: { name: string; code?: string; short_name?: string; manufacturer_id?: number; subcategory_id?: number }) => api.post('/masters/brands', data),
  update_brand: (id: number, data: { name?: string; short_name?: string; manufacturer_id?: number; subcategory_id?: number; is_active?: boolean }) => api.put(`/masters/brands/${id}`, data),
  delete_brand: (id: number) => api.delete(`/masters/brands/${id}`),

  // countries
  get_countries: () => api.get<country_type[]>('/masters/countries'),
  create_country: (data: { name: string; code?: string }) => api.post('/masters/countries', data),

  // categories
  get_categories: () => api.get<category_type[]>('/masters/categories'),
  create_category: (data: { name: string; parent_id?: number }) => api.post('/masters/categories', data),
  delete_category: (id: number) => api.delete(`/masters/categories/${id}`),

  // units
  get_units: () => api.get<unit_type[]>('/masters/units'),
  create_unit: (data: { unit_code: string; unit_name: string; unit_type?: string }) => api.post('/masters/units', data),
  delete_unit: (id: number) => api.delete(`/masters/units/${id}`),

  // gst
  get_gst: () => api.get<gst_type[]>('/masters/gst'),
  create_gst: (data: object) => api.post('/masters/gst', data),
  delete_gst: (id: number) => api.delete(`/masters/gst/${id}`),

  // hsn
  get_hsn: (params?: { page?: number; per_page?: number; search?: string; code_type?: string }) =>
    api.get('/masters/hsn', { params }),
  get_hsn_by_id: (id: number) => api.get<hsn_type>(`/masters/hsn/${id}`),
  create_hsn: (data: { hsn_code: string; code_type: string; category_type?: string; description?: string; gst_percent: number; cgst_pct: number; sgst_pct: number; igst_pct: number }) => api.post('/masters/hsn', data),
  update_hsn: (id: number, data: object) => api.put(`/masters/hsn/${id}`, data),
  delete_hsn: (id: number) => api.delete(`/masters/hsn/${id}`),

  // manufacturers
  get_manufacturers: () => api.get<manufacturer_type[]>('/masters/manufacturers'),
  create_manufacturer: (data: object) => api.post('/masters/manufacturers', data),
  delete_manufacturer: (id: number) => api.delete(`/masters/manufacturers/${id}`),

  get_sub_manufacturers: (manufacturer_id?: number) => api.get<sub_manufacturer_type[]>('/masters/sub-manufacturers' + (manufacturer_id ? `?manufacturer_id=${manufacturer_id}` : '')),
  create_sub_manufacturer: (data: { manufacturer_id: number; name: string; code?: string }) => api.post('/masters/sub-manufacturers', data),
  update_sub_manufacturer: (id: number, data: { manufacturer_id?: number; name?: string; code?: string; is_active?: boolean }) => api.put(`/masters/sub-manufacturers/${id}`, data),
  delete_sub_manufacturer: (id: number) => api.delete(`/masters/sub-manufacturers/${id}`),

  // item hierarchy
  get_item_groups: () => api.get<item_group_type[]>('/masters/item-groups'),
  create_item_group: (data: { name: string; code?: string; short_name?: string }) => api.post('/masters/item-groups', data),
  update_item_group: (id: number, data: { name?: string; short_name?: string; is_active?: boolean }) => api.put(`/masters/item-groups/${id}`, data),
  
  get_item_subgroups: (group_id?: number) => api.get<item_subgroup_type[]>('/masters/item-subgroups' + (group_id ? `?group_id=${group_id}` : '')),
  create_item_subgroup: (data: { group_id: number; name: string; code?: string; short_name?: string }) => api.post('/masters/item-subgroups', data),
  update_item_subgroup: (id: number, data: { group_id?: number; name?: string; short_name?: string; is_active?: boolean }) => api.put(`/masters/item-subgroups/${id}`, data),

  get_item_categories: (subgroup_id?: number) => api.get<item_category_type[]>('/masters/item-categories' + (subgroup_id ? `?subgroup_id=${subgroup_id}` : '')),
  create_item_category: (data: { subgroup_id: number; name: string; code?: string; short_name?: string }) => api.post('/masters/item-categories', data),
  update_item_category: (id: number, data: { subgroup_id?: number; name?: string; short_name?: string; is_active?: boolean }) => api.put(`/masters/item-categories/${id}`, data),

  get_item_subcategories: (category_id?: number) => api.get<item_subcategory_type[]>('/masters/item-subcategories' + (category_id ? `?category_id=${category_id}` : '')),
  create_item_subcategory: (data: { category_id: number; name: string; code?: string; short_name?: string; default_hsn_id?: number }) => api.post('/masters/item-subcategories', data),
  update_item_subcategory: (id: number, data: { category_id?: number; name?: string; short_name?: string; default_hsn_id?: number; is_active?: boolean }) => api.put(`/masters/item-subcategories/${id}`, data),
  get_suggested_hsn: (subcategory_id: number) => api.get<hsn_type>(`/masters/suggested-hsn/${subcategory_id}`),

  create_sub_brand: (data: { name: string; brand_id: number; subcategory_id: number; code?: string; short_name?: string }) => api.post('/masters/sub-brands', data),
  update_sub_brand: (id: number, data: { name?: string; brand_id?: number; subcategory_id?: number; short_name?: string; is_active?: boolean }) => api.put(`/masters/sub-brands/${id}`, data),
  
  // outlets
  get_outlets: () => api.get<any[]>('/outlets'),

  // variants
  get_variants: () => api.get<variant_type[]>('/masters/variants'),
  create_variant: (data: { name: string; code?: string }) => api.post('/masters/variants', data),
  update_variant: (id: number, data: { name?: string; code?: string; is_active?: boolean }) => api.put(`/masters/variants/${id}`, data),
  delete_variant: (id: number) => api.delete(`/masters/variants/${id}`),

  // flavours
  get_flavours: () => api.get<flavour_type[]>('/masters/flavours'),
  create_flavour: (data: { name: string; code?: string }) => api.post('/masters/flavours', data),
  update_flavour: (id: number, data: { name?: string; code?: string; is_active?: boolean }) => api.put(`/masters/flavours/${id}`, data),
  delete_flavour: (id: number) => api.delete(`/masters/flavours/${id}`),

  // product classifications
  get_product_classifications: () => api.get<product_classification_type[]>('/masters/product-classifications'),
  create_product_classification: (data: { name: string; meaning?: string }) => api.post('/masters/product-classifications', data),
  update_product_classification: (id: number, data: { name?: string; meaning?: string; is_active?: boolean }) => api.put(`/masters/product-classifications/${id}`, data),
  delete_product_classification: (id: number) => api.delete(`/masters/product-classifications/${id}`),
}
