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

    # Partner — backend partner-auth 도입(2026-05). 옛 schema 의 partners 테이블에
    # password_hash / last_login_at 컬럼이 없을 수 있으므로 idempotent ALTER 로 보강.
    ("partners", "password_hash", "VARCHAR(255)", "DEFAULT ''"),
    ("partners", "last_login_at", "DATETIME", ""),

    # Product (inventory) — 옛 시점에 만들어진 `products` 테이블이 ORM 신규
    # 컬럼과 schema drift 면 INSERT 시 'Unknown column' 으로 500 발생.
    # `Base.metadata.create_all()` 는 새 테이블만 만들고 컬럼 추가는 안 함.
    # 아래 idempotent ALTER 로 옛 schema 를 안전하게 보강 (data 손실 0).
    # 새 인스턴스에서는 create_all 이 이미 만들었기 때문에 모두 skip 됨.
    ("products", "category_code", "VARCHAR(3)", "DEFAULT 'MSC'"),
    ("products", "category_label", "VARCHAR(40)", "DEFAULT ''"),
    ("products", "option_code", "VARCHAR(2)", "DEFAULT '00'"),
    ("products", "option_label", "VARCHAR(60)", "DEFAULT ''"),
    ("products", "unit", "VARCHAR(16)", "DEFAULT 'EA'"),
    ("products", "price", "INT", "DEFAULT 0"),
    ("products", "stock_count", "INT", "DEFAULT 0"),
    ("products", "low_stock_threshold", "INT", "DEFAULT 10"),
    ("products", "description", "TEXT", ""),
    ("products", "image_url", "VARCHAR(500)", "DEFAULT ''"),
    ("products", "active", "TINYINT(1)", "DEFAULT 1"),

    # StockHistory — 신규 상품 등록 시 stock_count > 0 면 INSERT 진입.
    # 옛 schema 누락 컬럼 보강.
    ("stock_history", "lot_id", "INT", ""),
    ("stock_history", "reason", "VARCHAR(40)", "DEFAULT ''"),
    ("stock_history", "ref_type", "VARCHAR(40)", "DEFAULT ''"),
    ("stock_history", "ref_id", "VARCHAR(60)", "DEFAULT ''"),
    ("stock_history", "note", "VARCHAR(255)", "DEFAULT ''"),

    # StockLot — LOT 입고 시 INSERT. 옛 schema 누락 컬럼 보강.
    ("stock_lots", "produced_at", "DATETIME", ""),
    ("stock_lots", "expires_at", "DATETIME", ""),
    ("stock_lots", "received_at", "DATETIME", ""),
    ("stock_lots", "supplier", "VARCHAR(190)", "DEFAULT ''"),
    ("stock_lots", "note", "VARCHAR(255)", "DEFAULT ''"),
    ("stock_lots", "quarantined", "TINYINT(1)", "DEFAULT 0"),
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
    # 미디어 라이브러리 — 라이브러리 그리드가 created_at DESC 정렬.
    ("media_assets", "created_at", "ix_media_assets_created_at"),
    ("media_assets", "url", "ix_media_assets_url"),
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


def _safe_default_clause_for_column(col) -> str:
    """ORM Column 의 nullable / type / default 정보를 보고 *MySQL/SQLite 양쪽
    안전한* DDL fragment 를 만든다. 빈 문자열 반환 시 NOT NULL 도 DEFAULT 도
    안 붙음 (= 호출자가 NULL 허용 컬럼을 만들겠다는 뜻).

    rationale: SQLAlchemy `Column(..., default=…)` 은 *Python-side* default
    이라 ALTER TABLE ADD COLUMN 시 DDL 에 들어가지 않는다. ORM 으로 생성된
    INSERT 는 Python default 를 채워주지만, 테이블에 직접 INSERT 하거나
    SQLAlchemy 세션이 dirty default 를 안 채우는 edge case 에서는 'Field …
    doesn't have a default value' 가 발생. 이를 막으려면 DDL 에 server-side
    default 를 부착해야 함.
    """
    try:
        py_type = col.type.python_type
    except (NotImplementedError, AttributeError):
        py_type = None
    if py_type is bool:
        return "NOT NULL DEFAULT 0"
    if py_type is int:
        return "NOT NULL DEFAULT 0"
    if py_type is float:
        return "NOT NULL DEFAULT 0"
    if py_type is str:
        # TEXT/MEDIUMTEXT 컬럼은 MySQL 5.x 에서 DEFAULT 못 가짐 — NULL 허용으로
        # 두는 게 호환성 안전. SQLAlchemy `Text` 컬럼 검출.
        from sqlalchemy import Text
        if isinstance(col.type, Text):
            return ""  # NULL 허용
        return "NOT NULL DEFAULT ''"
    # JSON 컬럼 — MySQL 8.0.13+ JSON DEFAULT 지원하지만 (JSON_ARRAY()) 같은
    # expression default 는 5.7 호환 X. NULL 허용으로 두는 게 안전.
    from sqlalchemy import JSON
    if isinstance(col.type, JSON):
        return ""
    # DateTime / 그 외 — NULL 허용.
    return ""


def _column_ddl(col, dialect) -> str:
    """`name TYPE [NOT NULL DEFAULT …]` ALTER TABLE 용 fragment."""
    type_compiled = col.type.compile(dialect=dialect)
    parts = [f"`{col.name}`", type_compiled]
    default_clause = _safe_default_clause_for_column(col)
    if default_clause:
        parts.append(default_clause)
    return " ".join(parts)


def auto_align_columns(conn: Connection, models: list) -> list[str]:
    """ORM 모델의 컬럼이 실제 DB 테이블과 일치하도록 자동 ALTER.

    · `Base.metadata.create_all()` 이 새 테이블만 만들고 기존 테이블의 신규
      컬럼은 안 만들어 발생하는 schema drift 를 보강.
    · 누락 컬럼만 ADD COLUMN — 기존 컬럼은 절대 변경하지 않음 (DROP / ALTER
      TYPE 안 함). data 손실 0.
    · NOT NULL + safe default 자동 부여 (위 `_safe_default_clause_for_column`).
    · 실패해도 다음 컬럼/테이블 계속 — fail-soft.
    """
    msgs: list[str] = []
    dialect = conn.dialect
    for model in models:
        table = getattr(model, "__tablename__", None)
        if not table:
            continue
        if not _table_exists(conn, table):
            continue
        existing = _existing_columns(conn, table)
        for col in model.__table__.columns:
            if col.name in existing:
                continue
            try:
                ddl = _column_ddl(col, dialect)
                stmt = f"ALTER TABLE `{table}` ADD COLUMN {ddl}"
                conn.execute(text(stmt))
                msgs.append(stmt)
                print(f"[align+] {stmt}")
            except Exception as e:  # noqa: BLE001
                print(f"[align!] {table}.{col.name}: {type(e).__name__}: {str(e)[:200]}")
    return msgs


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

    # 3) ORM 모델 ↔ 실제 테이블 자동 정렬 — schema drift 보강.
    #    (mutation 영향 받는 모델만 — admin_users / outbox / mail_templates 등은
    #    전용 entry 가 PENDING_COLUMNS 에 이미 있으므로 중복 skip 됨.)
    try:
        from models import (
            Work, Inquiry, Partner, PartnerBrand, Order, SitePopup, Promotion,
            Campaign, CrmCustomer, NewsletterSubscriber, Announcement,
            Document, DocumentTemplate, ShortLink,
        )
        align_models = [
            Work, Inquiry, Partner, PartnerBrand, Order, SitePopup, Promotion,
            Campaign, CrmCustomer, NewsletterSubscriber, Announcement,
            Document, DocumentTemplate, ShortLink,
        ]
        # MediaAsset 은 routes_media 가 별도 처리 — 있으면 추가.
        try:
            from models import MediaAsset
            align_models.append(MediaAsset)
        except Exception:  # noqa: BLE001
            pass
        # Product 도 중요 (SKU INSERT path).
        try:
            from models import Product
            align_models.append(Product)
        except Exception:  # noqa: BLE001
            pass
        applied.extend(auto_align_columns(conn, align_models))
    except Exception as e:  # noqa: BLE001
        print(f"[align] auto_align_columns failed: {e!r}")

    return applied


def install_migrations_sync(connection) -> None:
    """SQLAlchemy 의 sync 컨텍스트에서 호출하기 위한 wrapper.
    main.py 의 lifespan 에서 `await conn.run_sync(install_migrations_sync)` 형태로 사용.
    """
    run_pending_migrations(connection)
