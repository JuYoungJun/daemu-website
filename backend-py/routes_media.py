"""미디어 라이브러리 메타 — `/api/media` CRUD.

업로드 자체는 별도 `/api/upload` 가 처리한다(file 저장 + url 반환). 본 라우터는
업로드된 파일의 메타데이터(이름·태그·alt·크기·업로더) 를 Aiven `media_assets`
테이블에 저장·조회·수정·삭제한다.

옛 동작에서는 `/admin/media` 가 메타를 브라우저 localStorage `daemu_media` 에만
보관해 다른 PC 에서 라이브러리 그리드가 같지 않았다. 본 라우터로 동일 admin
계정이 어느 환경에 로그인해도 같은 라이브러리를 본다.

권한:
  · GET  /api/media               — admin / developer / tester(read-only)
  · POST /api/media               — admin / developer
  · PATCH /api/media/{id}         — admin / developer
  · DELETE /api/media/{id}        — admin (소유자/uploaded_by 무관 — admin 권한 기준)

업로드 흐름:
  1) 클라이언트가 `/api/upload` 로 file POST → backend 가 url 반환
  2) 클라이언트가 즉시 `POST /api/media` { url, name, ... } 호출 → 메타 생성
  3) 어드민 미디어 페이지 hydrate 시 `GET /api/media` 응답 그대로 표시.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy import desc, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_perm, _resolve_user
from db import get_session
from models import AdminUser, MediaAsset


router = APIRouter(prefix="/api/media", tags=["media"])


def _model_to_dict(asset: MediaAsset) -> dict[str, Any]:
    return {
        "id": asset.id,
        "url": asset.url,
        "name": asset.name,
        "original_name": asset.original_name,
        "content_type": asset.content_type,
        "size": asset.size,
        "alt": asset.alt,
        "tags": list(asset.tags or []),
        "uploaded_by": asset.uploaded_by,
        "created_at": asset.created_at.isoformat() if asset.created_at else None,
        "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
    }


class MediaCreateIn(BaseModel):
    # url 은 외부 URL (≤500자) 또는 data:image/...;base64,... data URL
    # (1MB ≈ 1.4M base64 chars) 둘 다 허용. /api/upload 가 작은 이미지를
    # base64 inline 으로 응답하므로 frontend 가 그 응답을 그대로 POST 함.
    # cap 은 backend INLINE_CAP=1MB 대비 여유 (base64 4/3 + 헤더).
    url: str = Field(min_length=1, max_length=1_600_000)
    name: str = ""
    original_name: str = ""
    content_type: str = ""
    size: int = 0
    alt: str = ""
    tags: list[str] = []


class MediaUpdateIn(BaseModel):
    name: str | None = None
    alt: str | None = None
    tags: list[str] | None = None


@router.get("")
async def list_media(
    page: int = 1,
    page_size: int = 200,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("media", "read")),
):
    page = max(1, page)
    page_size = min(max(1, page_size), 500)
    total = (await session.execute(select(func.count()).select_from(MediaAsset))).scalar_one()
    stmt = (
        select(MediaAsset)
        .order_by(desc(MediaAsset.created_at))
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return {
        "ok": True,
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_model_to_dict(r) for r in rows],
    }


@router.post("", status_code=201)
async def create_media(
    payload: MediaCreateIn,
    authorization: str | None = Header(default=None),
    session: AsyncSession = Depends(get_session),
):
    """업로드된 파일에 대해 메타데이터 행 1건 생성.
    `uploaded_by` 는 현재 로그인 어드민의 id 로 자동 채움.
    """
    user = await _resolve_user(authorization, session)
    if user.role not in {"admin", "developer"}:
        raise HTTPException(403, detail="media write 권한이 없습니다.")
    asset = MediaAsset(
        url=payload.url.strip()[:500],
        name=(payload.name or payload.original_name or "").strip()[:190],
        original_name=(payload.original_name or "").strip()[:190],
        content_type=(payload.content_type or "").strip()[:120],
        size=int(payload.size or 0),
        alt=(payload.alt or "").strip()[:255],
        tags=list(payload.tags or []),
        uploaded_by=user.id,
    )
    session.add(asset)
    await session.flush()
    # SQLAlchemy 2.x async + server-side default(created_at) lazy-load 회피.
    await session.refresh(asset)
    return {"ok": True, "item": _model_to_dict(asset)}


@router.patch("/{asset_id}")
async def update_media(
    asset_id: int,
    payload: MediaUpdateIn,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("media", "write")),
):
    asset = await session.get(MediaAsset, asset_id)
    if not asset:
        raise HTTPException(404, detail="해당 미디어를 찾을 수 없습니다.")
    if payload.name is not None:
        asset.name = payload.name.strip()[:190]
    if payload.alt is not None:
        asset.alt = payload.alt.strip()[:255]
    if payload.tags is not None:
        asset.tags = list(payload.tags)
    await session.flush()
    await session.refresh(asset)
    return {"ok": True, "item": _model_to_dict(asset)}


@router.delete("/{asset_id}", status_code=204)
async def delete_media(
    asset_id: int,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("media", "delete")),
):
    """메타 행만 삭제. 실제 파일(Render disk / 외부 storage) 정리는 별도 작업
    (미디어 파일 garbage collection 은 운영 단계 별도 cron 으로 도입 예정).
    """
    asset = await session.get(MediaAsset, asset_id)
    if not asset:
        return None
    await session.delete(asset)
    await session.flush()
    return None
