import api from './axios'

export interface channel_partner {
  id: number
  partner_name: string
  partner_code: string
  commission_percent: number
  settlement_days: number
  gst_on_commission: boolean
  delivery_charge: number
  packing_charge: number
  extra_margin: number
  is_active: boolean
  logo_url: string | null
  remarks: string | null
  created_at: string
  updated_at: string
}

export interface channel_price {
  id: number | null
  product_id: number
  partner_id: number
  partner_name: string
  partner_code: string
  mrp: number
  base_cost: number
  margin_percent: number
  partner_commission: number
  selling_price: number
  final_settlement_rate: number
  minimum_profit: number | null
  net_profit: number | null
  net_margin_pct: number | null
  is_active: boolean
  default_extra_margin?: number
  default_delivery?: number
  default_packing?: number
  settlement_days?: number
  logo_url?: string | null
}

export interface simulate_request {
  mrp: number
  cost_price: number
  gst_percent: number
  partner_commission: number
  extra_margin: number
  delivery_charge: number
  packing_charge: number
}

export interface simulate_result {
  selling_price: number
  settlement_rate: number
  net_profit: number
  net_margin_pct: number
  effective_cp: number
  commission_amount: number
  is_profitable: boolean
  profit_warning: string | null
}

export const channels_api = {
  get_partners: (active_only = false) => api.get<channel_partner[]>(`/channels/partners?active_only=${active_only}`),
  create_partner: (data: Partial<channel_partner>) => api.post<channel_partner>('/channels/partners', data),
  update_partner: (id: number, data: Partial<channel_partner>) => api.put<channel_partner>(`/channels/partners/${id}`, data),
  delete_partner: (id: number) => api.delete(`/channels/partners/${id}`),

  get_product_prices: (product_id: number) => api.get<{ prices: channel_price[], product_name: string, mrp: number, cost_price: number }>(`/channels/products/${product_id}/prices`),
  upsert_product_price: (product_id: number, data: Partial<channel_price>) => api.post(`/channels/products/${product_id}/prices`, data),
  delete_price: (price_id: number) => api.delete(`/channels/prices/${price_id}`),

  simulate: (data: simulate_request) => api.post<simulate_result>('/channels/simulate', data),
}
