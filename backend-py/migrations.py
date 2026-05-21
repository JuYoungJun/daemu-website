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
    # 첫 로그인 시 강제 비밀번호 변경 플래그. 가입 신청 직후 시드된 휴대폰
    # 끝 4자리는 일회용 — 사용자가 로그인 시 ForcePasswordChange 화면으로
    # 분기 후 강한 비밀번호로 변경.
    ("partners", "must_change_password", "TINYINT(1)", "DEFAULT 1"),
    # partner 본인이 비번을 마지막으로 교체한 시각. /partners Account 탭의
    # "비번 변경일" 표시. 옛 schema 에는 컬럼이 없으므로 idempotent 보강.
    ("partners", "password_changed_at", "DATETIME", ""),

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
# 안 되므로 idempotent 처리. (table, column, index_name).
# MySQL 은 CREATE INDEX 에 IF NOT EXISTS 절을 지원하지 않으므로 (8.0.45 에서도
# 1064 syntax error) information_schema 확인 후 분기. SQLite 만 IF NOT EXISTS.
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

    # 2) 인덱스 추가 (idempotent).
    #    MySQL 은 `CREATE INDEX IF NOT EXISTS` 를 지원하지 않음 — 8.0.45 에서도
    #    1064 syntax error. (PostgreSQL/SQLite 만 지원하는 비표준 syntax.)
    #    따라서 dialect 별로 분기 — MySQL 은 information_schema 로 사전 확인,
    #    SQLite 는 그대로 IF NOT EXISTS 사용.
    dialect_name = conn.dialect.name
    for table, column, index_name in PENDING_INDEXES:
        if not _table_exists(conn, table):
            continue
        try:
            if dialect_name == "sqlite":
                clause = f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({column})"
                conn.execute(text(clause))
            else:
                # MySQL / MariaDB / PostgreSQL: 존재 확인 후 없으면 생성.
                row = conn.execute(
                    text(
                        "SELECT 1 FROM information_schema.statistics "
                        "WHERE table_schema = DATABASE() "
                        "AND table_name = :t AND index_name = :i"
                    ),
                    {"t": table, "i": index_name},
                ).first()
                if row:
                    continue  # 이미 존재 — silent skip.
                clause = f"CREATE INDEX {index_name} ON {table} ({column})"
                conn.execute(text(clause))
            applied.append(clause)
            print(f"[migration] applied: {clause}")
        except Exception as e:  # noqa: BLE001
            print(f"[migration] skip index {index_name} on {table}({column}): {e!r}")

    # 2.5) 컬럼 타입 변경 — TEXT(64KB) → LONGTEXT(~4GB).
    # /admin/mail 의 base64 inline image 가 TEXT 한도 초과 시 'Data too long
    # for column' 500. MySQL 한정 — SQLite 는 TEXT 길이 제한 없음 (skip).
    # /api/upload 의 base64 inline (Render free 휘발 디스크 회피) 적용 후
    # image_url 컬럼들도 같은 이유로 LONGTEXT 필요 (VARCHAR(500) 으로는
    # data:image/jpeg;base64,... 1MB 본문 안 들어감).
    pending_type_changes = [
        ("mail_templates", "body", "longtext", "LONGTEXT"),
        ("mail_templates", "html", "longtext", "LONGTEXT"),
        ("mail_template_lib", "body", "longtext", "LONGTEXT"),
        ("works", "hero_image_url", "longtext", "LONGTEXT"),
        ("announcements", "image_url", "longtext", "LONGTEXT"),
        ("site_popups", "image_url", "longtext", "LONGTEXT"),
        ("partner_brands", "logo", "longtext", "LONGTEXT"),
        ("products", "image_url", "longtext", "LONGTEXT"),
        # media_assets.url 은 별도 처리 — 위 단순 ALTER 는 인덱스 충돌로 실패.
        # 아래 2.5.1 에서 DROP INDEX → MODIFY → CREATE INDEX(prefix) 순.
    ]
    if conn.dialect.name != "sqlite":
        for table, column, target_type, ddl_type in pending_type_changes:
            if not _table_exists(conn, table):
                continue
            try:
                row = conn.execute(
                    text(
                        "SELECT data_type FROM information_schema.columns "
                        "WHERE table_name = :t AND column_name = :c "
                        "AND table_schema = DATABASE()"
                    ),
                    {"t": table, "c": column},
                ).first()
            except Exception as e:  # noqa: BLE001
                print(f"[migration] inspect type {table}.{column} failed: {e!r}")
                continue
            if not row:
                continue
            current = str(row[0] or "").lower()
            if current == target_type:
                continue  # 이미 LONGTEXT — idempotent skip.
            clause = f"ALTER TABLE {table} MODIFY {column} {ddl_type}"
            try:
                conn.execute(text(clause))
                applied.append(clause)
                print(f"[migration] applied: {clause}  (was {current})")
            except Exception as e:  # noqa: BLE001
                print(f"[migration] skip {clause!r}: {e!r}")

    # 2.5.1) media_assets.url 만 별도 처리 — 위 단순 ALTER 가 인덱스 충돌
    # (MySQL ERROR 1170: BLOB/TEXT column used in key spec without key
    # length) 로 실패. url 컬럼에 ix_media_assets_url 인덱스가 걸려 있어
    # 단순 LONGTEXT 변환 불가. 순서: DROP INDEX → MODIFY → CREATE INDEX
    # (prefix length 191 — utf8mb4 4 bytes * 191 = 764 < 767 byte key
    # limit). MySQL 만 — SQLite 는 위 2.5 에서 처리 skip 됨.
    if conn.dialect.name != "sqlite" and _table_exists(conn, "media_assets"):
        try:
            col_row = conn.execute(text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_schema=DATABASE() AND table_name='media_assets' "
                "AND column_name='url'"
            )).first()
            current_type = str(col_row[0] or "").lower() if col_row else ""
            if current_type and current_type != "longtext":
                # 1) 기존 인덱스 drop (있으면).
                idx_row = conn.execute(text(
                    "SELECT 1 FROM information_schema.statistics "
                    "WHERE table_schema=DATABASE() AND table_name='media_assets' "
                    "AND index_name='ix_media_assets_url'"
                )).first()
                if idx_row:
                    conn.execute(text("DROP INDEX ix_media_assets_url ON media_assets"))
                # 2) LONGTEXT 변환.
                conn.execute(text("ALTER TABLE media_assets MODIFY url LONGTEXT"))
                # 3) prefix-length 인덱스 재생성. 옛 인덱스 없었으면 새로 만듦
                #    (없어도 무방하지만 검색 perf 유지).
                conn.execute(text("CREATE INDEX ix_media_assets_url ON media_assets(url(191))"))
                applied.append("media_assets.url → LONGTEXT + url(191) index")
                print(f"[migration] applied: media_assets.url → LONGTEXT + url(191) prefix index (was {current_type})")
        except Exception as e:  # noqa: BLE001
            print(f"[migration] skip media_assets.url LONGTEXT: {e!r}")

    # 2.5.2) FK ON DELETE SET NULL 보강 — Partner / Document 의 부모 row 가
    # 삭제될 때 자식 row 의 FK 컬럼만 NULL 로 바꾸도록. 모델 정의 (models.py)
    # 의 `ondelete="SET NULL"` 은 신규 schema 에만 반영되고, 기존 운영 DB 의
    # 옛 constraint 는 기본 RESTRICT 로 남아있어 Partner 삭제 시 IntegrityError.
    #
    # MySQL 은 constraint 이름이 자동 생성 (orders_ibfk_1 등) 이라
    # information_schema.referential_constraints 로 동적 lookup 후 DROP + ADD.
    # SQLite 는 ALTER 로 FK 변경 불가 — 새 schema 부팅엔 create_all 이
    # SET NULL 로 반영되므로 SQLite 환경에선 skip (운영은 MySQL).
    fk_set_null_targets = [
        # (table, column, ref_table, ref_column)
        ("orders", "partner_id", "partners", "id"),
        ("documents", "partner_id", "partners", "id"),
        ("documents", "crm_id", "crm_customers", "id"),
        ("documents", "order_id", "orders", "id"),
        ("documents", "work_id", "works", "id"),
    ]
    if conn.dialect.name != "sqlite":
        for table, column, ref_table, ref_column in fk_set_null_targets:
            if not _table_exists(conn, table) or not _table_exists(conn, ref_table):
                continue
            try:
                # 현재 FK constraint 찾기 — 이름은 자동 생성이라 동적 lookup.
                fk_row = conn.execute(text(
                    "SELECT k.constraint_name, rc.delete_rule "
                    "FROM information_schema.key_column_usage k "
                    "JOIN information_schema.referential_constraints rc "
                    "  ON k.constraint_name = rc.constraint_name "
                    " AND k.constraint_schema = rc.constraint_schema "
                    "WHERE k.table_schema = DATABASE() "
                    "  AND k.table_name = :t "
                    "  AND k.column_name = :c "
                    "  AND k.referenced_table_name = :rt "
                    "  AND k.referenced_column_name = :rc "
                ), {"t": table, "c": column, "rt": ref_table, "rc": ref_column}).first()
                if not fk_row:
                    # constraint 부재 — create_all 이 새로 만들 때 ondelete 반영됨.
                    continue
                constraint_name, delete_rule = fk_row[0], (fk_row[1] or "").upper()
                if delete_rule == "SET NULL":
                    continue  # 이미 SET NULL — idempotent skip.
                # DROP 후 재생성. constraint 이름 SQL injection 회피 — DB
                # 가 자동 부여한 식별자만 들어옴 (운영자 입력 아님), 정규식
                # 검증 추가로 방어 깊이.
                import re as _re
                if not _re.fullmatch(r"[A-Za-z0-9_]+", constraint_name):
                    print(f"[migration] skip FK SET NULL — suspicious constraint name: {constraint_name!r}")
                    continue
                conn.execute(text(f"ALTER TABLE {table} DROP FOREIGN KEY {constraint_name}"))
                conn.execute(text(
                    f"ALTER TABLE {table} ADD CONSTRAINT {constraint_name} "
                    f"FOREIGN KEY ({column}) REFERENCES {ref_table}({ref_column}) "
                    f"ON DELETE SET NULL"
                ))
                applied.append(f"{table}.{column} FK → SET NULL (was {delete_rule})")
                print(f"[migration] applied: {table}.{column} FK → ON DELETE SET NULL (was {delete_rule})")
            except Exception as e:  # noqa: BLE001
                print(f"[migration] skip FK SET NULL on {table}.{column}: {e!r}")

    # 2.5.3) FK ON DELETE 정책 강화 + 신규 FK 추가 (Step 2 — 2026-05-21).
    # 기존 FK 의 delete_rule 만 변경하는 케이스와 (예: stock_history.lot_id,
    # short_link_clicks.short_link_id), 컬럼은 있지만 FK constraint 자체가
    # 없는 케이스 (예: stock_lots.sku — 자연키 참조), 그리고 신규 컬럼 +
    # FK 케이스 (crm_customers.partner_id) 를 한 로직으로 처리.
    #
    # crm_customers.partner_id 컬럼 자체의 추가는 위 3) auto_align_columns 가
    # 처리 — 본 section 은 FK constraint 만. SQLite 는 ALTER FK 불가 → skip.
    fk_new_or_change = [
        # (table, column, ref_table, ref_column, delete_rule)
        ("stock_lots", "sku", "products", "sku", "CASCADE"),
        ("stock_history", "lot_id", "stock_lots", "id", "SET NULL"),
        ("short_link_clicks", "short_link_id", "short_links", "id", "CASCADE"),
        ("crm_customers", "partner_id", "partners", "id", "SET NULL"),
    ]
    if conn.dialect.name != "sqlite":
        import re as _re_fk
        for table, column, ref_table, ref_column, delete_rule in fk_new_or_change:
            if not _table_exists(conn, table) or not _table_exists(conn, ref_table):
                continue
            try:
                # 컬럼 존재 확인 — auto_align 이 다음 부팅에 추가하는 케이스 회피.
                col_row = conn.execute(text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema=DATABASE() AND table_name=:t AND column_name=:c"
                ), {"t": table, "c": column}).first()
                if not col_row:
                    print(f"[migration] skip FK on {table}.{column} — column not yet present")
                    continue
                # 기존 FK constraint lookup.
                fk_row = conn.execute(text(
                    "SELECT k.constraint_name, rc.delete_rule "
                    "FROM information_schema.key_column_usage k "
                    "JOIN information_schema.referential_constraints rc "
                    "  ON k.constraint_name = rc.constraint_name "
                    " AND k.constraint_schema = rc.constraint_schema "
                    "WHERE k.table_schema = DATABASE() "
                    "  AND k.table_name = :t "
                    "  AND k.column_name = :c "
                    "  AND k.referenced_table_name = :rt "
                    "  AND k.referenced_column_name = :rcc"
                ), {"t": table, "c": column, "rt": ref_table, "rcc": ref_column}).first()
                if fk_row:
                    cname, current_rule = fk_row[0], (fk_row[1] or "").upper()
                    if current_rule == delete_rule:
                        continue  # idempotent skip
                    if not _re_fk.fullmatch(r"[A-Za-z0-9_]+", cname):
                        print(f"[migration] skip FK change — suspicious name: {cname!r}")
                        continue
                    conn.execute(text(f"ALTER TABLE {table} DROP FOREIGN KEY {cname}"))
                    conn.execute(text(
                        f"ALTER TABLE {table} ADD CONSTRAINT {cname} "
                        f"FOREIGN KEY ({column}) REFERENCES {ref_table}({ref_column}) "
                        f"ON DELETE {delete_rule}"
                    ))
                    applied.append(f"{table}.{column} FK → ON DELETE {delete_rule} (was {current_rule})")
                    print(f"[migration] applied: {table}.{column} FK → ON DELETE {delete_rule} (was {current_rule})")
                else:
                    # FK 자체 부재 — 신규 생성 (이름은 MySQL 자동 부여).
                    conn.execute(text(
                        f"ALTER TABLE {table} ADD FOREIGN KEY ({column}) "
                        f"REFERENCES {ref_table}({ref_column}) ON DELETE {delete_rule}"
                    ))
                    applied.append(f"{table}.{column} FK → NEW ON DELETE {delete_rule}")
                    print(f"[migration] applied: {table}.{column} FK → NEW ON DELETE {delete_rule}")
            except Exception as e:  # noqa: BLE001
                print(f"[migration] skip FK on {table}.{column}: {e!r}")

    # 2.6) 이미지 URL 경로 정규화 — `assets/foo.png` (앞 `/` 없음) →
    # `/assets/foo.png`. SPA 가 sub-path 에 deploy 될 때 (GitHub Pages
    # /daemu-website/) 상대 path 가 현재 라우트 기준으로 해석되어 깨지는
    # 회귀 회피. frontend 의 safeMediaUrl / escUrl 이 base prefix 부착하지만
    # 데이터 자체가 정규화되어 있으면 어떤 코드 경로에서도 안전.
    # idempotent — 이미 `/assets/` 또는 absolute URL (`http(s)://...`,
    # `data:`) 인 row 는 건드리지 않음.
    image_normalize_targets = [
        ("works", "hero_image_url"),
        ("announcements", "image_url"),
        ("site_popups", "image_url"),
        ("partner_brands", "logo"),
        ("products", "image_url"),
        ("media_assets", "url"),
    ]
    for table, column in image_normalize_targets:
        if not _table_exists(conn, table):
            continue
        try:
            # `assets/` 로 시작하지만 `/assets/` 가 아닌 row 만 갱신.
            # MySQL/PostgreSQL/SQLite 모두 호환되는 단순 LIKE 필터.
            stmt = (
                f"UPDATE {table} SET {column} = CONCAT('/', {column}) "
                f"WHERE {column} LIKE 'assets/%' AND {column} NOT LIKE '/%'"
            )
            if conn.dialect.name == "sqlite":
                stmt = (
                    f"UPDATE {table} SET {column} = '/' || {column} "
                    f"WHERE {column} LIKE 'assets/%' AND {column} NOT LIKE '/%'"
                )
            res = conn.execute(text(stmt))
            n = getattr(res, "rowcount", 0) or 0
            if n:
                applied.append(f"normalize {table}.{column} ({n} rows)")
                print(f"[migration] normalized {table}.{column}: {n} rows ('assets/...' → '/assets/...')")
        except Exception as e:  # noqa: BLE001
            print(f"[migration] skip normalize {table}.{column}: {e!r}")

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
