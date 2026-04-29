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

# Aiven / Cafe24 등에서 발급받은 표준 'mysql://...' URI 를 그대로 등록한 경우
# SQLAlchemy 는 sync driver(mysqldb) 를 시도하다 실패한다. 우리가 설치한 건
# async driver(asyncmy) 이므로 자동으로 driver prefix 를 부착.
if DATABASE_URL.startswith("mysql://"):
    DATABASE_URL = "mysql+asyncmy://" + DATABASE_URL[len("mysql://"):]
# Aiven Service URI 의 '?ssl-mode=REQUIRED' 쿼리는 asyncmy 가 알지 못해 무시
# 되거나(베스트) 'unexpected keyword' 에러가 날 수 있다. db.py 의 connect_args
# ssl 컨텍스트가 이미 SSL verify-required 로 작동하므로 제거.
if DATABASE_URL.startswith("mysql+") and "?ssl-mode=" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.split("?ssl-mode=")[0]
if DATABASE_URL.startswith("mysql+") and "&ssl-mode=" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.split("&ssl-mode=")[0]

# SQLite needs check_same_thread=False to be safe across async contexts;
# MySQL doesn't take that arg.
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False, "timeout": 30}
elif DATABASE_URL.startswith("mysql"):
    # Aiven / Cafe24 / 일반 managed MySQL 은 SSL 필수. asyncmy 는 connect_args
    # 의 ssl 옵션으로 SSL 컨텍스트를 받는다.
    #
    # Aiven 은 자체 발급 CA(self-signed) 를 chain 에 포함하므로 시스템 CA
    # bundle 만으로는 verify 가 실패한다. 두 가지 모드:
    #   1) MYSQL_SSL_CA 환경변수에 Aiven 의 CA PEM(전체 -----BEGIN... -----END
    #      CERTIFICATE----- 블록) 을 등록 → cadata 로 verify-required.
    #   2) 미설정 시 verify 우회 — 호스트명 + IP 기반 보안으로 충분, 단
    #      logs 에 경고. 운영 단계에서는 1) 권장.
    # DAEMU_MYSQL_SSL_DISABLE=1 이면 SSL 자체를 끔(같은 VPC self-host 등).
    import ssl as _ssl
    if os.environ.get("DAEMU_MYSQL_SSL_DISABLE") == "1":
        connect_args = {}
    else:
        ca_pem = (os.environ.get("MYSQL_SSL_CA") or "").strip()
        if ca_pem:
            ctx = _ssl.create_default_context(cadata=ca_pem)
            print("[db] mysql SSL: verify-required (MYSQL_SSL_CA 적용)")
        else:
            ctx = _ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = _ssl.CERT_NONE
            print(
                "[db] ⚠ mysql SSL verify 우회(MYSQL_SSL_CA 미설정). 운영 단계 "
                "에서는 Aiven 콘솔의 CA PEM 을 MYSQL_SSL_CA 로 등록 권장."
            )
        connect_args = {"ssl": ctx}

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
