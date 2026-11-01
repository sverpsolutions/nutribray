from datetime import datetime, date
from decimal import Decimal
from typing import TYPE_CHECKING
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base
from app.models.user import user

if TYPE_CHECKING:
    from app.models.batch import product_batch


class manufacturer(base):
    __tablename__ = "manufacturers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str | None] = mapped_column(String(30))
    country: Mapped[str | None] = mapped_column(String(50))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    brands: Mapped[list["brand"]] = relationship("brand", back_populates="manufacturer_rel")
    submanufacturers: Mapped[list["sub_manufacturer"]] = relationship("sub_manufacturer", back_populates="manufacturer_rel")
    products: Mapped[list["product"]] = relationship("product", back_populates="manufacturer_rel")


class sub_manufacturer(base):
    __tablename__ = "sub_manufacturers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    manufacturer_id: Mapped[int] = mapped_column(Integer, ForeignKey("manufacturers.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str | None] = mapped_column(String(30))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    manufacturer_rel: Mapped["manufacturer"] = relationship("manufacturer", back_populates="submanufacturers")
    products: Mapped[list["product"]] = relationship("product", back_populates="submanufacturer_rel")


class brand(base):
    __tablename__ = "brands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str | None] = mapped_column(String(20))
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    manufacturer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("manufacturers.id"))
    subcategory_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("item_subcategories.id"))
    short_name: Mapped[str | None] = mapped_column(String(10))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))

    manufacturer_rel: Mapped["manufacturer | None"] = relationship("manufacturer", back_populates="brands")
    subcategory_rel: Mapped["item_subcategory | None"] = relationship("item_subcategory", back_populates="brands")
    products: Mapped[list["product"]] = relationship("product", back_populates="brand_rel")
    subbrands: Mapped[list["sub_category_brand"]] = relationship("sub_category_brand", back_populates="brand_rel")
    
    creator: Mapped["user | None"] = relationship("user", foreign_keys=[created_by])
    updater: Mapped["user | None"] = relationship("user", foreign_keys=[updated_by])

    @property
    def subcategory_name(self) -> str | None:
        return self.subcategory_rel.name if self.subcategory_rel else None

    @property
    def created_by_name(self) -> str | None:
        return self.creator.name if self.creator else None


class category(base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    parent_id: Mapped[int] = mapped_column(Integer, default=0)
    short_name: Mapped[str | None] = mapped_column(String(10))
    status: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    updated_by: Mapped[int | None] = mapped_column(Integer)

    # Removed products relationship to fix mapper conflict


class unit_master(base):
    __tablename__ = "unit_master"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    unit_code: Mapped[str] = mapped_column(String(10), unique=True, nullable=False)
    unit_name: Mapped[str] = mapped_column(String(50), nullable=False)
    unit_type: Mapped[str] = mapped_column(String(20), default="Count")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    products: Mapped[list["product"]] = relationship("product", back_populates="unit_rel")


class gst_master(base):
    __tablename__ = "gst_master"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tax_name: Mapped[str] = mapped_column(String(50), nullable=False)
    gst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    cgst_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    sgst_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    igst_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class hsn_master(base):
    __tablename__ = "hsn_master"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    hsn_code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    code_type: Mapped[str] = mapped_column(String(10), default="HSN") # HSN or SAC
    category_type: Mapped[str] = mapped_column(String(20), default="Goods") # Goods or Service
    description: Mapped[str | None] = mapped_column(Text)
    gst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    cgst_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    sgst_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    igst_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    products: Mapped[list["product"]] = relationship("product", foreign_keys="[product.hsn_id]", back_populates="hsn_rel")
    suggested_products: Mapped[list["product"]] = relationship("product", foreign_keys="[product.suggested_hsn_id]", back_populates="suggested_hsn_rel")
    subcategories: Mapped[list["item_subcategory"]] = relationship("item_subcategory", back_populates="default_hsn_rel")


class variant_master(base):
    __tablename__ = "variant_masters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str | None] = mapped_column(String(30))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    products: Mapped[list["product"]] = relationship("product", back_populates="variant_rel")


class flavour_master(base):
    __tablename__ = "flavour_masters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str | None] = mapped_column(String(30))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    products: Mapped[list["product"]] = relationship("product", back_populates="flavour_rel")


class product_classification(base):
    __tablename__ = "product_classifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    meaning: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    products: Mapped[list["product"]] = relationship("product", back_populates="classification_rel")


class item_category(base):
    __tablename__ = "item_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subgroup_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("item_subgroups.id"))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str | None] = mapped_column(String(20))
    short_name: Mapped[str | None] = mapped_column(String(10))
    parent_id: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))

    subgroup_rel: Mapped["item_subgroup | None"] = relationship("item_subgroup", back_populates="categories")
    subcategories: Mapped[list["item_subcategory"]] = relationship("item_subcategory", back_populates="category_rel")
    products: Mapped[list["product"]] = relationship("product", back_populates="category_rel")
    
    creator: Mapped["user | None"] = relationship("user", foreign_keys=[created_by])
    updater: Mapped["user | None"] = relationship("user", foreign_keys=[updated_by])

    @property
    def subgroup_name(self) -> str | None:
        return self.subgroup_rel.name if self.subgroup_rel else None

    @property
    def created_by_name(self) -> str | None:
        return self.creator.name if self.creator else None


class item_group(base):
    __tablename__ = "item_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(20), unique=True)
    short_name: Mapped[str | None] = mapped_column(String(10))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))

    creator: Mapped["user | None"] = relationship("user", foreign_keys=[created_by])
    updater: Mapped["user | None"] = relationship("user", foreign_keys=[updated_by])

    @property
    def created_by_name(self) -> str | None:
        return self.creator.name if self.creator else None

    @property
    def updated_by_name(self) -> str | None:
        return self.updater.name if self.updater else None

    subgroups: Mapped[list["item_subgroup"]] = relationship("item_subgroup", back_populates="group_rel")


class item_subgroup(base):
    __tablename__ = "item_subgroups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[int] = mapped_column(Integer, ForeignKey("item_groups.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str | None] = mapped_column(String(20))
    short_name: Mapped[str | None] = mapped_column(String(10))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))

    group_rel: Mapped["item_group"] = relationship("item_group", back_populates="subgroups")
    categories: Mapped[list["item_category"]] = relationship("item_category", back_populates="subgroup_rel")
    
    creator: Mapped["user | None"] = relationship("user", foreign_keys=[created_by])
    updater: Mapped["user | None"] = relationship("user", foreign_keys=[updated_by])

    @property
    def group_name(self) -> str | None:
        return self.group_rel.name if self.group_rel else None

    @property
    def created_by_name(self) -> str | None:
        return self.creator.name if self.creator else None


class item_subcategory(base):
    __tablename__ = "item_subcategories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category_id: Mapped[int] = mapped_column(Integer, ForeignKey("item_categories.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str | None] = mapped_column(String(20))
    short_name: Mapped[str | None] = mapped_column(String(10))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))

    category_rel: Mapped["item_category"] = relationship("item_category", back_populates="subcategories")
    default_hsn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hsn_master.id"))
    default_hsn_rel: Mapped["hsn_master | None"] = relationship("hsn_master", back_populates="subcategories")
    brands: Mapped[list["brand"]] = relationship("brand", back_populates="subcategory_rel")
    
    creator: Mapped["user | None"] = relationship("user", foreign_keys=[created_by])
    updater: Mapped["user | None"] = relationship("user", foreign_keys=[updated_by])

    @property
    def category_name(self) -> str | None:
        return self.category_rel.name if self.category_rel else None

    @property
    def created_by_name(self) -> str | None:
        return self.creator.name if self.creator else None

    @property
    def hsn_code(self) -> str | None:
        return self.default_hsn_rel.hsn_code if self.default_hsn_rel else None

    @property
    def hsn_description(self) -> str | None:
        return self.default_hsn_rel.description if self.default_hsn_rel else None


class sub_category_brand(base):
    __tablename__ = "sub_category_brands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str | None] = mapped_column(String(20))
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id"), nullable=False)
    subcategory_id: Mapped[int] = mapped_column(Integer, ForeignKey("item_subcategories.id"), nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(10))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    updated_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))

    brand_rel: Mapped["brand"] = relationship("brand", back_populates="subbrands")
    
    creator: Mapped["user | None"] = relationship("user", foreign_keys=[created_by])
    updater: Mapped["user | None"] = relationship("user", foreign_keys=[updated_by])

    @property
    def brand_name(self) -> str | None:
        return self.brand_rel.name if self.brand_rel else None

    @property
    def created_by_name(self) -> str | None:
        return self.creator.name if self.creator else None


class country(base):
    __tablename__ = "countries"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    code: Mapped[str | None] = mapped_column(String(5)) # ISO code
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

class product(base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    bill_print_name: Mapped[str | None] = mapped_column(String(50))
    full_item_name: Mapped[str | None] = mapped_column(String(255))
    item_code: Mapped[str | None] = mapped_column(String(50), unique=True)
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    category_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("item_categories.id"))
    subcategory: Mapped[str | None] = mapped_column(String(100))
    brand: Mapped[str | None] = mapped_column(String(100))
    brand_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("brands.id"))
    sub_category_brand_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sub_category_brands.id"))
    hsn_code: Mapped[str | None] = mapped_column(String(20))
    hsn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hsn_master.id"))
    suggested_hsn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hsn_master.id"))
    unit_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("unit_master.id"))
    unit: Mapped[str] = mapped_column(String(10), default="PCS")
    carton_size: Mapped[int] = mapped_column(Integer, default=1)
    purchase_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    cost_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    basic_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    selling_price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    wsp: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    mrp: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    gst_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    purchase_tax_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    sale_tax_percent: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    stock_qty: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=0.000)
    stock_pcs: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=0.000)
    description: Mapped[str | None] = mapped_column(Text)
    thumbnail_img: Mapped[str | None] = mapped_column(String(255))
    image_path: Mapped[str | None] = mapped_column(String(255))
    img_front: Mapped[str | None] = mapped_column(String(255))
    img_back: Mapped[str | None] = mapped_column(String(255))
    img_top: Mapped[str | None] = mapped_column(String(255))
    img_side: Mapped[str | None] = mapped_column(String(255))
    image1: Mapped[str | None] = mapped_column(String(255))
    image2: Mapped[str | None] = mapped_column(String(255))
    image3: Mapped[str | None] = mapped_column(String(255))
    image4: Mapped[str | None] = mapped_column(String(255))
    plu_code: Mapped[int | None] = mapped_column(Integer, unique=True)
    expiry_date: Mapped[date | None] = mapped_column(Date)
    barcode: Mapped[str | None] = mapped_column(String(50))
    barcode_crt: Mapped[str | None] = mapped_column(String(50))
    model_no: Mapped[str | None] = mapped_column(String(50))
    manufacturer_name: Mapped[str | None] = mapped_column(String(100))
    needs_printing: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")  # printed item (tin / label / carton): goes to a printer
    manufacturer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("manufacturers.id"))
    submanufacturer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sub_manufacturers.id"))
    variant_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("variant_masters.id"))
    flavour_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("flavour_masters.id"))
    classification_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_classifications.id"))
    group_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("item_groups.id"))
    subgroup_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("item_subgroups.id"))
    subcategory_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("item_subcategories.id"))
    supplier_id: Mapped[int | None] = mapped_column(Integer)
    country_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("countries.id"))
    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=5)
    min_stock: Mapped[Decimal] = mapped_column(Numeric(15, 3), default=0.000)
    reorder_level: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    max_stock_level: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0.00)
    # manufacturing inventory: FG finished, RM raw material, PM packing material, SFG semi-finished, CONS consumable, OTH other
    item_type: Mapped[str] = mapped_column(String(4), default="FG", server_default="FG")
    bom_applicable: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    default_store_id: Mapped[int | None] = mapped_column(Integer)
    item_remarks: Mapped[str | None] = mapped_column(Text)
    purchase_pack_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    min_order_qty: Mapped[Decimal | None] = mapped_column(Numeric(12, 3))
    shelf_life_days: Mapped[int | None] = mapped_column(Integer)
    rack_no: Mapped[str | None] = mapped_column(String(20))
    aisle_no: Mapped[str | None] = mapped_column(String(20))
    weight_kg: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    dimensions: Mapped[str | None] = mapped_column(String(50))
    variant: Mapped[str | None] = mapped_column(String(50))
    size: Mapped[str | None] = mapped_column(String(50))
    ref_item_code: Mapped[str | None] = mapped_column(String(50))
    cp_margin: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    mrp_margin: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    sp_margin: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    wsp_margin: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=0.00)
    # Pricing engine fields
    pricing_mode           : Mapped[str]           = mapped_column(String(20), default='STANDARD')
    fixed_margin_percent   : Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    allow_custom_margin    : Mapped[bool]           = mapped_column(Boolean, default=True)
    minimum_margin_percent : Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    default_channel_margin : Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    online_partner_enabled : Mapped[bool]           = mapped_column(Boolean, default=False)
    multiplier_to_base: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=1.000)
    conversion_factor: Mapped[Decimal] = mapped_column(Numeric(10, 3), default=1.000)
    purchase_unit: Mapped[str | None] = mapped_column(String(10))
    base_product_id: Mapped[int | None] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_dual_unit: Mapped[bool] = mapped_column(Boolean, default=False)
    is_consumable: Mapped[bool] = mapped_column(Boolean, default=False)
    is_non_saleable: Mapped[bool] = mapped_column(Boolean, default=False)
    is_raw_material: Mapped[bool] = mapped_column(Boolean, default=False)
    is_sellable: Mapped[bool] = mapped_column(Boolean, default=True)
    is_raw_non_sellable: Mapped[bool] = mapped_column(Boolean, default=False)
    is_batch_required: Mapped[bool] = mapped_column(Boolean, default=False)
    # Complete Expiry Date & Batch Management fields
    has_batch_tracking: Mapped[bool] = mapped_column(Boolean, default=False)
    has_expiry_tracking: Mapped[bool] = mapped_column(Boolean, default=False)
    mfg_date_required: Mapped[bool] = mapped_column(Boolean, default=False)
    exp_date_required: Mapped[bool] = mapped_column(Boolean, default=False)
    min_shelf_life_purchase_days: Mapped[int | None] = mapped_column(Integer)
    min_shelf_life_sale_days: Mapped[int | None] = mapped_column(Integer)
    near_expiry_alert_days: Mapped[int] = mapped_column(Integer, default=60)
    allow_expired_sale: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_neg_batch_stock: Mapped[bool] = mapped_column(Boolean, default=False)
    batch_wise_purchase_rate: Mapped[bool] = mapped_column(Boolean, default=True)
    batch_wise_selling_price: Mapped[bool] = mapped_column(Boolean, default=False)
    is_fefo_enabled: Mapped[bool] = mapped_column(Boolean, default=True)

    is_weighing_item: Mapped[bool] = mapped_column(Boolean, default=False)
    is_discountable: Mapped[bool] = mapped_column(Boolean, default=True)
    is_hidden_pos: Mapped[bool] = mapped_column(Boolean, default=False)
    is_expired: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_purchase: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_sale: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_neg_stock: Mapped[bool] = mapped_column(Boolean, default=False)
    prompt_qty: Mapped[bool] = mapped_column(Boolean, default=False)
    prompt_price: Mapped[bool] = mapped_column(Boolean, default=False)
    is_asset: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    approved_by: Mapped[str | None] = mapped_column(String(100))
    price_update_level: Mapped[str | None] = mapped_column(String(50), default="All Store Level")
    price_update_target: Mapped[str | None] = mapped_column(String(100))
    filter_combination_name: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    category_rel: Mapped["item_category | None"] = relationship("item_category", back_populates="products")
    brand_rel: Mapped["brand | None"] = relationship("brand", back_populates="products")
    hsn_rel: Mapped["hsn_master | None"] = relationship("hsn_master", foreign_keys=[hsn_id], back_populates="products")
    suggested_hsn_rel: Mapped["hsn_master | None"] = relationship("hsn_master", foreign_keys=[suggested_hsn_id], back_populates="suggested_products")
    unit_rel: Mapped["unit_master | None"] = relationship("unit_master", back_populates="products")
    manufacturer_rel: Mapped["manufacturer | None"] = relationship("manufacturer", back_populates="products")
    submanufacturer_rel: Mapped["sub_manufacturer | None"] = relationship("sub_manufacturer", back_populates="products")
    variant_rel: Mapped["variant_master | None"] = relationship("variant_master", back_populates="products")
    flavour_rel: Mapped["flavour_master | None"] = relationship("flavour_master", back_populates="products")
    classification_rel: Mapped["product_classification | None"] = relationship("product_classification", back_populates="products")
    barcodes: Mapped[list["product_barcode"]] = relationship("product_barcode", back_populates="product_rel", cascade="all, delete-orphan")
    outlet_prices: Mapped[list["outlet_pricing"]] = relationship("outlet_pricing", back_populates="product_rel", cascade="all, delete-orphan")
    channel_prices: Mapped[list["item_channel_price"]] = relationship("item_channel_price", back_populates="product_rel", cascade="all, delete-orphan")
    batches: Mapped[list["product_batch"]] = relationship("product_batch", back_populates="product_rel", cascade="all, delete-orphan")


class product_barcode(base):
    __tablename__ = "product_barcodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    barcode: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    barcode_type: Mapped[str] = mapped_column(String(10), default="EAN13")
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    product_rel: Mapped["product"] = relationship("product", back_populates="barcodes")


class outlet_pricing(base):
    __tablename__ = "outlet_pricing"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outlet_id: Mapped[int] = mapped_column(Integer, nullable=False)
    product_id: Mapped[int] = mapped_column(Integer, ForeignKey("products.id"), nullable=False)
    cost_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    wsp: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    mrp: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    selling_price: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    stock_qty: Mapped[Decimal | None] = mapped_column(Numeric(15, 3))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    product_rel: Mapped["product"] = relationship("product", back_populates="outlet_prices")


class hsn_exception_log(base):
    __tablename__ = "hsn_exception_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("products.id"))
    item_code: Mapped[str | None] = mapped_column(String(50))
    subcategory_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("item_subcategories.id"))
    suggested_hsn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hsn_master.id"))
    entered_hsn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hsn_master.id"))
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class hsn_history(base):
    __tablename__ = "hsn_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("products.id"))
    old_hsn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hsn_master.id"))
    new_hsn_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hsn_master.id"))
    changed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
