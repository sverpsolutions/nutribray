from datetime import datetime
from sqlalchemy import JSON, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import base

class sync_validation_error(base):
    __tablename__ = "sync_validation_errors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    outlet_id: Mapped[int | None] = mapped_column(Integer)
    sync_type: Mapped[str] = mapped_column(String(50)) # sales, purchase, etc.
    sync_date: Mapped[str | None] = mapped_column(String(20))
    error_type: Mapped[str] = mapped_column(String(100)) # MissingColumn, MissingData, etc.
    details: Mapped[str | None] = mapped_column(Text)
    raw_data: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20), default="pending") # pending, resolved, ignored
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
