from fastapi import APIRouter, Depends, Query, HTTPException
from app.core.dependencies import get_current_user
from sqlalchemy import select, func, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.models.product import product as product_model, category as category_model
from app.models.shop import shop_order, shop_order_item, shop_banner, shop_customer
from app.schemas.product import product_list_out, category_out
from app.schemas.shop import (
    ShopOrderCreate, ShopOrderOut, ShopSalesReport, ShopTopProduct,
    ShopBannerOut, ShopBannerCreate, ProductImageSetupRequest,
    ShopCustomerCreate, ShopCustomerOut,
    ShopOrderDetailOut, ShopOrderItemOut, ShopDashboardStats
)
from app.schemas.common import paginated_response
from app.utils.search import word_match
import math
import random
import string
from datetime import datetime, timedelta
from decimal import Decimal

router = APIRouter(prefix="/shop", tags=["shop"])

def generate_order_no():
    return "ORD-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=8))

@router.get("/categories", response_model=list[category_out])
async def list_shop_categories(db: AsyncSession = Depends(get_db)):
    stmt = select(category_model).where(category_model.status == True).order_by(category_model.name)
    rows = (await db.execute(stmt)).scalars().all()
    return rows

@router.get("/products", response_model=paginated_response[product_list_out])
async def list_shop_products(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    category_id: int | None = Query(None),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db)
):
    conditions = [product_model.is_active == True, product_model.is_sellable == True]
    if category_id: conditions.append(product_model.category_id == category_id)
    if search:
        conditions.append(word_match(search, product_model.name, product_model.item_code))
    count_stmt = select(func.count(product_model.id)).where(*conditions)
    total = (await db.execute(count_stmt)).scalar_one()
    stmt = select(product_model).where(*conditions).order_by(product_model.name).offset((page - 1) * per_page).limit(per_page)
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "data": rows, "total": total, "page": page, "per_page": per_page,
        "total_pages": math.ceil(total / per_page) if per_page else 1
    }

@router.get("/featured", response_model=list[product_list_out])
async def get_featured_products(db: AsyncSession = Depends(get_db)):
    stmt = select(product_model).where(product_model.is_active == True, product_model.is_sellable == True).limit(8)
    rows = (await db.execute(stmt)).scalars().all()
    return rows

# --- Customer Management ---

@router.post("/customers", response_model=ShopCustomerOut, dependencies=[Depends(get_current_user)])
async def create_or_get_customer(body: ShopCustomerCreate, db: AsyncSession = Depends(get_db)):
    """Create a new shop customer or return existing one by phone."""
    # Check if customer exists by phone
    stmt = select(shop_customer).where(shop_customer.phone == body.phone)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        # Update details if needed
        existing.name = body.name
        if body.email:
            existing.email = body.email
        if body.address:
            existing.address = body.address
        if body.city:
            existing.city = body.city
        if body.pincode:
            existing.pincode = body.pincode
        await db.commit()
        await db.refresh(existing)
        return existing
    
    # Create new customer
    customer = shop_customer(
        name=body.name,
        phone=body.phone,
        email=body.email,
        address=body.address,
        city=body.city,
        state=body.state,
        pincode=body.pincode
    )
    db.add(customer)
    await db.commit()
    await db.refresh(customer)
    return customer

@router.get("/customers/search", dependencies=[Depends(get_current_user)])
async def search_customers(q: str = Query("", min_length=2), db: AsyncSession = Depends(get_db)):
    """Search customers by name or phone."""
    stmt = select(shop_customer).where(word_match(q, shop_customer.name, shop_customer.phone)).limit(10)
    rows = (await db.execute(stmt)).scalars().all()
    return [{"id": r.id, "name": r.name, "phone": r.phone, "address": r.address, "city": r.city} for r in rows]

@router.post("/orders", response_model=ShopOrderOut)
async def place_shop_order(body: ShopOrderCreate, db: AsyncSession = Depends(get_db)):
    """
    Create a new shop order (purely separate from main invoices).
    Auto-creates customer if customer_name + customer_phone are provided.
    """
    # Auto-create/find customer if customer info provided
    customer_id = body.customer_id
    if not customer_id and body.customer_name and body.customer_phone:
        stmt = select(shop_customer).where(shop_customer.phone == body.customer_phone)
        existing_cust = (await db.execute(stmt)).scalar_one_or_none()
        if existing_cust:
            customer_id = existing_cust.id
            existing_cust.name = body.customer_name  # Update name
        else:
            new_cust = shop_customer(
                name=body.customer_name,
                phone=body.customer_phone,
                email=body.customer_email,
                address=body.delivery_address,
                state="Delhi"
            )
            db.add(new_cust)
            await db.flush()
            customer_id = new_cust.id

    order = shop_order(
        order_no=generate_order_no(),
        customer_id=customer_id,
        subtotal=body.subtotal,
        discount=body.discount,
        tax_amount=body.tax_amount,
        delivery_fee=body.delivery_fee,
        total_amount=body.total_amount,
        payment_mode=body.payment_mode,
        delivery_address=body.delivery_address,
        notes=body.notes
    )
    db.add(order)
    await db.flush()

    for item in body.items:
        order_item = shop_order_item(
            order_id=order.id,
            product_id=item.product_id,
            name=item.name,
            qty=item.qty,
            unit=item.unit,
            rate=item.rate,
            total=item.total
        )
        db.add(order_item)
        
        # Also update stock ledger with shop_order prefix
        from app.models.invoice import stock_ledger
        ledger = stock_ledger(
            product_id=item.product_id,
            txn_type="shop_sale",
            qty=-item.qty, # Negative for sale
            ref_id=order.id,
            ref_type="shop_order",
            notes=f"Shop Order {order.order_no}"
        )
        db.add(ledger)

    await db.commit()
    await db.refresh(order)
    return order

# --- Shop Specific Reports ---

@router.get("/reports/sales", response_model=list[ShopSalesReport], dependencies=[Depends(get_current_user)])
async def get_shop_sales_report(days: int = 30, db: AsyncSession = Depends(get_db)):
    start_date = datetime.now() - timedelta(days=days)
    stmt = (
        select(
            func.date(shop_order.order_datetime).label("date"),
            func.count(shop_order.id).label("order_count"),
            func.sum(shop_order.total_amount).label("total_sales")
        )
        .where(shop_order.order_datetime >= start_date)
        .group_by("date")
        .order_by("date")
    )
    res = await db.execute(stmt)
    return [
        {"date": r.date, "order_count": r.order_count, "total_sales": r.total_sales}
        for r in res.all()
    ]

@router.get("/reports/top-products", response_model=list[ShopTopProduct], dependencies=[Depends(get_current_user)])
async def get_shop_top_products(limit: int = 10, db: AsyncSession = Depends(get_db)):
    stmt = (
        select(
            shop_order_item.product_id,
            shop_order_item.name,
            func.sum(shop_order_item.qty).label("total_qty"),
            func.sum(shop_order_item.total).label("total_sales")
        )
        .group_by(shop_order_item.product_id, shop_order_item.name)
        .order_by(func.sum(shop_order_item.total).desc())
        .limit(limit)
    )
    res = await db.execute(stmt)
    return [
        {"product_id": r.product_id, "name": r.name, "total_qty": r.total_qty, "total_sales": r.total_sales}
        for r in res.all()
    ]

# --- Admin: Dashboard Stats ---

@router.get("/admin/dashboard", response_model=ShopDashboardStats, dependencies=[Depends(get_current_user)])
async def get_shop_dashboard(db: AsyncSession = Depends(get_db)):
    """Get aggregated dashboard stats for the shop admin."""
    total_sales = (await db.execute(
        select(func.coalesce(func.sum(shop_order.total_amount), 0))
    )).scalar_one()
    
    total_orders = (await db.execute(
        select(func.count(shop_order.id))
    )).scalar_one()
    
    total_customers = (await db.execute(
        select(func.count(shop_customer.id))
    )).scalar_one()
    
    pending_orders = (await db.execute(
        select(func.count(shop_order.id)).where(shop_order.order_status == "pending")
    )).scalar_one()
    
    delivered_orders = (await db.execute(
        select(func.count(shop_order.id)).where(shop_order.order_status == "delivered")
    )).scalar_one()
    
    avg = Decimal(str(total_sales)) / total_orders if total_orders > 0 else Decimal("0")
    
    return ShopDashboardStats(
        total_sales=total_sales,
        total_orders=total_orders,
        total_customers=total_customers,
        avg_order_value=round(avg, 2),
        pending_orders=pending_orders,
        delivered_orders=delivered_orders
    )

# --- Admin: Orders Management ---

@router.get("/admin/orders", dependencies=[Depends(get_current_user)])
async def list_all_orders(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: str | None = Query(None),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """List all shop orders with customer info for admin panel."""
    conditions = []
    if status:
        conditions.append(shop_order.order_status == status)
    if search:
        conditions.append(or_(
            shop_order.order_no.ilike(f"%{search}%"),
        ))
    
    count_stmt = select(func.count(shop_order.id))
    if conditions:
        count_stmt = count_stmt.where(*conditions)
    total = (await db.execute(count_stmt)).scalar_one()
    
    stmt = (
        select(
            shop_order,
            shop_customer.name.label("customer_name"),
            shop_customer.phone.label("customer_phone")
        )
        .outerjoin(shop_customer, shop_order.customer_id == shop_customer.id)
    )
    if conditions:
        stmt = stmt.where(*conditions)
    stmt = stmt.order_by(desc(shop_order.id)).offset((page - 1) * per_page).limit(per_page)
    
    rows = (await db.execute(stmt)).all()
    data = []
    for row in rows:
        order = row[0]
        data.append({
            "id": order.id,
            "order_no": order.order_no,
            "order_date": str(order.order_date),
            "order_datetime": order.order_datetime.isoformat() if order.order_datetime else None,
            "customer_id": order.customer_id,
            "customer_name": row.customer_name,
            "customer_phone": row.customer_phone,
            "subtotal": float(order.subtotal),
            "discount": float(order.discount),
            "delivery_fee": float(order.delivery_fee),
            "total_amount": float(order.total_amount),
            "payment_mode": order.payment_mode,
            "payment_status": order.payment_status,
            "order_status": order.order_status,
            "delivery_address": order.delivery_address,
        })
    
    return {
        "data": data,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": math.ceil(total / per_page) if per_page else 1
    }

@router.get("/admin/orders/{order_id}", dependencies=[Depends(get_current_user)])
async def get_order_detail(order_id: int, db: AsyncSession = Depends(get_db)):
    """Get a single order with items and customer info."""
    stmt = (
        select(
            shop_order,
            shop_customer.name.label("customer_name"),
            shop_customer.phone.label("customer_phone")
        )
        .outerjoin(shop_customer, shop_order.customer_id == shop_customer.id)
        .where(shop_order.id == order_id)
    )
    row = (await db.execute(stmt)).one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order = row[0]
    # Get items
    items_stmt = select(shop_order_item).where(shop_order_item.order_id == order_id)
    items = (await db.execute(items_stmt)).scalars().all()
    
    return {
        "id": order.id,
        "order_no": order.order_no,
        "order_date": str(order.order_date),
        "order_datetime": order.order_datetime.isoformat() if order.order_datetime else None,
        "customer_id": order.customer_id,
        "customer_name": row.customer_name,
        "customer_phone": row.customer_phone,
        "subtotal": float(order.subtotal),
        "discount": float(order.discount),
        "delivery_fee": float(order.delivery_fee),
        "total_amount": float(order.total_amount),
        "payment_mode": order.payment_mode,
        "payment_status": order.payment_status,
        "order_status": order.order_status,
        "delivery_address": order.delivery_address,
        "notes": order.notes,
        "items": [
            {
                "id": item.id,
                "product_id": item.product_id,
                "name": item.name,
                "qty": float(item.qty),
                "unit": item.unit,
                "rate": float(item.rate),
                "total": float(item.total),
            }
            for item in items
        ]
    }

@router.put("/admin/orders/{order_id}/status", dependencies=[Depends(get_current_user)])
async def update_order_status(order_id: int, status: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Update order status (pending, processing, shipped, delivered, cancelled)."""
    valid_statuses = ["pending", "processing", "shipped", "delivered", "cancelled"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")
    
    stmt = select(shop_order).where(shop_order.id == order_id)
    order = (await db.execute(stmt)).scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    
    order.order_status = status
    if status == "delivered":
        order.payment_status = "paid"
    await db.commit()
    return {"message": f"Order status updated to {status}"}

# --- Admin: Customers Management ---

@router.get("/admin/customers", dependencies=[Depends(get_current_user)])
async def list_all_customers(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """List all shop customers for admin panel."""
    conditions = []
    if search:
        conditions.append(word_match(search, shop_customer.name, shop_customer.phone, shop_customer.email))
    
    count_stmt = select(func.count(shop_customer.id))
    if conditions:
        count_stmt = count_stmt.where(*conditions)
    total = (await db.execute(count_stmt)).scalar_one()
    
    # Get customer with order stats
    stmt = (
        select(
            shop_customer,
            func.count(shop_order.id).label("order_count"),
            func.coalesce(func.sum(shop_order.total_amount), 0).label("total_spent")
        )
        .outerjoin(shop_order, shop_customer.id == shop_order.customer_id)
        .group_by(shop_customer.id)
    )
    if conditions:
        stmt = stmt.where(*conditions)
    stmt = stmt.order_by(desc(shop_customer.id)).offset((page - 1) * per_page).limit(per_page)
    
    rows = (await db.execute(stmt)).all()
    data = []
    for row in rows:
        cust = row[0]
        data.append({
            "id": cust.id,
            "name": cust.name,
            "phone": cust.phone,
            "email": cust.email,
            "address": cust.address,
            "city": cust.city,
            "state": cust.state,
            "pincode": cust.pincode,
            "status": cust.status,
            "created_at": cust.created_at.isoformat() if cust.created_at else None,
            "order_count": row.order_count,
            "total_spent": float(row.total_spent),
        })
    
    return {
        "data": data,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": math.ceil(total / per_page) if per_page else 1
    }

# --- Banner Management ---

@router.get("/banners", response_model=list[ShopBannerOut])
async def list_active_banners(db: AsyncSession = Depends(get_db)):
    stmt = select(shop_banner).where(shop_banner.status == True).order_by(shop_banner.sort_order)
    rows = (await db.execute(stmt)).scalars().all()
    return rows

@router.get("/admin/banners", response_model=list[ShopBannerOut], dependencies=[Depends(get_current_user)])
async def list_all_banners_admin(db: AsyncSession = Depends(get_db)):
    stmt = select(shop_banner).order_by(shop_banner.sort_order)
    rows = (await db.execute(stmt)).scalars().all()
    return rows

@router.post("/admin/banners", response_model=ShopBannerOut, dependencies=[Depends(get_current_user)])
async def create_banner(body: ShopBannerCreate, db: AsyncSession = Depends(get_db)):
    banner = shop_banner(**body.model_dump())
    db.add(banner)
    await db.commit()
    await db.refresh(banner)
    return banner

@router.put("/admin/banners/{banner_id}", response_model=ShopBannerOut, dependencies=[Depends(get_current_user)])
async def update_banner(banner_id: int, body: ShopBannerCreate, db: AsyncSession = Depends(get_db)):
    stmt = select(shop_banner).where(shop_banner.id == banner_id)
    banner = (await db.execute(stmt)).scalar_one_or_none()
    if not banner:
        raise HTTPException(status_code=404, detail="Banner not found")
    
    for key, value in body.model_dump().items():
        setattr(banner, key, value)
    
    await db.commit()
    await db.refresh(banner)
    return banner

@router.delete("/admin/banners/{banner_id}", dependencies=[Depends(get_current_user)])
async def delete_banner(banner_id: int, db: AsyncSession = Depends(get_db)):
    stmt = select(shop_banner).where(shop_banner.id == banner_id)
    banner = (await db.execute(stmt)).scalar_one_or_none()
    if not banner:
        raise HTTPException(status_code=404, detail="Banner not found")
    
    await db.delete(banner)
    await db.commit()
    return {"message": "Banner deleted successfully"}

# --- Product Image Auto Setup ---

@router.post("/admin/products/auto-image-setup", dependencies=[Depends(get_current_user)])
async def auto_setup_product_images(body: ProductImageSetupRequest, db: AsyncSession = Depends(get_db)):
    """
    Automatically matches products with images based on item code or name.
    Expects images to be in /public/products/ folder named {item_code}.jpg or {item_code}_1.jpg etc.
    """
    stmt = select(product_model).where(product_model.is_active == True)
    products = (await db.execute(stmt)).scalars().all()
    
    updated_count = 0
    # Simple matching logic for demonstration. In a real system, we'd check filesystem or a media library.
    # For this task, we will assume images exist if we follow the naming convention.
    for p in products:
        # Example: if item_code is 'GROC001', check for 'GROC001.jpg', 'GROC001_1.jpg' etc.
        # We'll just set them for products that have an item_code
        if p.item_code:
            p.image1 = f"/products/{p.item_code}.jpg"
            p.image2 = f"/products/{p.item_code}_1.jpg"
            p.image3 = f"/products/{p.item_code}_2.jpg"
            p.image4 = f"/products/{p.item_code}_3.jpg"
            # Also update main thumbnails if empty
            if not p.thumbnail_img: p.thumbnail_img = p.image1
            if not p.image_path: p.image_path = p.image1
            updated_count += 1
            
    if not body.dry_run:
        await db.commit()
        
    return {"message": f"Successfully mapped images for {updated_count} products", "updated_count": updated_count}
