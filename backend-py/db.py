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
    connect_args = {"check_same_thread": False, "timeout": 30}

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    connect_args=connect_args,
)


# Enable SQLite WAL mode + a generous busy timeout so concurrent writes from
# request handlers + background tasks (auto-reply outbox logging) don't trip
# "database is locked" on the free-tier single dyno.
if DATABASE_URL.startswith("sqlite"):
    from sqlalchemy import event

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=10000")  # 10s — wait instead of fail
        cursor.execute("PRAGMA synchronous=NORMAL")  # acceptable for demo durability
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

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
