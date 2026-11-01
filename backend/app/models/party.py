from datetime import datetime, date
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base

# Import supplier_gstin model (defined in state.py, referenced here for relationship)
from app.models.state import supplier_gstin as supplier_gstin  # noqa: F401

# Import product models so brand/product relationships resolve at mapper init time
from app.models.product import brand  # noqa: F401


class customer(base):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    email: Mapped[str | None] = mapped_column(String(100))
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(50))
    state: Mapped[str] = mapped_column(String(50), default="Delhi")
    pincode: Mapped[str | None] = mapped_column(String(10))
    type: Mapped[str] = mapped_column(String(20), default="retail")
    gst_number: Mapped[str | None] = mapped_column(String(20))
    credit_limit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    show_outstanding_in_print: Mapped[bool] = mapped_column(Boolean, default=False)
    portal_active: Mapped[bool] = mapped_column(Boolean, default=False)
    customer_code: Mapped[str | None] = mapped_column(String(20), unique=True)
    contact_person: Mapped[str | None] = mapped_column(String(100))
    alt_phone: Mapped[str | None] = mapped_column(String(20))
    gst_registration_type: Mapped[str] = mapped_column(String(20), default="Unregistered")  # Regular/Composition/Unregistered/Consumer/SEZ
    pan_number: Mapped[str | None] = mapped_column(String(10))
    state_code: Mapped[str | None] = mapped_column(String(2))  # GST place-of-supply code
    shipping_address: Mapped[str | None] = mapped_column(Text)
    shipping_city: Mapped[str | None] = mapped_column(String(50))
    shipping_state: Mapped[str | None] = mapped_column(String(50))
    shipping_pincode: Mapped[str | None] = mapped_column(String(10))
    credit_days: Mapped[int] = mapped_column(Integer, default=0)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class supplier(base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_code: Mapped[str | None] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    trade_name: Mapped[str | None] = mapped_column(String(150))
    supplier_type: Mapped[str] = mapped_column(String(50), default="Manufacturer") # Manufacturer/Distributor etc
    company_type: Mapped[str | None] = mapped_column(String(50)) # Proprietorship/Partnership/Pvt Ltd/LLP
    business_constitution: Mapped[str | None] = mapped_column(String(50))
    category: Mapped[str | None] = mapped_column(String(50)) # FMCG/Beverage/Grocery etc
    contact_name: Mapped[str | None] = mapped_column(String(100))
    designation: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str] = mapped_column(String(20), nullable=False)
    alt_phone: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(100))
    alt_email: Mapped[str | None] = mapped_column(String(100))
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(50))
    state: Mapped[str] = mapped_column(String(50), default="Delhi")
    state_code: Mapped[str | None] = mapped_column(String(10))
    pincode: Mapped[str | None] = mapped_column(String(10))
    district: Mapped[str | None] = mapped_column(String(50))
    country: Mapped[str | None] = mapped_column(String(50))
    gst_number: Mapped[str | None] = mapped_column(String(20))
    pan_number: Mapped[str | None] = mapped_column(String(15))
    tan_number: Mapped[str | None] = mapped_column(String(30))
    cin_number: Mapped[str | None] = mapped_column(String(30))
    msme_number: Mapped[str | None] = mapped_column(String(50))
    fssai_number: Mapped[str | None] = mapped_column(String(50))
    product_categories: Mapped[str | None] = mapped_column(Text)
    company_description: Mapped[str | None] = mapped_column(Text)
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    credit_limit_days: Mapped[int] = mapped_column(Integer, default=0)
    website: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    # Status flow: pending → submitted → under_review → correction_pending → approved / rejected / hold
    registration_status: Mapped[str] = mapped_column(String(20), default="approved")
    onboarding_token: Mapped[str | None] = mapped_column(String(100), unique=True)
    # Portal Sales Permission controls
    portal_sales_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    portal_sales_config: Mapped[dict | None] = mapped_column(JSON)
    portal_permissions: Mapped[dict | None] = mapped_column(JSON)
    # Approval tracking
    approved_by: Mapped[int | None] = mapped_column(Integer)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    correction_notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # Relationships
    addresses: Mapped[list["supplier_address"]] = relationship("supplier_address", back_populates="supplier_rel", cascade="all, delete-orphan")
    legal: Mapped["supplier_legal"] = relationship("supplier_legal", back_populates="supplier_rel", uselist=False, cascade="all, delete-orphan")
    contacts: Mapped[list["supplier_contact"]] = relationship("supplier_contact", back_populates="supplier_rel", cascade="all, delete-orphan")
    directors: Mapped[list["supplier_director"]] = relationship("supplier_director", back_populates="supplier_rel", cascade="all, delete-orphan")
    auth_persons: Mapped[list["supplier_auth_person"]] = relationship("supplier_auth_person", back_populates="supplier_rel", cascade="all, delete-orphan")
    brands: Mapped[list["supplier_brand"]] = relationship("supplier_brand", back_populates="supplier_rel", cascade="all, delete-orphan")
    financial: Mapped["supplier_financial"] = relationship("supplier_financial", back_populates="supplier_rel", uselist=False, cascade="all, delete-orphan")
    documents: Mapped[list["supplier_document"]] = relationship("supplier_document", back_populates="supplier_rel", cascade="all, delete-orphan")
    internal_notes: Mapped[list["supplier_note"]] = relationship("supplier_note", back_populates="supplier_rel", cascade="all, delete-orphan")
    approval_logs: Mapped[list["supplier_approval_log"]] = relationship(
        "supplier_approval_log", back_populates="supplier_rel", cascade="all, delete-orphan"
    )
    gstins: Mapped[list["supplier_gstin"]] = relationship(
        "supplier_gstin", back_populates="supplier_rel", cascade="all, delete-orphan"
    )
    terms: Mapped[list["supplier_terms"]] = relationship(
        "supplier_terms", back_populates="supplier_rel", cascade="all, delete-orphan"
    )
    challans: Mapped[list["supplier_challan"]] = relationship(
        "supplier_challan", back_populates="supplier_rel"
    )
    profile_requests: Mapped[list["vendor_profile_request"]] = relationship(
        "vendor_profile_request", back_populates="supplier_rel", cascade="all, delete-orphan"
    )
    item_requests: Mapped[list["vendor_item_request"]] = relationship(
        "vendor_item_request", back_populates="supplier_rel", cascade="all, delete-orphan"
    )

class supplier_address(base):
    __tablename__ = "supplier_addresses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"))
    address_type: Mapped[str] = mapped_column(String(20)) # Billing/Shipping
    address: Mapped[str] = mapped_column(Text)
    country: Mapped[str] = mapped_column(String(50))
    state: Mapped[str] = mapped_column(String(50))
    city: Mapped[str] = mapped_column(String(50))
    pincode: Mapped[str] = mapped_column(String(10))
    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="addresses")

class supplier_legal(base):
    __tablename__ = "supplier_legal"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"))
    registration_type: Mapped[str] = mapped_column(String(50), default="Regular") # Regular, Composition, Unregistered, Consumer
    gst_no: Mapped[str | None] = mapped_column(String(20))
    pan_no: Mapped[str | None] = mapped_column(String(20))
    tan_no: Mapped[str | None] = mapped_column(String(20))
    cin_no: Mapped[str | None] = mapped_column(String(30))
    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="legal")

class supplier_contact(base):
    __tablename__ = "supplier_contacts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"))
    name: Mapped[str] = mapped_column(String(100))
    mobile: Mapped[str] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(100))
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="contacts")

class supplier_director(base):
    __tablename__ = "supplier_directors"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"))
    director_name: Mapped[str] = mapped_column(String(100))
    din: Mapped[str | None] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(100))
    phone: Mapped[str | None] = mapped_column(String(20))
    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="directors")

class supplier_auth_person(base):
    __tablename__ = "supplier_auth_persons"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"))
    name: Mapped[str] = mapped_column(String(100))
    designation: Mapped[str] = mapped_column(String(100))
    mobile: Mapped[str] = mapped_column(String(20))
    email: Mapped[str | None] = mapped_column(String(100))
    photo_path: Mapped[str | None] = mapped_column(Text)
    id_proof_path: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="auth_persons")

class supplier_brand(base):
    __tablename__ = "supplier_brands"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"))
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id"))
    credit_days: Mapped[int] = mapped_column(Integer, default=0)
    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="brands")
    brand_rel: Mapped["brand"] = relationship("app.models.product.brand", lazy="joined")

    @property
    def brand_name(self) -> str | None:
        return self.brand_rel.name if self.brand_rel else None

class supplier_financial(base):
    __tablename__ = "supplier_financial"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"))
    bank_name: Mapped[str | None] = mapped_column(String(100))
    account_no: Mapped[str | None] = mapped_column(String(50))
    ifsc_code: Mapped[str | None] = mapped_column(String(20))
    branch: Mapped[str | None] = mapped_column(String(100))
    credit_limit: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    credit_days: Mapped[int] = mapped_column(Integer, default=0)
    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="financial")

class supplier_document(base):
    __tablename__ = "supplier_documents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"))
    document_type: Mapped[str] = mapped_column(String(50))
    file_path: Mapped[str] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="documents")

class supplier_note(base):
    __tablename__ = "supplier_notes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"))
    note: Mapped[str] = mapped_column(Text)
    note_type: Mapped[str] = mapped_column(String(30), default="internal")  # internal, correction, rejection
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="internal_notes")
    creator: Mapped["user"] = relationship("app.models.user.user", foreign_keys=[created_by], lazy="joined")

    @property
    def created_by_name(self) -> str | None:
        return self.creator.name if self.creator else None


class supplier_approval_log(base):
    """Immutable audit trail for every status change on a vendor/supplier."""
    __tablename__ = "supplier_approval_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"))
    action: Mapped[str] = mapped_column(String(30))           # submitted/under_review/approved/rejected/hold/correction_requested
    from_status: Mapped[str | None] = mapped_column(String(30))
    to_status: Mapped[str | None] = mapped_column(String(30))
    remarks: Mapped[str | None] = mapped_column(Text)
    performed_by: Mapped[int | None] = mapped_column(Integer)
    performed_by_name: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="approval_logs")


class supplier_terms(base):
    __tablename__ = "supplier_terms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"), nullable=False)
    terms_text: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)

    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="terms")


class supplier_challan(base):
    __tablename__ = "supplier_challans"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    challan_no: Mapped[str] = mapped_column(String(50), nullable=False)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"), nullable=False)
    challan_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    total_qty: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0.00)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)

    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="challans")
    items: Mapped[list["supplier_challan_item"]] = relationship(
        "supplier_challan_item", back_populates="challan_rel", cascade="all, delete-orphan"
    )


class supplier_challan_item(base):
    __tablename__ = "supplier_challan_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    challan_id: Mapped[int] = mapped_column(Integer, ForeignKey("supplier_challans.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), nullable=False)
    pcs: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0.00)
    is_dual_unit: Mapped[bool] = mapped_column(Boolean, default=False)
    billed_qty: Mapped[Decimal] = mapped_column(Numeric(12, 3), default=0.00)
    unit: Mapped[str | None] = mapped_column(String(10))
    tentative_rate: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)

    challan_rel: Mapped["supplier_challan"] = relationship("supplier_challan", back_populates="items")


class vendor_profile_request(base):
    __tablename__ = "vendor_profile_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False)
    requested_by_user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="pending")  # pending, approved, rejected
    changes: Mapped[dict] = mapped_column(JSON, nullable=False)  # {field: {"old": ..., "new": ...}}
    reviewed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="profile_requests")


class vendor_item_request(base):
    __tablename__ = "vendor_item_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id", ondelete="CASCADE"), nullable=False)
    product_name: Mapped[str] = mapped_column(String(150), nullable=False)
    brand_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    brand_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True)
    category_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    category_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("categories.id", ondelete="SET NULL"), nullable=True)
    manufacturer: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vendor_item_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    barcode: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str] = mapped_column(String(20), default="PCS")
    pack_size: Mapped[str | None] = mapped_column(String(50), nullable=True)
    purchase_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    mrp: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    proposed_selling_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0.00"))
    gst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("0.00"))
    hsn_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    moq: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("1.00"))
    lead_time_days: Mapped[int] = mapped_column(Integer, default=7)
    country_of_origin: Mapped[str] = mapped_column(String(50), default="India")
    image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    brochure_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    vendor_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="submitted")
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    supplier_rel: Mapped["supplier"] = relationship("supplier", back_populates="item_requests")

