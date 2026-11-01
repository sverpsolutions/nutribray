from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, JSON
from app.core.database import base

class product_import_log(base):
    __tablename__ = "product_import_logs"

    id = Column(Integer, primary_key=True)
    filename = Column(String(255), nullable=False)
    total_rows = Column(Integer, default=0)
    success_rows = Column(Integer, default=0)
    failed_rows = Column(Integer, default=0)
    error_summary = Column(JSON, nullable=True) # Detailed list of errors
    status = Column(String(50), default="completed") # processing, completed, failed
    created_by = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
