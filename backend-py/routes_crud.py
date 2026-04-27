"""CRUD endpoints for core entities.

Public endpoints (no auth):
    POST /api/inquiries        — Contact form submission

Admin-only (Bearer JWT required):
    GET  /api/inquiries        — list with pagination + status filter
    GET  /api/inquiries/{id}
    PATCH /api/inquiries/{id}  — update status / note / mark replied
    DELETE /api/inquiries/{id}
    (same shape for: partners, orders, works, mail-template, popups, crm,
     campaigns, promotions, outbox)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_admin
from db import get_session
from models import (
    AdminUser,
    Campaign,
    ContentBlock,
    CrmCustomer,
    Inquiry,
    MailTemplate,
    Order,
    Outbox,
    Partner,
    Promotion,
    SitePopup,
    Work,
)

router = APIRouter(prefix="/api", tags=["crud"])


# ---------------------------------------------------------------------------
# Helpers

def model_to_dict(obj) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for col in obj.__table__.columns:
        val = getattr(obj, col.name)
        if isinstance(val, datetime):
            out[col.name] = val.isoformat()
        else:
            out[col.name] = val
    return out


# ---------------------------------------------------------------------------
# Inquiries

class InquiryIn(BaseModel):
    name: str
    email: EmailStr
    phone: str = ""
    brand_name: str = ""
    location: str = ""
    expected_open: str = ""
    category: str = ""
    message: str = ""


class InquiryUpdate(BaseModel):
    status: str | None = None
    note: str | None = None
    replied: bool | None = None


@router.post("/inquiries", status_code=201)
async def create_inquiry(payload: InquiryIn, session: AsyncSession = Depends(get_session)):
    """Public — Contact form posts here."""
    inq = Inquiry(**payload.model_dump())
    session.add(inq)
    await session.flush()
    return {"ok": True, "id": inq.id, "inquiry": model_to_dict(inq)}


@router.get("/inquiries")
async def list_inquiries(
    status: str | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 50,
    session: AsyncSession = Depends(get_session),
    _user: AdminUser = Depends(require_admin),
):
    stmt = select(Inquiry).order_by(desc(Inquiry.created_at))
    count_stmt = select(func.count(Inquiry.id))
    if status and status != "all":
        stmt = stmt.where(Inquiry.status == status)
        count_stmt = count_stmt.where(Inquiry.status == status)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            (Inquiry.name.ilike(like))
            | (Inquiry.email.ilike(like))
            | (Inquiry.brand_name.ilike(like))
            | (Inquiry.message.ilike(like))
        )
    total = (await session.execute(count_stmt)).scalar_one()
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    stmt = stmt.limit(page_size).offset((page - 1) * page_size)
    rows = (await session.execute(stmt)).scalars().all()
    return {"ok": True, "total": total, "page": page, "page_size": page_size, "items": [model_to_dict(r) for r in rows]}


@router.get("/inquiries/{inquiry_id}")
async def get_inquiry(inquiry_id: int, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_admin)):
    obj = await session.get(Inquiry, inquiry_id)
    if not obj:
        raise HTTPException(404, detail="inquiry not found")
    return {"ok": True, "inquiry": model_to_dict(obj)}


@router.patch("/inquiries/{inquiry_id}")
async def update_inquiry(inquiry_id: int, payload: InquiryUpdate, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_admin)):
    obj = await session.get(Inquiry, inquiry_id)
    if not obj:
        raise HTTPException(404, detail="inquiry not found")
    if payload.status is not None:
        obj.status = payload.status
    if payload.note is not None:
        obj.note = payload.note
    if payload.replied:
        obj.replied_at = datetime.now(timezone.utc)
        if obj.status == "신규":
            obj.status = "답변완료"
    await session.flush()
    return {"ok": True, "inquiry": model_to_dict(obj)}


@router.delete("/inquiries/{inquiry_id}", status_code=204)
async def delete_inquiry(inquiry_id: int, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_admin)):
    obj = await session.get(Inquiry, inquiry_id)
    if not obj:
        raise HTTPException(404, detail="inquiry not found")
    await session.delete(obj)


# ---------------------------------------------------------------------------
# Generic admin-only CRUD for the simpler entities

def _crud(model, prefix: str, allowed_fields: set[str], create_fields: set[str] | None = None):
    create_fields = create_fields or allowed_fields

    @router.get(f"/{prefix}")
    async def list_(
        page: int = 1,
        page_size: int = 100,
        session: AsyncSession = Depends(get_session),
        _u: AdminUser = Depends(require_admin),
    ):
        stmt = select(model).order_by(desc(getattr(model, "created_at", model.id)))
        total = (await session.execute(select(func.count()).select_from(model))).scalar_one()
        page = max(1, page)
        page_size = min(max(1, page_size), 500)
        stmt = stmt.limit(page_size).offset((page - 1) * page_size)
        rows = (await session.execute(stmt)).scalars().all()
        return {"ok": True, "total": total, "page": page, "page_size": page_size, "items": [model_to_dict(r) for r in rows]}

    @router.get(f"/{prefix}/{{item_id}}")
    async def get_(item_id: int, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_admin)):
        obj = await session.get(model, item_id)
        if not obj:
            raise HTTPException(404, detail="not found")
        return {"ok": True, "item": model_to_dict(obj)}

    @router.post(f"/{prefix}", status_code=201)
    async def create_(
        payload: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _u: AdminUser = Depends(require_admin),
    ):
        data = {k: v for k, v in payload.items() if k in create_fields}
        obj = model(**data)
        session.add(obj)
        await session.flush()
        return {"ok": True, "item": model_to_dict(obj)}

    @router.patch(f"/{prefix}/{{item_id}}")
    async def update_(
        item_id: int,
        payload: dict[str, Any],
        session: AsyncSession = Depends(get_session),
        _u: AdminUser = Depends(require_admin),
    ):
        obj = await session.get(model, item_id)
        if not obj:
            raise HTTPException(404, detail="not found")
        for k, v in payload.items():
            if k in allowed_fields:
                setattr(obj, k, v)
        await session.flush()
        return {"ok": True, "item": model_to_dict(obj)}

    @router.delete(f"/{prefix}/{{item_id}}", status_code=204)
    async def delete_(item_id: int, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_admin)):
        obj = await session.get(model, item_id)
        if not obj:
            raise HTTPException(404, detail="not found")
        await session.delete(obj)


_crud(Partner, "partners",
      allowed_fields={"company_name", "contact_name", "email", "phone", "category", "intro", "status"})

_crud(Order, "orders",
      allowed_fields={"partner_id", "title", "status", "amount", "items", "due_date", "note"})

_crud(Work, "works",
      allowed_fields={"slug", "title", "category", "summary", "content_md", "hero_image_url",
                      "gallery", "tags", "location", "year", "size_label", "floor_label",
                      "published", "sort_order"})

_crud(SitePopup, "popups",
      allowed_fields={"page_key", "title", "body", "image_url", "cta_label", "cta_href",
                      "placement", "frequency", "schedule_start", "schedule_end", "active"})

_crud(CrmCustomer, "crm",
      allowed_fields={"name", "email", "phone", "source", "status", "estimated_amount",
                      "tags", "notes", "last_contact_at"})

_crud(Campaign, "campaigns",
      allowed_fields={"name", "channel", "subject", "body", "images", "recipient_filter",
                      "status", "scheduled_at"})

_crud(Promotion, "promotions",
      allowed_fields={"title", "code", "discount_type", "discount_value",
                      "valid_from", "valid_to", "usage_limit", "active"})

_crud(Outbox, "outbox",
      allowed_fields={"type", "recipient", "subject", "body", "status", "error", "payload"})


# ---------------------------------------------------------------------------
# Mail template — keyed by 'kind', special upsert behavior

class MailTemplateUpsert(BaseModel):
    kind: str = Field(pattern=r"^(auto-reply|admin-reply|document)$")
    subject: str
    body: str = ""
    html: str | None = None
    images: list = []
    active: bool = True
    category: str = "all"


@router.get("/mail-template/{kind}")
async def get_mail_template(kind: str, session: AsyncSession = Depends(get_session)):
    """Public read so the frontend can render the auto-reply preview without auth."""
    res = await session.execute(select(MailTemplate).where(MailTemplate.kind == kind))
    tpl = res.scalar_one_or_none()
    if not tpl:
        return {"ok": True, "template": None}
    return {"ok": True, "template": model_to_dict(tpl)}


@router.put("/mail-template/{kind}")
async def upsert_mail_template(
    kind: str,
    payload: MailTemplateUpsert,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_admin),
):
    if payload.kind != kind:
        raise HTTPException(400, detail="kind in path and body must match")
    res = await session.execute(select(MailTemplate).where(MailTemplate.kind == kind))
    tpl = res.scalar_one_or_none()
    if tpl is None:
        tpl = MailTemplate(**payload.model_dump())
        session.add(tpl)
    else:
        for k, v in payload.model_dump().items():
            setattr(tpl, k, v)
    await session.flush()
    return {"ok": True, "template": model_to_dict(tpl)}


# ---------------------------------------------------------------------------
# Site content blocks (key/value)

class ContentBlockIn(BaseModel):
    value: dict | list


@router.get("/content/{key}")
async def get_content(key: str, session: AsyncSession = Depends(get_session)):
    res = await session.execute(select(ContentBlock).where(ContentBlock.key == key))
    block = res.scalar_one_or_none()
    if not block:
        return {"ok": True, "value": None}
    return {"ok": True, "value": block.value, "updated_at": block.updated_at.isoformat() if block.updated_at else None}


@router.put("/content/{key}")
async def put_content(key: str, payload: ContentBlockIn, session: AsyncSession = Depends(get_session), _u: AdminUser = Depends(require_admin)):
    res = await session.execute(select(ContentBlock).where(ContentBlock.key == key))
    block = res.scalar_one_or_none()
    if block is None:
        block = ContentBlock(key=key, value=payload.value)
        session.add(block)
    else:
        block.value = payload.value
    await session.flush()
    return {"ok": True, "value": block.value}
