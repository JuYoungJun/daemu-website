"""부팅 시 자동 실행되는 가벼운 스키마 마이그레이션.

SQLAlchemy 의 `Base.metadata.create_all()` 은 *새* 테이블만 만들고
기존 테이블의 컬럼 변경은 처리하지 않습니다. 운영 DB (Aiven MySQL /
Cafe24 self-host MariaDB) 는 deploy 사이에 유지되므로, 모델에 새 컬럼을
추가한 뒤 배포하면 기존 테이블에는 컬럼이 없어 SELECT/UPDATE 시 500 이
발생합니다.

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

    # AdminUser — 2FA 인증 앱 라벨 (Google Authenticator / Authy / 1Password / etc.)
    ("admin_users", "totp_app_label", "VARCHAR(40)", "DEFAULT ''"),
]


# 인덱스 보강 — 모델에 index=True 를 추가했을 때 기존 테이블에는 자동 적용
# 안 되므로 idempotent ALTER 로 처리. (table, column, index_name).
# CREATE INDEX IF NOT EXISTS 는 SQLite + MySQL 8 양쪽 지원.
PENDING_INDEXES: list[tuple[str, str, str]] = [
    ("admin_users", "created_at", "ix_admin_users_created_at"),
    ("orders", "partner_id", "ix_orders_partner_id"),
    ("orders", "created_at", "ix_orders_created_at"),
    ("works", "sort_order", "ix_works_sort_order"),
    ("works", "created_at", "ix_works_created_at"),
    ("documents", "crm_id", "ix_documents_crm_id"),
    ("documents", "partner_id", "ix_documents_partner_id"),
    ("documents", "order_id", "ix_documents_order_id"),
    ("documents", "work_id", "ix_documents_work_id"),
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
    인덱스도 누락 시 추가 (CREATE INDEX IF NOT EXISTS).
    returns 실행된 SQL statement 리스트 (로그용).
    """
    applied: list[str] = []

    # 1) 컬럼 추가 (idempotent)
    for table, column, sql_type, default_clause in PENDING_COLUMNS:
        if not _table_exists(conn, table):
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
            print(f"[migration] skip {clause!r}: {e!r}")

    # 2) 인덱스 추가 (idempotent — CREATE INDEX IF NOT EXISTS).
    #    SQLite / MySQL 8 양쪽 호환. 이미 있으면 silent skip.
    for table, column, index_name in PENDING_INDEXES:
        if not _table_exists(conn, table):
            continue
        clause = f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({column})"
        try:
            conn.execute(text(clause))
            applied.append(clause)
            print(f"[migration] applied: {clause}")
        except Exception as e:  # noqa: BLE001
            print(f"[migration] skip {clause!r}: {e!r}")

    return applied


def install_migrations_sync(connection) -> None:
    """SQLAlchemy 의 sync 컨텍스트에서 호출하기 위한 wrapper.
    main.py 의 lifespan 에서 `await conn.run_sync(install_migrations_sync)` 형태로 사용.
    """
    run_pending_migrations(connection)
