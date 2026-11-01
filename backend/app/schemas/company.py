import re
from datetime import date, datetime
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Optional
from app.utils.gst_validators import (
    validate_gstin, validate_pan, validate_cin, extract_pan_from_gstin, extract_state_code_from_gstin, get_state_name,
)

COMPANY_TYPES = ("Private Limited", "Public Limited", "LLP", "Partnership", "Proprietorship", "OPC", "HUF", "Trust / Society")
_FORMATS = {
    "company_tan": (r"[A-Z]{4}[0-9]{5}[A-Z]", "TAN must look like DELA12345B"),
    "bank_ifsc": (r"[A-Z]{4}0[A-Z0-9]{6}", "IFSC must look like HDFC0001234"),
    "fssai_no": (r"[0-9]{14}", "FSSAI licence number is 14 digits"),
    "iec_no": (r"[A-Z0-9]{10}", "IEC is 10 characters"),
    "msme_no": (r"UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}", "Udyam number must look like UDYAM-DL-07-0012345"),
    "reg_pincode": (r"[1-9][0-9]{5}", "PIN code must be 6 digits"),
    "ho_pincode": (r"[1-9][0-9]{5}", "PIN code must be 6 digits"),
    "ho_email": (r"[^@\s]+@[^@\s]+\.[^@\s]+", "Invalid email address"),
    "upi_id": (r"[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}", "UPI ID must look like name@bank"),
}
_UPPER = ("gstin", "company_pan", "company_cin", "company_tan", "bank_ifsc", "iec_no", "msme_no")


class CompanySettingBase(BaseModel):
    brand_name: Optional[str] = None
    ho_address: Optional[str] = None
    ho_email: Optional[str] = None
    ho_phone: Optional[str] = None
    logo_path: Optional[str] = None
    company_cin: Optional[str] = None
    company_tan: Optional[str] = None
    item_code_format: Optional[str] = "[PREFIX]-[BRAND]-[VARIANT]-[SIZE]"

    enable_markdown_calc: bool = False
    # Channel & Markdown Pricing Engine
    enable_channel_pricing  : bool            = False
    markdown_admin_only     : bool            = True
    minimum_global_margin   : Optional[float] = 5.00
    default_markdown_margin : Optional[float] = 25.00
    enable_estimate_stock_check: bool = True
    block_estimate_if_no_stock: bool = False
    block_negative_stock: bool = False
    enable_bill_modify: bool = True
    enable_excel_import: bool = True
    enable_gst: bool = True
    default_cash_sale_mode: bool = True
    low_stock_threshold: int = 10
    show_product_img: bool = True
    hsn_code_length: int = 8
    strict_hsn_validation: bool = False
    gstin: Optional[str] = None
    company_state: Optional[str] = None

    # company profile
    legal_name: Optional[str] = None
    company_type: Optional[str] = None
    company_pan: Optional[str] = None
    state_code: Optional[str] = None
    fssai_no: Optional[str] = None
    msme_no: Optional[str] = None
    iec_no: Optional[str] = None
    reg_address: Optional[str] = None
    reg_city: Optional[str] = None
    reg_state: Optional[str] = None
    reg_pincode: Optional[str] = None
    ho_city: Optional[str] = None
    ho_pincode: Optional[str] = None
    company_website: Optional[str] = None
    alt_phone: Optional[str] = None
    bank_account_name: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_branch: Optional[str] = None
    upi_id: Optional[str] = None
    authorized_signatory: Optional[str] = None
    signatory_designation: Optional[str] = None
    invoice_terms: Optional[str] = None
    invoice_footer: Optional[str] = Field(None, max_length=200)
    fy_start_month: int = Field(4, ge=1, le=12)

    # Manufacturing Settings (Nutribray ERP)
    enable_manufacturing: bool = False
    mfg_company_name: Optional[str] = None
    mfg_plant_locations: Optional[str] = None
    mfg_departments: Optional[str] = None
    production_store_id: Optional[int] = None
    raw_material_warehouse_id: Optional[int] = None
    packaging_material_warehouse_id: Optional[int] = None
    semi_finished_store_id: Optional[int] = None
    finished_goods_warehouse_id: Optional[int] = None
    qc_store_id: Optional[int] = None
    quarantine_store_id: Optional[int] = None
    production_number_prefix: Optional[str] = "MFG-PROD-"
    mfg_order_number_prefix: Optional[str] = "MO-"
    batch_number_prefix: Optional[str] = "BAT-"
    require_bom_approval: bool = True
    require_material_issue_approval: bool = True
    require_production_completion_approval: bool = True
    require_qc_release: bool = True
    negative_stock_policy: str = "block"
    batch_tracking_required: bool = True
    expiry_tracking_required: bool = True
    default_stock_valuation_method: str = "FIFO"
    default_units_conversion_rules: Optional[str] = None
    mfg_document_print_settings: Optional[str] = None


class CompanySettingUpdate(CompanySettingBase):
    @field_validator("*", mode="before")
    @classmethod
    def clean(cls, v, info):
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return None
            if info.field_name in _UPPER:
                v = v.upper().replace(" ", "")
        return v

    @model_validator(mode="after")
    def rules(self):
        errors = []
        for f, (pat, msg) in _FORMATS.items():
            v = getattr(self, f)
            if v and not re.fullmatch(pat, v):
                errors.append(msg)
        if self.company_type and self.company_type not in COMPANY_TYPES:
            errors.append(f"Company type must be one of {', '.join(COMPANY_TYPES)}")
        if self.bank_account_no and not re.fullmatch(r"[0-9]{6,18}", self.bank_account_no):
            errors.append("Bank account number must be 6–18 digits")
        if self.company_pan:
            ok, err = validate_pan(self.company_pan)
            if not ok:
                errors.append(err)
        if self.gstin:
            ok, err = validate_gstin(self.gstin)  # format + state code + check digit
            if not ok:
                errors.append(err)
            else:
                # GSTIN is the source of truth for state + state code; PAN is inside it
                code = extract_state_code_from_gstin(self.gstin)
                self.state_code = code
                self.company_state = get_state_name(code) or self.company_state
                gst_pan = extract_pan_from_gstin(self.gstin)
                if self.company_pan and self.company_pan != gst_pan:
                    errors.append(f"PAN {self.company_pan} does not match the PAN inside the GSTIN ({gst_pan})")
                self.company_pan = self.company_pan or gst_pan
        if self.company_type == "LLP":
            if self.company_cin and not re.fullmatch(r"[A-Z]{3}-[0-9]{4}", self.company_cin):
                errors.append("LLPIN must look like AAB-1234")
        else:
            ok, err = validate_cin(self.company_cin, self.company_type)
            if not ok:
                errors.append(err)
        if errors:
            raise ValueError("; ".join(errors))
        return self


class CompanySettingOut(CompanySettingBase):
    id: int
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CompanyDocumentOut(BaseModel):
    id: int
    doc_type: str
    doc_number: Optional[str]
    file_path: str
    issue_date: Optional[date]
    expiry_date: Optional[date]
    notes: Optional[str]
    is_current: bool
    uploaded_by_name: Optional[str] = None
    created_at: datetime
