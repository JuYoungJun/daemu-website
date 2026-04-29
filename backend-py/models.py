"""ORM models for DAEMU.

Designed to work on both MySQL 8 and SQLite (column types use SQLAlchemy's
generic types; JSON falls back to TEXT on SQLite via the Json variant).
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime | None) -> datetime | None:
    """MySQL DATETIME 컬럼은 tzinfo 를 저장하지 않아 SQLAlchemy 가 naive 로
    되돌려 준다. 우리 코드의 utcnow() 는 tz-aware UTC 라 비교 시 TypeError.
    DB 에서 읽은 datetime 을 tz-aware (UTC) 로 보정하는 헬퍼.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ---------------------------------------------------------------------------
# Auth

class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(190), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(32), default="admin")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # 첫 접속 시 이메일 인증 강제. 관리자가 만들어준 신규 계정은 NULL 로
    # 시작해 frontend AdminGate 가 인증 step → 비밀번호 변경 step 순서로 안내.
    # 인증 완료 시점이 기록되며, 한 번 검증된 후 다시 변경되지 않습니다.
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    # 2FA / TOTP — opt-in. Once totp_enabled is True, login requires a valid
    # 6-digit code from the user's authenticator app. recovery_codes is a JSON
    # array of bcrypt-hashed single-use backup codes.
    totp_secret: Mapped[str] = mapped_column(String(64), default="")
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    recovery_codes: Mapped[list | dict | None] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ---------------------------------------------------------------------------
# Public-facing entities

class Inquiry(Base):
    """Contact form submission."""
    __tablename__ = "inquiries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(190), index=True)
    phone: Mapped[str] = mapped_column(String(40), default="")
    brand_name: Mapped[str] = mapped_column(String(190), default="")
    location: Mapped[str] = mapped_column(String(120), default="")
    expected_open: Mapped[str] = mapped_column(String(60), default="")
    category: Mapped[str] = mapped_column(String(60), default="")
    message: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="신규", index=True)
    replied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    note: Mapped[str] = mapped_column(Text, default="")
    privacy_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Partner(Base):
    """B2B partner application / account."""
    __tablename__ = "partners"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    company_name: Mapped[str] = mapped_column(String(190))
    contact_name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str] = mapped_column(String(190), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(40), default="")
    category: Mapped[str] = mapped_column(String(60), default="")
    intro: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="대기", index=True)
    password_hash: Mapped[str] = mapped_column(String(255), default="")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    orders: Mapped[list["Order"]] = relationship(back_populates="partner")


class Order(Base):
    """PO / contract issued to a partner."""
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    partner_id: Mapped[int | None] = mapped_column(ForeignKey("partners.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(190))
    status: Mapped[str] = mapped_column(String(24), default="접수", index=True)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    items: Mapped[list | dict | None] = mapped_column(JSON, default=list)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    partner: Mapped[Partner | None] = relationship(back_populates="orders")


class Work(Base):
    """Portfolio item."""
    __tablename__ = "works"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(190))
    category: Mapped[str] = mapped_column(String(60), default="")
    summary: Mapped[str] = mapped_column(String(500), default="")
    content_md: Mapped[str] = mapped_column(Text, default="")
    hero_image_url: Mapped[str] = mapped_column(String(500), default="")
    gallery: Mapped[list | dict | None] = mapped_column(JSON, default=list)
    tags: Mapped[list | dict | None] = mapped_column(JSON, default=list)
    location: Mapped[str] = mapped_column(String(120), default="")
    year: Mapped[str] = mapped_column(String(8), default="")
    size_label: Mapped[str] = mapped_column(String(40), default="")
    floor_label: Mapped[str] = mapped_column(String(40), default="")
    published: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class MailTemplate(Base):
    """Auto-reply / admin-reply / document email templates."""
    __tablename__ = "mail_templates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(40), unique=True, index=True)  # auto-reply | admin-reply | document
    subject: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text, default="")
    html: Mapped[str | None] = mapped_column(Text, default=None)
    images: Mapped[list | dict | None] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    category: Mapped[str] = mapped_column(String(60), default="all")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Outbox(Base):
    """Sent / simulated email log."""
    __tablename__ = "outbox"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(40), default="email", index=True)  # auto-reply, admin-reply, campaign, document
    recipient: Mapped[str] = mapped_column(String(190), index=True)
    subject: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="sent", index=True)  # sent | failed | simulated
    error: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[list | dict | None] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class SitePopup(Base):
    """Marketing popup."""
    __tablename__ = "site_popups"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    page_key: Mapped[str] = mapped_column(String(40), default="all", index=True)
    title: Mapped[str] = mapped_column(String(190), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(String(500), default="")
    cta_label: Mapped[str] = mapped_column(String(60), default="")
    cta_href: Mapped[str] = mapped_column(String(500), default="")
    placement: Mapped[str] = mapped_column(String(40), default="center")
    frequency: Mapped[str] = mapped_column(String(40), default="every")
    schedule_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    schedule_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CrmCustomer(Base):
    """CRM customer/lead."""
    __tablename__ = "crm_customers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(190), index=True, default="")
    phone: Mapped[str] = mapped_column(String(40), default="")
    source: Mapped[str] = mapped_column(String(60), default="")  # contact-form, manual, campaign-x
    status: Mapped[str] = mapped_column(String(24), default="lead", index=True)  # lead | qualified | converted | lost
    estimated_amount: Mapped[int] = mapped_column(Integer, default=0)
    tags: Mapped[list | dict | None] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    last_contact_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(190))
    channel: Mapped[str] = mapped_column(String(20), default="Email")  # Email | SMS | Kakao
    subject: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    images: Mapped[list | dict | None] = mapped_column(JSON, default=list)
    recipient_filter: Mapped[list | dict | None] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)  # draft | scheduled | sent | failed
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    sent_count: Mapped[int] = mapped_column(Integer, default=0)
    failed_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Promotion(Base):
    __tablename__ = "promotions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(190))
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    discount_type: Mapped[str] = mapped_column(String(20), default="percent")  # percent | amount | bogo
    discount_value: Mapped[int] = mapped_column(Integer, default=0)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    usage_limit: Mapped[int] = mapped_column(Integer, default=0)  # 0 = unlimited
    usage_count: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ContentBlock(Base):
    """Generic key-value site copy / settings (about page text, etc.)."""
    __tablename__ = "content_blocks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    value: Mapped[list | dict | None] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DocumentTemplate(Base):
    """계약서 / 발주서 템플릿. body는 {{변수}} 플레이스홀더를 가진 텍스트.
    kind: contract | purchase_order
    """
    __tablename__ = "document_templates"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(190))
    kind: Mapped[str] = mapped_column(String(24), default="contract", index=True)
    subject: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    variables: Mapped[list | dict | None] = mapped_column(JSON, default=list)  # ["clientName","amount",...]
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Document(Base):
    """생성된 계약서 / 발주서. 템플릿에서 변수가 치환된 final body를 보관."""
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("document_templates.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(24), default="contract", index=True)  # contract | purchase_order
    title: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    variables: Mapped[list | dict | None] = mapped_column(JSON, default=dict)
    # Recipients — multiple supported. Each entry: {name, email, role}.
    recipients: Mapped[list | dict | None] = mapped_column(JSON, default=list)
    # Linked entities (optional) — kept loose so admins can reference any source.
    crm_id: Mapped[int | None] = mapped_column(ForeignKey("crm_customers.id"), nullable=True)
    partner_id: Mapped[int | None] = mapped_column(ForeignKey("partners.id"), nullable=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id"), nullable=True)
    work_id: Mapped[int | None] = mapped_column(ForeignKey("works.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="draft", index=True)
    # status: draft | sent | viewed | signed | canceled
    sign_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, default="")
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    first_viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    canceled_reason: Mapped[str] = mapped_column(String(255), default="")
    history: Mapped[list | dict | None] = mapped_column(JSON, default=list)  # audit trail
    created_by: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DocumentSignature(Base):
    """문서 서명 기록. 동일 문서에 여러 서명자가 가능하므로 별도 테이블."""
    __tablename__ = "document_signatures"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    signer_name: Mapped[str] = mapped_column(String(120))
    signer_email: Mapped[str] = mapped_column(String(190), default="", index=True)
    signature_data: Mapped[str] = mapped_column(Text, default="")  # data URL of canvas drawing
    consented: Mapped[bool] = mapped_column(Boolean, default=False)
    consent_text: Mapped[str] = mapped_column(Text, default="")
    ip: Mapped[str] = mapped_column(String(45), default="")
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class NewsletterSubscriber(Base):
    """Newsletter subscription — captured from the public site (Partners/Contact).
    Public POST /api/newsletter/subscribe creates a row; admin Campaign page
    pulls active subscribers as a recipient pool. Status: active | unsubscribed.
    """
    __tablename__ = "newsletter_subscribers"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(190), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    source: Mapped[str] = mapped_column(String(60), default="")  # partners-page / contact-page / manual
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)  # active | unsubscribed
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    unsubscribed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class AdminEmailOtp(Base):
    """6-digit email OTP for admin login + first-login email verification.

    purpose: "login_otp" | "email_verify"
      · login_otp    — 2FA-style step after password (B1 활성화 후)
      · email_verify — 신규 어드민 계정 첫 접속 이메일 검증

    Issued only when (RESEND_API_KEY is set OR simulated mode is permitted).
    code_hash 는 sha256 of cleartext; cleartext 는 절대 로깅/저장하지 않음.
    Cleanup cron 이 detected_at 1h 초과 row 제거.
    last_sent_at / locked_until 은 발송 쿨다운(60초)·연속 실패 잠금(15분)
    정책 강제용 (security-advisor F2 권고).
    """
    __tablename__ = "admin_email_otp"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("admin_users.id"), index=True)
    purpose: Mapped[str] = mapped_column(String(20), default="login_otp", index=True)
    code_hash: Mapped[str] = mapped_column(String(128))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 첫 접속 어드민이 새 이메일을 입력했을 때, 검증 완료 시 user.email
    # 을 이 값으로 업데이트. None 이면 기존 user.email 그대로 유지.
    pending_email: Mapped[str] = mapped_column(String(190), default="")
    ip: Mapped[str] = mapped_column(String(45), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class SuspiciousEvent(Base):
    """B2 — 의심행위(추정) 보존. 개인정보보호법 호환을 위해 보존 정책 명문화 필수.

    수집 항목 (보존 기간 90일 기본 / evidence flag = true 시 365일):
      - actor identifiers (IP, UA hash) — pseudonymous, not raw PII
      - request fingerprint (path, method, status, request_id)
      - reason ("brute_force_login", "scrape_pattern", "csrf_violation",
        "unauthorized_admin_attempt", "abnormal_payload" …)
      - severity (low / medium / high / critical)

    "evidence" 플래그가 true인 row만 자동 삭제 cron에서 제외됩니다.
    법적 절차(고소 등)에 사용할 row는 운영자가 명시적으로 evidence=true 설정.
    """
    __tablename__ = "suspicious_events"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    reason: Mapped[str] = mapped_column(String(80), index=True)
    ip: Mapped[str] = mapped_column(String(45), default="", index=True)
    user_agent_hash: Mapped[str] = mapped_column(String(64), default="")
    path: Mapped[str] = mapped_column(String(255), default="")
    method: Mapped[str] = mapped_column(String(10), default="")
    status_code: Mapped[int] = mapped_column(Integer, default=0)
    request_id: Mapped[str] = mapped_column(String(40), default="", index=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True, index=True)
    detail: Mapped[dict | list | None] = mapped_column(JSON, default=dict)
    # evidence=true → 보존 정책 무시(법적 사유), 운영자가 수동 raise할 때만
    evidence: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    evidence_note: Mapped[str] = mapped_column(String(255), default="")
    # operator가 결정 후 잠금 (변경 불가) — 위변조 방지
    sealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sealed_by: Mapped[str] = mapped_column(String(190), default="")


class MailTemplateLib(Base):
    """B1 — 어드민이 여러 메일 템플릿을 저장/관리.

    기존 MailTemplate(단일 row)을 보완. 템플릿 라이브러리는 단체메일 발송 시
    선택해 사용. variables는 {{var_name}} 자리표시자.
    """
    __tablename__ = "mail_template_lib"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    category: Mapped[str] = mapped_column(String(40), default="general")
    subject: Mapped[str] = mapped_column(String(200))
    body: Mapped[str] = mapped_column(Text)
    variables: Mapped[list | dict | None] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_by: Mapped[str] = mapped_column(String(190), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ShortLink(Base):
    """UTM 캠페인용 보안 short link (QR_SECURITY.md Stage 2).

    QR 에 우리 도메인의 short URL 만 인코딩해 위변조·재사용·피싱을 막는
    구조. target_url 자체는 서버측에만 존재. HMAC 서명으로 무결성 보장.

    필드:
      short_id: 추측 불가 8자 (URL-safe). PK 가 아니라 lookup 키.
      target_url: 실제 redirect 대상 (UTM 쿼리 포함된 URL).
      sig: HMAC-SHA256(target_url + short_id, server_secret) — DB 유출
           시에도 위조 불가. 검증 실패 시 자동 revoke.
      expires_at: 만료 일시 (None=무기한).
      max_clicks: 최대 클릭 수 한도 (None=무제한).
      click_count: 누적 클릭 — analytics 기본 단위.
      last_clicked_at: 마지막 클릭 일시 — 모니터링.
      revoked_at / revoked_reason: 운영자가 무효화 시 채움.
      label: 운영자 표시용 캠페인 라벨.
    """
    __tablename__ = "short_links"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    short_id: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    target_url: Mapped[str] = mapped_column(Text)
    sig: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    max_clicks: Mapped[int | None] = mapped_column(Integer, nullable=True)
    click_count: Mapped[int] = mapped_column(Integer, default=0)
    last_clicked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str] = mapped_column(String(255), default="")
    label: Mapped[str] = mapped_column(String(120), default="")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class ShortLinkClick(Base):
    """ShortLink 클릭 이벤트 — PII 최소화 형태로만 기록.

    IP 와 UA 는 hash 로만 보관 (개인정보보호법 익명화 원칙).
    referer 는 host 부분만 저장.
    """
    __tablename__ = "short_link_clicks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    short_link_id: Mapped[int] = mapped_column(ForeignKey("short_links.id"), index=True)
    clicked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    ip_hash: Mapped[str] = mapped_column(String(64), default="")
    ua_family: Mapped[str] = mapped_column(String(40), default="")  # "chrome" / "safari" / "mobile-chrome" 등
    referer_host: Mapped[str] = mapped_column(String(120), default="")


class AuditLog(Base):
    """접속기록 / 권한변경 / 인증이력 — 개인정보 보호법 제29조 안전성 확보 조치 준수.
    Retain ≥ 1년. The retention cron in main.py keeps these untouched so they
    survive the inquiry/outbox sweeps. Restrict deletes to a separate cron
    with its own retention setting (default 5y).
    """
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True, index=True)
    actor_email: Mapped[str] = mapped_column(String(190), default="", index=True)
    action: Mapped[str] = mapped_column(String(60), index=True)
    # login.success / login.failure / password.change / role.change /
    # user.create / user.delete / inquiry.delete / inquiry.export /
    # token.issue / endpoint.access ...
    target_type: Mapped[str] = mapped_column(String(40), default="")
    target_id: Mapped[str] = mapped_column(String(60), default="")
    ip: Mapped[str] = mapped_column(String(45), default="", index=True)
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    request_id: Mapped[str] = mapped_column(String(40), default="", index=True)
    detail: Mapped[list | dict | None] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
