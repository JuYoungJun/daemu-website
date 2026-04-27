"""Async SQLAlchemy setup.

DATABASE_URL examples:
    sqlite+aiosqlite:///./daemu.db                  (default — file-based, works on Render free tier)
    mysql+asyncmy://user:pass@host:3306/daemu       (production / Cafe24)

Schema is auto-created on startup via models.Base.metadata.create_all.
For more controlled migrations later, switch to Alembic.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "sqlite+aiosqlite:///./daemu.db",
)

# SQLite needs check_same_thread=False to be safe across async contexts;
# MySQL doesn't take that arg.
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    connect_args=connect_args,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class Base(DeclarativeBase):
    pass


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    session = SessionLocal()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency that yields a session and handles commit/rollback."""
    async with session_scope() as session:
        yield session
