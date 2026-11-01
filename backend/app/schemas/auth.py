from pydantic import BaseModel, EmailStr, field_validator


class login_request(BaseModel):
    username: str
    password: str


class token_response(BaseModel):
    access_token: str
    token_type: str = "bearer"


class refresh_request(BaseModel):
    refresh_token: str


class user_out(BaseModel):
    id: int
    name: str
    username: str
    email: str | None
    role: str
    role_id: int | None
    outlet_id: int | None
    status: bool

    model_config = {"from_attributes": True}
