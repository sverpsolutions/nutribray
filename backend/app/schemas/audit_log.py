from datetime import datetime
from pydantic import BaseModel, model_validator
from typing import Optional, Any


class audit_log_create(BaseModel):
    action: str
    module: str
    record_id: Optional[str] = None
    details: Optional[str] = None
    meta_data: Optional[dict] = None


class audit_log_out(BaseModel):
    id: int
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    action: str
    module: str
    record_id: Optional[int] = None
    record_no: Optional[str] = None
    description: Optional[str] = None
    details: Optional[str] = None          # same text as description (older screens read this name)
    meta_data: Optional[Any] = None
    ip_address: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

    @model_validator(mode="after")
    def _details(self):
        self.details = self.details or self.description
        return self
