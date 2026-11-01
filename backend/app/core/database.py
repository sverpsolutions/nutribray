from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.core.config import get_settings

_settings = get_settings()

# Main Postgres Engine
engine = create_async_engine(
    _settings.database_url,
    echo=_settings.debug,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

# Legacy MySQL Engine
legacy_engine = create_async_engine(
    _settings.legacy_db_url,
    echo=_settings.debug,
    pool_pre_ping=True,
)

legacy_session_factory = async_sessionmaker(
    legacy_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def get_legacy_db() -> AsyncSession:
    async with legacy_session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
