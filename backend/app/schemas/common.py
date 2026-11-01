from pydantic import BaseModel
from typing import Generic, TypeVar

T = TypeVar("T")


class paginated_response(BaseModel, Generic[T]):
    data: list[T]
    total: int
    page: int
    per_page: int
    total_pages: int


class success_response(BaseModel):
    message: str
    id: int | None = None
