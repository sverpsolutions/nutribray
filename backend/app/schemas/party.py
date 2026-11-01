from datetime import datetime, date
from decimal import Decimal
from pydantic import BaseModel, Field, field_validator, model_validator
import re
from app.utils.gst_validators import (
    validate_gstin, validate_pan, validate_cin,
    extract_pan_from_gstin, extract_state_code_from_gstin,
    CIN_REQUIRED_TYPES, STATE_CODE_MAP, get_state_name,
)


# ── Validators ────────────────────────────────────────────────────────────────

def _validate_gst(v: str | None) -> str | None:
    if v is None or v.strip() == "":
        return None
    pattern = r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$"
    if not re.match(pattern, v.upper()):
        raise ValueError("invalid GST number format (e.g. 07ABCDE1234F1Z5)")
    return v.upper()


# ── Customer ──────────────────────────────────────────────────────────────────

CUSTOMER_TYPES = ("retail", "wholesale", "hotel", "institution")
GST_REG_TYPES = ("Regular", "Composition", "Unregistered", "Consumer", "SEZ")
_GST_REQUIRED = ("Regular", "Composition", "SEZ")


class _customer_fields(BaseModel):
    """Shared customer fields + GST rules. All optional so update can reuse it."""
    name: str | None = None
    phone: str | None = None
    alt_phone: str | None = None
    email: str | None = None
    contact_person: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    pincode: str | None = None
    shipping_address: str | None = None
    shipping_city: str | None = None
    shipping_state: str | None = None
    shipping_pincode: str | None = None
    type: str | None = None
    gst_registration_type: str | None = None
    gst_number: str | None = None
    pan_number: str | None = None
    state_code: str | None = None
    credit_limit: Decimal | None = Field(None, ge=0)
    credit_days: int | None = Field(None, ge=0, le=365)
    discount_percent: Decimal | None = Field(None, ge=0, le=100)
    notes: str | None = None
    show_outstanding_in_print: bool | None = None

    @field_validator("*", mode="before")
    @classmethod
    def strip_blank(cls, v):
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str | None) -> str | None:
        if v is not None and v not in CUSTOMER_TYPES:
            raise ValueError("type must be retail / wholesale / hotel / institution")
        return v

    @field_validator("gst_registration_type")
    @classmethod
    def validate_reg_type(cls, v: str | None) -> str | None:
        if v is not None and v not in GST_REG_TYPES:
            raise ValueError(f"GST registration type must be one of {', '.join(GST_REG_TYPES)}")
        return v

    @field_validator("phone", "alt_phone")
    @classmethod
    def validate_phone(cls, v: str | None) -> str | None:
        if v is not None and not re.fullmatch(r"\+?[0-9][0-9 \-]{5,14}", v):
            raise ValueError("invalid phone number")
        return v

    @field_validator("pincode", "shipping_pincode")
    @classmethod
    def validate_pincode(cls, v: str | None) -> str | None:
        if v is not None and not re.fullmatch(r"[1-9][0-9]{5}", v):
            raise ValueError("pincode must be 6 digits")
        return v

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str | None) -> str | None:
        if v is not None and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("invalid email address")
        return v

    @field_validator("pan_number")
    @classmethod
    def validate_pan_no(cls, v: str | None) -> str | None:
        if v is None:
            return None
        ok, err = validate_pan(v.upper())
        if not ok:
            raise ValueError(err)
        return v.upper()

    @field_validator("gst_number")
    @classmethod
    def validate_gst(cls, v: str | None) -> str | None:
        if v is None:
            return None
        ok, err = validate_gstin(v)  # format + state code + checksum
        if not ok:
            raise ValueError(err)
        return v.upper()

    @model_validator(mode="after")
    def gst_rules(self):
        # GSTIN is the source of truth for state code, state name and PAN
        if self.gst_number:
            code = extract_state_code_from_gstin(self.gst_number)
            self.state_code = code
            self.state = get_state_name(code) or self.state
            self.pan_number = extract_pan_from_gstin(self.gst_number)
            if self.gst_registration_type in (None, "Unregistered", "Consumer"):
                self.gst_registration_type = "Regular"
        elif self.gst_registration_type in _GST_REQUIRED:
            raise ValueError(f"GSTIN is required for {self.gst_registration_type} registration")
        elif "gst_number" in self.model_fields_set and self.gst_registration_type is None:
            self.gst_registration_type = "Unregistered"
        if not self.gst_number and self.state and not self.state_code:
            self.state_code = next((c for c, n in STATE_CODE_MAP.items() if n == self.state), None)
        return self


class customer_create(_customer_fields):
    name: str
    phone: str
    state: str = "Delhi"
    type: str = "retail"
    gst_registration_type: str = "Unregistered"
    customer_code: str | None = None  # auto-generated when blank
    credit_limit: Decimal = Field(Decimal("0.00"), ge=0)
    credit_days: int = Field(0, ge=0, le=365)
    discount_percent: Decimal = Field(Decimal("0.00"), ge=0, le=100)
    opening_balance: Decimal = Decimal("0.00")
    show_outstanding_in_print: bool = False


class customer_update(_customer_fields):
    status: bool | None = None
    portal_active: bool | None = None


class customer_out(BaseModel):
    id: int
    customer_code: str | None
    name: str
    phone: str
    alt_phone: str | None
    email: str | None
    contact_person: str | None
    address: str | None
    city: str | None
    state: str
    state_code: str | None
    pincode: str | None
    shipping_address: str | None
    shipping_city: str | None
    shipping_state: str | None
    shipping_pincode: str | None
    type: str
    gst_registration_type: str | None
    gst_number: str | None
    pan_number: str | None
    credit_limit: Decimal
    credit_days: int | None
    discount_percent: Decimal | None
    balance: Decimal
    opening_balance: Decimal
    notes: str | None
    status: bool
    show_outstanding_in_print: bool
    portal_active: bool
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class customer_list_out(BaseModel):
    id: int
    customer_code: str | None
    name: str
    phone: str
    email: str | None
    contact_person: str | None
    city: str | None
    state: str | None
    type: str
    gst_registration_type: str | None
    gst_number: str | None
    balance: Decimal
    credit_limit: Decimal
    credit_days: int | None
    status: bool
    model_config = {"from_attributes": True}


class customer_summary(BaseModel):
    total: int
    active: int
    wholesale: int
    b2b: int
    outstanding: Decimal


# ── Supplier ──────────────────────────────────────────────────────────────────

# ── Supplier V2 ──────────────────────────────────────────────────────────────

class supplier_address_schema(BaseModel):
    id: int | None = None
    address_type: str = "Billing"
    address: str
    country: str = "India"
    state: str
    city: str
    pincode: str
    model_config = {"from_attributes": True}

class supplier_legal_schema(BaseModel):
    registration_type: str = "Regular"
    gst_no: str | None = None
    pan_no: str | None = None
    tan_no: str | None = None
    cin_no: str | None = None
    model_config = {"from_attributes": True}

class supplier_contact_schema(BaseModel):
    id: int | None = None
    name: str
    mobile: str
    email: str | None = None
    is_primary: bool = False
    model_config = {"from_attributes": True}

class supplier_director_schema(BaseModel):
    id: int | None = None
    director_name: str
    din: str | None = None
    email: str | None = None
    phone: str | None = None
    model_config = {"from_attributes": True}

class supplier_auth_person_schema(BaseModel):
    id: int | None = None
    name: str
    designation: str
    mobile: str
    email: str | None = None
    photo_path: str | None = None
    id_proof_path: str | None = None
    is_active: bool = True
    model_config = {"from_attributes": True}

class supplier_brand_schema(BaseModel):
    brand_id: int
    brand_name: str | None = None
    credit_days: int = 0
    model_config = {"from_attributes": True}

class supplier_brand_create(BaseModel):
    brand_id: int
    credit_days: int = 0

class supplier_financial_schema(BaseModel):
    bank_name: str | None = None
    account_no: str | None = None
    ifsc_code: str | None = None
    branch: str | None = None
    credit_limit: Decimal = Decimal("0.00")
    credit_days: int = 0
    model_config = {"from_attributes": True}

class supplier_document_schema(BaseModel):
    id: int | None = None
    document_type: str
    file_path: str
    start_date: date | None = None
    end_date: date | None = None
    notes: str | None = None
    model_config = {"from_attributes": True}

class supplier_note_schema(BaseModel):
    id: int | None = None
    note: str
    note_type: str = "internal"
    created_by_name: str | None = None
    created_at: datetime | None = None
    model_config = {"from_attributes": True}


class approval_log_out(BaseModel):
    id: int
    action: str
    from_status: str | None = None
    to_status: str | None = None
    remarks: str | None = None
    performed_by_name: str | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


# Request body for approval actions (approve/reject/hold/request_correction)
class approval_action_body(BaseModel):
    remarks: str = ""
    correction_fields: list[str] = []   # used for request_correction action


class supplier_gstin_schema(BaseModel):
    """Single GSTIN registration record (multi-state support)."""
    id: int | None = None
    gstin: str
    state_code: str
    state_name: str | None = None
    pan: str
    registration_type: str = "Regular"
    is_primary: bool = False
    is_active: bool = True
    model_config = {"from_attributes": True}

    @field_validator("gstin")
    @classmethod
    def _val_gstin(cls, v: str) -> str:
        v = v.strip().upper()
        ok, err = validate_gstin(v)
        if not ok:
            raise ValueError(err)
        return v

    @field_validator("pan")
    @classmethod
    def _val_pan(cls, v: str) -> str:
        v = v.strip().upper()
        ok, err = validate_pan(v)
        if not ok:
            raise ValueError(err)
        return v


class supplier_create(BaseModel):
    name: str
    phone: str
    supplier_code: str | None = None
    supplier_type: str = "Manufacturer"
    company_type: str | None = None
    category: str | None = None
    contact_name: str | None = None
    email: str | None = None
    address: str | None = None
    city: str | None = None
    state: str = "Delhi"
    state_code: str | None = None     # 2-digit GST state code
    pincode: str | None = None
    district: str | None = None
    country: str | None = None
    gst_number: str | None = None     # primary GSTIN (kept for backward compat)
    pan_number: str | None = None     # auto-populated from GSTIN
    cin_number: str | None = None     # CIN — mandatory for Pvt Ltd / Limited
    opening_balance: Decimal = Decimal("0.00")
    credit_limit_days: int = 0
    website: str | None = None
    notes: str | None = None
    registration_status: str = "approved"
    onboarding_token: str | None = None
    trade_name: str | None = None
    designation: str | None = None
    alt_phone: str | None = None
    alt_email: str | None = None
    msme_number: str | None = None
    fssai_number: str | None = None
    tan_number: str | None = None
    business_constitution: str | None = None
    product_categories: list[str] | dict | None = None
    company_description: str | None = None
    portal_sales_enabled: bool = False
    portal_sales_config: dict | None = None

    # Nested data
    addresses: list[supplier_address_schema] = []
    legal: supplier_legal_schema | None = None
    contacts: list[supplier_contact_schema] = []
    directors: list[supplier_director_schema] = []
    auth_persons: list[supplier_auth_person_schema] = []
    brands: list[supplier_brand_create] = []
    financial: supplier_financial_schema | None = None
    documents: list[supplier_document_schema] = []
    gstins: list[supplier_gstin_schema] = []   # multi-state GSTIN list

    @field_validator("gst_number")
    @classmethod
    def _val_gstin(cls, v: str | None) -> str | None:
        if not v or v.strip() == "":
            return None
        v = v.strip().upper()
        ok, err = validate_gstin(v)
        if not ok:
            raise ValueError(err)
        return v

    @field_validator("pan_number")
    @classmethod
    def _val_pan(cls, v: str | None) -> str | None:
        if not v or v.strip() == "":
            return None
        v = v.strip().upper()
        ok, err = validate_pan(v)
        if not ok:
            raise ValueError(err)
        return v

    @field_validator("cin_number")
    @classmethod
    def _val_cin(cls, v: str | None) -> str | None:
        if not v or v.strip() == "":
            return None
        v = v.strip().upper()
        ok, err = validate_cin(v, company_type=None)   # format only; cross-check in model_validator
        if not ok:
            raise ValueError(err)
        return v

    @model_validator(mode="after")
    def _cross_validate(self) -> "supplier_create":
        # 1. CIN mandatory for Pvt Ltd / Limited
        if self.company_type and self.company_type in CIN_REQUIRED_TYPES:
            if not self.cin_number:
                raise ValueError(
                    f"CIN Number is mandatory for {self.company_type} companies"
                )

        # 2. Auto-populate PAN from primary GSTIN if not explicitly supplied
        if self.gst_number and not self.pan_number:
            self.pan_number = extract_pan_from_gstin(self.gst_number)

        # 3. Auto-populate state_code from primary GSTIN if not set
        if self.gst_number and not self.state_code:
            self.state_code = extract_state_code_from_gstin(self.gst_number)

        # 4. GSTIN state code must match supplied state_code (if both present)
        if self.gst_number and self.state_code:
            gstin_sc = extract_state_code_from_gstin(self.gst_number)
            if gstin_sc != self.state_code:
                from app.utils.gst_validators import STATE_CODE_MAP
                gstin_sn = STATE_CODE_MAP.get(gstin_sc, gstin_sc)
                supp_sn = STATE_CODE_MAP.get(self.state_code, self.state_code)
                raise ValueError(
                    f"GSTIN State Code '{gstin_sc}' ({gstin_sn}) does not match "
                    f"selected state '{self.state_code}' ({supp_sn})"
                )

        return self


class supplier_update(BaseModel):
    name: str | None = None
    trade_name: str | None = None
    phone: str | None = None
    alt_phone: str | None = None
    email: str | None = None
    alt_email: str | None = None
    supplier_code: str | None = None
    supplier_type: str | None = None
    company_type: str | None = None
    category: str | None = None
    contact_name: str | None = None
    designation: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    state_code: str | None = None
    pincode: str | None = None
    district: str | None = None
    country: str | None = None
    gst_number: str | None = None
    pan_number: str | None = None
    cin_number: str | None = None
    msme_number: str | None = None
    fssai_number: str | None = None
    tan_number: str | None = None
    business_constitution: str | None = None
    product_categories: list[str] | dict | None = None
    company_description: str | None = None
    website: str | None = None
    credit_limit_days: int | None = None
    opening_balance: Decimal | None = None
    notes: str | None = None
    registration_status: str | None = None
    status: bool | None = None
    portal_sales_enabled: bool | None = None
    portal_sales_config: dict | None = None


class supplier_out(BaseModel):
    id: int
    supplier_code: str | None
    name: str
    supplier_type: str
    company_type: str | None
    category: str | None
    contact_name: str | None = None
    phone: str
    email: str | None
    address: str | None
    city: str | None
    state: str
    state_code: str | None = None
    pincode: str | None
    district: str | None
    country: str | None
    gst_number: str | None
    pan_number: str | None
    cin_number: str | None = None
    opening_balance: Decimal
    credit_limit_days: int
    website: str | None = None
    notes: str | None
    registration_status: str
    onboarding_token: str | None = None
    status: bool
    created_at: datetime
    # Approval tracking
    approved_by: int | None = None
    approved_at: datetime | None = None
    rejection_reason: str | None = None
    correction_notes: str | None = None
    trade_name: str | None = None
    designation: str | None = None
    alt_phone: str | None = None
    alt_email: str | None = None
    msme_number: str | None = None
    fssai_number: str | None = None
    tan_number: str | None = None
    business_constitution: str | None = None
    product_categories: list[str] | dict | None = None
    company_description: str | None = None
    portal_sales_enabled: bool = False
    portal_sales_config: dict | None = None
    portal_permissions: dict | None = None

    # Nested fields
    addresses: list[supplier_address_schema] = []
    legal: supplier_legal_schema | None = None
    contacts: list[supplier_contact_schema] = []
    directors: list[supplier_director_schema] = []
    auth_persons: list[supplier_auth_person_schema] = []
    brands: list[supplier_brand_schema] = []
    financial: supplier_financial_schema | None = None
    documents: list[supplier_document_schema] = []
    internal_notes: list[supplier_note_schema] = []
    gstins: list[supplier_gstin_schema] = []
    approval_logs: list[approval_log_out] = []

    model_config = {"from_attributes": True}


class supplier_list_out(BaseModel):
    id: int
    supplier_code: str | None
    name: str
    phone: str
    city: str | None
    gst_number: str | None
    supplier_type: str
    status: bool
    registration_status: str
    model_config = {"from_attributes": True}


# ── Supplier Terms ────────────────────────────────────────────────────────────

class supplier_terms_create(BaseModel):
    terms_text: str


class supplier_terms_out(BaseModel):
    id: int
    supplier_id: int
    terms_text: str | None
    is_active: bool
    created_at: datetime
    model_config = {"from_attributes": True}


# ── Vendor Requests & Portal Schemas ──────────────────────────────────────────

class vendor_profile_request_create(BaseModel):
    changes: dict

class vendor_profile_request_review(BaseModel):
    action: str  # approve / reject
    review_notes: str | None = None

class vendor_profile_request_out(BaseModel):
    id: int
    supplier_id: int
    requested_by_user_id: int | None = None
    status: str
    changes: dict
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    review_notes: str | None = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

class vendor_item_request_create(BaseModel):
    product_name: str
    brand_name: str | None = None
    brand_id: int | None = None
    category_name: str | None = None
    category_id: int | None = None
    manufacturer: str | None = None
    vendor_item_code: str | None = None
    barcode: str | None = None
    description: str | None = None
    unit: str = "PCS"
    pack_size: str | None = None
    purchase_rate: Decimal = Decimal("0.00")
    mrp: Decimal = Decimal("0.00")
    proposed_selling_price: Decimal = Decimal("0.00")
    gst_percent: Decimal = Decimal("0.00")
    hsn_code: str | None = None
    moq: Decimal = Decimal("1.00")
    lead_time_days: int = 7
    country_of_origin: str = "India"
    image_url: str | None = None
    brochure_url: str | None = None
    vendor_remarks: str | None = None

class vendor_item_request_review(BaseModel):
    action: str  # approve / reject / correction_requested
    review_notes: str | None = None
    create_product: bool = True

class vendor_item_request_out(BaseModel):
    id: int
    request_no: str
    supplier_id: int
    product_name: str
    brand_name: str | None = None
    brand_id: int | None = None
    category_name: str | None = None
    category_id: int | None = None
    manufacturer: str | None = None
    vendor_item_code: str | None = None
    barcode: str | None = None
    description: str | None = None
    unit: str
    pack_size: str | None = None
    purchase_rate: Decimal
    mrp: Decimal
    proposed_selling_price: Decimal
    gst_percent: Decimal
    hsn_code: str | None = None
    moq: Decimal
    lead_time_days: int
    country_of_origin: str
    image_url: str | None = None
    brochure_url: str | None = None
    vendor_remarks: str | None = None
    status: str
    review_notes: str | None = None
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    created_product_id: int | None = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}

class portal_settings_update(BaseModel):
    portal_sales_enabled: bool
    portal_sales_config: dict = Field(default_factory=dict)
    portal_permissions: dict = Field(default_factory=dict)

class po_vendor_ack_in(BaseModel):
    vendor_expected_delivery: date | None = None
    vendor_delivery_remarks: str | None = None

class vendor_portal_user_create(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str | None = None
    password: str | None = None
    require_password_change: bool = False
    portal_permissions: dict | None = None

class vendor_portal_user_update(BaseModel):
    username: str | None = None
    email: str | None = None
    status: bool | None = None
    portal_permissions: dict | None = None

class vendor_portal_reset_password_in(BaseModel):
    new_password: str | None = None
    generate_reset_link: bool = True

class vendor_login_in(BaseModel):
    username: str
    password: str

class vendor_activate_in(BaseModel):
    token: str
    password: str = Field(..., min_length=6)

class vendor_forgot_password_in(BaseModel):
    username_or_email: str

class vendor_reset_password_in(BaseModel):
    token: str
    new_password: str = Field(..., min_length=6)

class prn_vendor_ack_in(BaseModel):
    vendor_remarks: str | None = None



# ── Ledger ────────────────────────────────────────────────────────────────────

class ledger_row(BaseModel):
    date: date
    ref_no: str
    type: str          # "invoice" | "payment" | "opening"
    description: str
    debit: Decimal
    credit: Decimal
    balance: Decimal


if __name__ == "__main__":
    # customer GST rules self-check: python -m app.schemas.party
    G = "27AAPFU0939F1ZV"  # valid checksum, Maharashtra
    c = customer_create(name="Acme", phone="9876543210", gst_number=G.lower())
    assert (c.gst_number, c.state, c.state_code, c.pan_number, c.gst_registration_type) == \
        (G, "Maharashtra", "27", "AAPFU0939F", "Regular"), c
    for bad in ({"gst_number": G[:-1] + "A"}, {"gst_registration_type": "Regular"}, {"pincode": "12"}):
        try:
            customer_create(name="Acme", phone="9876543210", **bad); raise AssertionError(bad)
        except ValueError:
            pass
    c = customer_create(name="Walk", phone="9876543210", state="Gujarat", gst_number="  ")
    assert (c.gst_number, c.state_code, c.gst_registration_type) == (None, "24", "Unregistered"), c
    assert customer_update(gst_number="").model_dump(exclude_unset=True) == \
        {"gst_number": None, "gst_registration_type": "Unregistered"}
    print("ok")
