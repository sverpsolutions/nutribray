from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", case_sensitive=False)

    # database
    database_url: str = "postgresql+asyncpg://postgres:password@localhost:5432/nutribay_erp"
    legacy_db_url: str = "mysql+aiomysql://root:@localhost:3306/bombayfishries_db"
    legacy_mssql_password: str = ""  # fallback for outlets without db_password

    # jwt
    secret_key: str = "change-this-to-a-long-random-secret-key-at-least-32-chars"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7

    # app
    app_name: str = "Nutribay Manufacturing ERP"
    app_version: str = "1.0.0"
    debug: bool = False
    allowed_origins: str = "http://localhost:5174,http://127.0.0.1:5174"

    @property
    def origins_list(self) -> list[str]:
        origins = [o.strip() for o in self.allowed_origins.split(",") if o.strip()]
        for extra in []:
            if extra not in origins:
                origins.append(extra)
        return origins


@lru_cache
def get_settings() -> settings:
    return settings()
