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
elif DATABASE_URL.startswith("mysql"):
    # Aiven / 대부분의 managed MySQL 은 SSL 필수. asyncmy 는 connect_args 의
    # ssl 옵션으로 verify-required 컨텍스트를 받는다. Aiven 은 정상 CA chain
    # 이라 기본 verify 모드로 OK. 자체 호스팅 MySQL 이라면 환경변수
    # DAEMU_MYSQL_SSL_DISABLE=1 로 비활성 가능.
    if os.environ.get("DAEMU_MYSQL_SSL_DISABLE") != "1":
        import ssl as _ssl
        connect_args = {"ssl": _ssl.create_default_context()}

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    # MySQL wait_timeout(기본 28800s) 보다 짧게 — stale 연결 회피.
    pool_recycle=1800,
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
