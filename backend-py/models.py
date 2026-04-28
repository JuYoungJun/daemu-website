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
