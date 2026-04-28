"""부팅 시 자동 실행되는 가벼운 스키마 마이그레이션.

SQLAlchemy 의 `Base.metadata.create_all()` 은 *새* 테이블만 만들고
기존 테이블의 컬럼 변경은 처리하지 않습니다. Render free tier 의 SQLite
DB 는 deploy 사이에 유지되므로, 모델에 새 컬럼을 추가한 뒤 배포하면
기존 테이블에는 컬럼이 없어 SELECT/UPDATE 시 500 이 발생합니다.

이 모듈은:
  1. 현재 DB 의 컬럼 목록을 inspect 하고
  2. 모델에는 있지만 테이블에 없는 컬럼만 ALTER TABLE ADD COLUMN
  3. 한 번 추가되면 재실행해도 idempotent

Alembic 으로 본격 마이그레이션을 도입하기 전까지의 안전장치입니다.
"""

from __future__ import annotations

from typing import Iterable

from sqlalchemy import text
from sqlalchemy.engine import Connection


# 보강해야 할 컬럼 목록 — (table, column, sql_type, default_clause).
# default_clause 는 SQLite 가 ALTER TABLE ADD COLUMN 시 NOT NULL 인 경우
# DEFAULT 값을 요구하기 때문. NULL 허용은 default_clause '' 로.
PENDING_COLUMNS: list[tuple[str, str, str, str]] = [
    # AdminUser — 첫 접속 이메일 인증 시각.
    ("admin_users", "email_verified_at", "DATETIME", ""),

    # AdminEmailOtp — 발송 쿨다운 / 잠금 / 목적 / 신규 이메일 후보.
    ("admin_email_otp", "purpose", "VARCHAR(20)", "DEFAULT 'login_otp'"),
    ("admin_email_otp", "last_sent_at", "DATETIME", ""),
    ("admin_email_otp", "locked_until", "DATETIME", ""),
    ("admin_email_otp", "pending_email", "VARCHAR(190)", "DEFAULT ''"),
]


def _existing_columns(conn: Connection, table: str) -> set[str]:
    """SQLite + MySQL 호환 — information_schema 가 둘 다에 있어 안전."""
    dialect = conn.dialect.name
    if dialect == "sqlite":
        rows = conn.execute(text(f"PRAGMA table_info({table})")).all()
        return {r[1] for r in rows}  # 1 = name
    # MySQL / PostgreSQL
    rows = conn.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :t"
        ),
        {"t": table},
    ).all()
    return {r[0] for r in rows}


def _table_exists(conn: Connection, table: str) -> bool:
    dialect = conn.dialect.name
    if dialect == "sqlite":
        r = conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
            {"t": table},
        ).first()
        return bool(r)
    r = conn.execute(
        text(
            "SELECT 1 FROM information_schema.tables WHERE table_name = :t"
        ),
        {"t": table},
    ).first()
    return bool(r)


def run_pending_migrations(conn: Connection) -> list[str]:
    """누락된 컬럼만 추가. 이미 있는 컬럼은 건드리지 않습니다.
    returns 실행된 SQL statement 리스트 (로그용).
    """
    applied: list[str] = []
    for table, column, sql_type, default_clause in PENDING_COLUMNS:
        if not _table_exists(conn, table):
            # create_all 이 먼저 실행되었거나 아직 사용 안 한 모델 — skip.
            continue
        existing = _existing_columns(conn, table)
        if column in existing:
            continue
        clause = f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}"
        if default_clause:
            clause += " " + default_clause
        try:
            conn.execute(text(clause))
            applied.append(clause)
            print(f"[migration] applied: {clause}")
        except Exception as e:  # noqa: BLE001
            # 동시 부팅 race 등으로 이미 추가된 경우는 무시.
            print(f"[migration] skip {clause!r}: {e!r}")
    return applied


def install_migrations_sync(connection) -> None:
    """SQLAlchemy 의 sync 컨텍스트에서 호출하기 위한 wrapper.
    main.py 의 lifespan 에서 `await conn.run_sync(install_migrations_sync)` 형태로 사용.
    """
    run_pending_migrations(connection)
