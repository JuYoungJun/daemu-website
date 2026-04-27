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
