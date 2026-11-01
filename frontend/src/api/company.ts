import axios from './axios';

export interface CompanySettings {
    id: number;
    brand_name: string;
    ho_address: string;
    ho_email: string;
    ho_phone: string;
    logo_path: string;
    company_cin: string;
    company_tan: string;
    gstin: string;
    company_state: string;
    item_code_format: string;
    enable_markdown_calc: boolean;
    enable_channel_pricing: boolean;
    markdown_admin_only: boolean;
    minimum_global_margin: number;
    default_markdown_margin: number;
    enable_estimate_stock_check: boolean;
    block_estimate_if_no_stock: boolean;
    block_negative_stock: boolean;
    enable_bill_modify: boolean;
    enable_excel_import: boolean;
    enable_gst: boolean;
    default_cash_sale_mode: boolean;
    low_stock_threshold: number;
    show_product_img: boolean;
    hsn_code_length: number;
    strict_hsn_validation: boolean;
    // company profile
    legal_name: string | null; company_type: string | null; company_pan: string | null; state_code: string | null
    fssai_no: string | null; msme_no: string | null; iec_no: string | null
    reg_address: string | null; reg_city: string | null; reg_state: string | null; reg_pincode: string | null
    ho_city: string | null; ho_pincode: string | null; company_website: string | null; alt_phone: string | null
    bank_account_name: string | null; bank_name: string | null; bank_account_no: string | null; bank_ifsc: string | null
    bank_branch: string | null; upi_id: string | null
    authorized_signatory: string | null; signatory_designation: string | null
    invoice_terms: string | null; invoice_footer: string | null; fy_start_month: number; updated_at: string | null
    primary_color?: string | null;
    // Nutribray Manufacturing Settings
    enable_manufacturing?: boolean;
    mfg_company_name?: string | null;
    mfg_plant_locations?: string | null;
    mfg_departments?: string | null;
    production_stores?: string | null;
    raw_material_wh_id?: number | null;
    packaging_material_wh_id?: number | null;
    semi_finished_wh_id?: number | null;
    finished_goods_wh_id?: number | null;
    qc_quarantine_wh_id?: number | null;
    rejected_wh_id?: number | null;
    mfg_order_prefix?: string | null;
    bom_prefix?: string | null;
    production_batch_prefix?: string | null;
    require_bom_approval?: boolean;
    require_material_issue_approval?: boolean;
    require_production_completion_approval?: boolean;
    require_qc_release_for_fg?: boolean;
    allow_negative_raw_material_stock?: boolean;
    strict_fefo_enforcement?: boolean;
    default_stock_valuation_method?: string | null;
}

export interface company_doc {
    group: string; type: string; label: string; has_expiry: boolean
    status: 'missing' | 'valid' | 'expiring' | 'expired' | 'no_expiry'
    current: { id: number; doc_number: string | null; file_path: string; issue_date: string | null; expiry_date: string | null; notes: string | null; uploaded_by_name: string | null; created_at: string } | null
    history: { id: number; doc_number: string | null; file_path: string; expiry_date: string | null; created_at: string; uploaded_by_name: string | null }[]
}

export const company_api = {
    meta: () => axios.get<{ company_types: string[]; expiry_warn_days: number }>('/company/meta'),
    upload_logo: (file: File) => { const f = new FormData(); f.append('file', file); return axios.post<{ logo_path: string }>('/company/logo', f, { headers: { 'Content-Type': 'multipart/form-data' } }) },
    documents: () => axios.get<company_doc[]>('/company/documents'),
    upload_document: (f: FormData) => axios.post('/company/documents', f, { headers: { 'Content-Type': 'multipart/form-data' } }),
}

export const getCompanySettings = async () => {
    const response = await axios.get('/company/settings');
    return response.data;
};

export const updateCompanySettings = async (data: Partial<CompanySettings>) => {
    const response = await axios.post('/company/settings', data);
    return response.data;
};
