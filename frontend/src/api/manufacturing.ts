import axios from './axios';

export interface MfgBomItem {
  id?: number;
  bom_id?: number;
  product_id: number;
  product_name?: string;
  item_code?: string;
  material_type: 'RAW_MATERIAL' | 'PACKAGING' | 'PREMIX' | 'CONSUMABLE';
  quantity: number;
  unit: string;
  wastage_pct: number;
  round_up?: boolean;
  preferred_store_id?: number | null;
  cost_per_unit: number;
  total_cost?: number;
  is_critical: boolean;
  stage?: string;
  sequence: number;
  notes?: string;
}

export interface MfgBom {
  id: number;
  bom_no: string;
  bom_name: string;
  product_id: number;
  product_name?: string;
  item_code?: string;
  unit?: string;
  revision: number;
  version_label: string;
  product_type: 'FINISHED' | 'SEMI_FINISHED' | 'INTERMEDIATE';
  batch_size: number;
  batch_unit: string;
  expected_yield_pct: number;
  tolerance_pct: number;
  expected_wastage_pct: number;
  valid_from?: string;
  valid_to?: string;
  status: 'DRAFT' | 'APPROVED' | 'OBSOLETE' | 'REJECTED';
  approved_by?: number;
  approved_at?: string;
  rejection_reason?: string;
  total_cost: number;
  labor_cost: number;
  overhead_cost: number;
  notes?: string;
  created_at: string;
  items: MfgBomItem[];
}

export interface MfgOrderItem {
  id: number;
  mfg_order_id: number;
  product_id: number;
  product_name?: string;
  item_code?: string;
  material_type: string;
  required_qty: number;
  reserved_qty: number;
  issued_qty: number;
  consumed_qty: number;
  returned_qty: number;
  unit: string;
  cost_per_unit: number;
  total_cost: number;
  status: string;
  batches?: MfgOrderBatch[];
}

export interface MfgOrderBatch {
  id: number;
  mfg_order_id: number;
  mfg_order_item_id: number;
  product_id: number;
  product_name?: string;
  item_code?: string;
  batch_id: number;
  batch_no: string;
  supplier_batch_no?: string;
  expiry_date?: string;
  reserved_qty: number;
  issued_qty: number;
  consumed_qty: number;
  returned_qty: number;
  status: string;
}

export interface MfgOrderOutput {
  id: number;
  mfg_order_id: number;
  output_no: string;
  product_id: number;
  product_name?: string;
  item_code?: string;
  batch_id?: number;
  batch_no: string;
  good_qty: number;
  rejected_qty: number;
  scrap_qty: number;
  unit: string;
  mfg_date: string;
  exp_date?: string;
  qc_status: 'PENDING' | 'RELEASED' | 'REJECTED' | 'QUARANTINED';
  qc_released_by?: number;
  qc_released_at?: string;
  qc_notes?: string;
  coa_attachment?: string;
  created_at: string;
}

export interface MfgOrder {
  id: number;
  order_no: string;
  product_id: number;
  product_name?: string;
  item_code?: string;
  bom_id: number;
  bom_no?: string;
  bom_revision?: number;
  planned_qty: number;
  completed_qty: number;
  unit: string;
  production_line?: string;
  department?: string;
  planned_start_date?: string;
  planned_end_date?: string;
  actual_start_date?: string;
  actual_end_date?: string;
  status: 'DRAFT' | 'APPROVED' | 'MATERIALS_RESERVED' | 'MATERIALS_ISSUED' | 'IN_PRODUCTION' | 'QC_PENDING' | 'COMPLETED' | 'CANCELLED';
  qc_status: 'PENDING' | 'RELEASED' | 'REJECTED' | 'QUARANTINED';
  production_batch_no?: string;
  production_batch_id?: number;
  estimated_cost: number;
  actual_cost: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  items?: MfgOrderItem[];
  batches?: MfgOrderBatch[];
  outputs?: MfgOrderOutput[];
}

export interface MfgDashboardData {
  stats: {
    active_orders: number;
    completed_orders: number;
    pending_qc: number;
    approved_boms: number;
    critical_shortages: number;
    rm_stock_alerts: number;
  };
  recent_orders: MfgOrder[];
  low_stock_raw_materials: Array<{
    id: number;
    item_code: string;
    name: string;
    current_stock: number;
    reserved_stock: number;
    available_stock: number;
    unit: string;
  }>;
}

export interface MaterialRequirementPlan {
  order_id: number;
  order_no: string;
  product_name: string;
  planned_qty: number;
  unit: string;
  has_shortage: boolean;
  total_shortage_items: number;
  items: Array<{
    product_id: number;
    item_code: string;
    product_name: string;
    material_type: string;
    required_qty: number;
    available_stock: number;
    reserved_qty: number;
    shortage_qty: number;
    unit: string;
    is_shortage: boolean;
    eligible_batches: Array<{
      batch_id: number;
      batch_no: string;
      current_qty: number;
      available_qty: number;
      expiry_date?: string;
      fefo_rank: number;
    }>;
  }>;
}

export interface TraceabilityGenealogy {
  search_batch: string;
  direction: 'FORWARD' | 'BACKWARD';
  product: {
    id: number;
    item_code: string;
    name: string;
    category?: string;
    unit?: string;
  };
  batch_details: {
    batch_no: string;
    supplier_batch_no?: string;
    mfg_date?: string;
    exp_date?: string;
    qc_status?: string;
    qc_release_date?: string;
    stock_qty?: number;
  };
  related_orders: any[];
  genealogy_records: any[];
}

export const manufacturingApi = {
  // Dashboard
  getDashboard: () => axios.get<MfgDashboardData>('/manufacturing/dashboard'),

  // BOMs
  getBoms: (params?: { product_id?: number; status?: string; search?: string }) =>
    axios.get<MfgBom[]>('/manufacturing/boms', { params }),
  getBom: (id: number) => axios.get<MfgBom>(`/manufacturing/boms/${id}`),
  createBom: (data: Partial<MfgBom>) => axios.post<MfgBom>('/manufacturing/boms', data),
  updateBom: (id: number, data: Partial<MfgBom>) => axios.put<MfgBom>(`/manufacturing/boms/${id}`, data),
  approveBom: (id: number) => axios.post<MfgBom>(`/manufacturing/boms/${id}/approve`, {}),
  rejectBom: (id: number, reason: string) =>
    axios.post<MfgBom>(`/manufacturing/boms/${id}/reject`, null, { params: { reason } }),
  cloneBomRevision: (id: number) => axios.post<MfgBom>(`/manufacturing/boms/${id}/clone-revision`),

  // Orders
  getOrders: (params?: { status?: string; product_id?: number; search?: string }) =>
    axios.get<MfgOrder[]>('/manufacturing/orders', { params }),
  getOrder: (id: number) => axios.get<MfgOrder>(`/manufacturing/orders/${id}`),
  createOrder: (data: {
    product_id: number;
    bom_id: number;
    planned_qty: number;
    unit?: string;
    department?: string;
    planned_start_date?: string;
    planned_end_date?: string;
    notes?: string;
  }) => axios.post<MfgOrder>('/manufacturing/orders', data),
  approveOrder: (id: number) => axios.post<MfgOrder>(`/manufacturing/orders/${id}/approve`),
  cancelOrder: (id: number, reason?: string) =>
    axios.post<MfgOrder>(`/manufacturing/orders/${id}/cancel`, null, { params: { reason } }),

  // Planning, Reservation & Issues
  planOrder: (id: number) => axios.get<MaterialRequirementPlan>(`/manufacturing/orders/${id}/plan`),
  reserveMaterials: (
    id: number,
    items?: Array<{ product_id: number; batch_id: number; batch_no: string; qty: number }>
  ) => axios.post<MfgOrder>(`/manufacturing/orders/${id}/reserve`, { items }),
  issueMaterials: (
    id: number,
    items: Array<{ product_id: number; batch_id: number; batch_no: string; qty: number }>
  ) => axios.post<MfgOrder>(`/manufacturing/orders/${id}/issue`, { items }),
  consumeMaterials: (
    id: number,
    data: {
      consumed_items: Array<{ product_id: number; batch_id: number; batch_no: string; qty: number }>;
      returned_items?: Array<{ product_id: number; batch_id: number; batch_no: string; qty: number }>;
    }
  ) => axios.post<MfgOrder>(`/manufacturing/orders/${id}/consume`, data),

  // Production Output & QC
  recordOutput: (
    id: number,
    data: {
      batch_no?: string;
      good_qty: number;
      rejected_qty?: number;
      scrap_qty?: number;
      unit?: string;
      mfg_date?: string;
      exp_date?: string;
      notes?: string;
    }
  ) => axios.post<MfgOrderOutput>(`/manufacturing/orders/${id}/output`, data),
  qcRelease: (
    outputId: number,
    data: {
      qc_status: 'RELEASED' | 'REJECTED' | 'QUARANTINED';
      qc_notes?: string;
      coa_attachment?: string;
      destination_warehouse_id?: number;
    }
  ) => axios.post<MfgOrderOutput>(`/manufacturing/qc-release/${outputId}`, data),

  // Shortage Purchase Order
  createShortagePo: (
    id: number,
    data: {
      supplier_id?: number;
      items: Array<{
        product_id: number;
        qty: number;
        rate?: number;
        required_by?: string;
      }>;
    }
  ) => axios.post<{ success: boolean; po_id: number; po_number: string; message: string }>(
    `/manufacturing/orders/${id}/create-shortage-po`,
    data
  ),

  // Batch Traceability
  traceForward: (batchNo: string) =>
    axios.get<TraceabilityGenealogy>('/manufacturing/traceability/forward', { params: { batch_no: batchNo } }),
  traceBackward: (batchNo: string) =>
    axios.get<TraceabilityGenealogy>('/manufacturing/traceability/backward', { params: { batch_no: batchNo } }),

  // Reports
  getConsumptionReport: () => axios.get<any[]>('/manufacturing/reports/consumption-variance'),
  getYieldReport: () => axios.get<any[]>('/manufacturing/reports/production-yield'),
  getPackagingUtilizationReport: () => axios.get<any[]>('/manufacturing/reports/packaging-utilization'),
};
