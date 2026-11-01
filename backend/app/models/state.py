from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import base


class state_master(base):
    __tablename__ = "state_master"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    state_name: Mapped[str] = mapped_column(String(100), nullable=False)
    state_code: Mapped[str] = mapped_column(String(2), nullable=False, unique=True)
    is_ut: Mapped[bool] = mapped_column(Boolean, default=False)   # Union Territory flag
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    def __repr__(self):
        return f"<state_master {self.state_code} - {self.state_name}>"


class supplier_gstin(base):
    """Multi-state GSTIN registrations per supplier"""
    __tablename__ = "supplier_gstins"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("suppliers.id"), nullable=False)
    gstin: Mapped[str] = mapped_column(String(15), nullable=False, unique=True)
    state_code: Mapped[str] = mapped_column(String(2), nullable=False)
    state_name: Mapped[str | None] = mapped_column(String(100))
    pan: Mapped[str] = mapped_column(String(10), nullable=False)
    registration_type: Mapped[str] = mapped_column(String(30), default="Regular")  # Regular/Composition/etc
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime)
    valid_till: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    supplier_rel = relationship("supplier", back_populates="gstins")
