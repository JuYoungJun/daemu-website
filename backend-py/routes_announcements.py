"""공지 / 프로모션 — 어드민 작성, 파트너 포털 / 공개 페이지 노출.

target = "all"            → 공개 사이트 + 파트너 포털 모두 표시
target = "partner_portal" → 파트너 포털 전용
kind   = notice / promo / urgent
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import desc, select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_perm
from db import get_session
from models import AdminUser, Announcement

router = APIRouter(prefix="/api", tags=["announcements"])


def _to_dict(obj: Announcement) -> dict[str, Any]:
    return {
        "id": obj.id, "title": obj.title, "body": obj.body, "kind": obj.kind,
        "target": obj.target, "image_url": obj.image_url, "cta_label": obj.cta_label,
        "cta_href": obj.cta_href, "active": obj.active,
        "scheduled_start": obj.scheduled_start.isoformat() if obj.scheduled_start else None,
        "scheduled_end": obj.scheduled_end.isoformat() if obj.scheduled_end else None,
        "created_by": obj.created_by,
        "created_at": obj.created_at.isoformat() if obj.created_at else None,
        "updated_at": obj.updated_at.isoformat() if obj.updated_at else None,
    }


# ─────────────────────────────────────────────────────────────────────
# Public — 파트너 포털 / 공개 사이트 가 active + scheduled 범위 안 항목만 받음

@router.get("/announcements/visible")
async def list_visible(target: str = Query("all", pattern=r"^(all|partner_portal)$")):
    """현재 노출 중인 공지/프로모션. 인증 X — 파트너 포털 + 공개 사이트가 호출."""
    async with get_session_context() as session:
        now = datetime.now(timezone.utc)
        stmt = select(Announcement).where(Announcement.active == True)  # noqa: E712
        if target == "partner_portal":
            # 파트너 포털은 partner_portal + all 둘 다 표시
            stmt = stmt.where(or_(Announcement.target == "partner_portal",
                                  Announcement.target == "all"))
        else:
            # 공개 사이트는 all 만
            stmt = stmt.where(Announcement.target == "all")
        stmt = stmt.where(or_(Announcement.scheduled_start == None,  # noqa: E711
                              Announcement.scheduled_start <= now))
        stmt = stmt.where(or_(Announcement.scheduled_end == None,  # noqa: E711
                              Announcement.scheduled_end >= now))
        stmt = stmt.order_by(desc(Announcement.created_at)).limit(50)
        rows = (await session.execute(stmt)).scalars().all()
        return {"ok": True, "items": [_to_dict(r) for r in rows]}


# Helper for unauthenticated read (we still want session_scope)
from contextlib import asynccontextmanager
from db import session_scope


@asynccontextmanager
async def get_session_context():
    async with session_scope() as s:
        yield s


# ─────────────────────────────────────────────────────────────────────
# Admin CRUD

class AnnouncementIn(BaseModel):
    title: str
    body: str = ""
    kind: str = "notice"  # notice / promo / urgent
    target: str = "partner_portal"  # all / partner_portal
    image_url: str = ""
    cta_label: str = ""
    cta_href: str = ""
    active: bool = True
    scheduled_start: datetime | None = None
    scheduled_end: datetime | None = None


@router.get("/announcements")
async def list_announcements(
    page: int = 1,
    page_size: int = 100,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("announcements", "read")),
):
    page = max(1, page)
    page_size = min(max(1, page_size), 500)
    stmt = select(Announcement).order_by(desc(Announcement.created_at))
    total = (await session.execute(select(func.count()).select_from(Announcement))).scalar_one()
    rows = (await session.execute(stmt.limit(page_size).offset((page - 1) * page_size))).scalars().all()
    return {"ok": True, "total": total, "page": page, "page_size": page_size,
            "items": [_to_dict(r) for r in rows]}


@router.post("/announcements", status_code=201)
async def create_announcement(
    payload: AnnouncementIn,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(require_perm("announcements", "write")),
):
    obj = Announcement(**payload.model_dump(), created_by=me.id)
    session.add(obj)
    await session.flush()
    return {"ok": True, "item": _to_dict(obj)}


@router.patch("/announcements/{aid}")
async def update_announcement(
    aid: int,
    payload: AnnouncementIn,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("announcements", "write")),
):
    obj = await session.get(Announcement, aid)
    if not obj:
        raise HTTPException(404, detail="not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    await session.flush()
    return {"ok": True, "item": _to_dict(obj)}


@router.delete("/announcements/{aid}", status_code=204)
async def delete_announcement(
    aid: int,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("announcements", "delete")),
):
    obj = await session.get(Announcement, aid)
    if not obj:
        return
    await session.delete(obj)
