"""파트너 발주 — partner-scoped 엔드포인트.

`/api/orders` (admin-scoped) 와 분리된 partner-scoped 라우터. 파트너가 자기
파트너 JWT 로만 자기 발주를 생성·조회할 수 있다.

권한 모델:
  · `POST /api/partner/orders` — partner-scoped JWT 필수, 자기 발주 생성
  · `GET  /api/partner/orders` — partner-scoped JWT 필수, 자기 partner_id 만 필터
  · `POST /api/partner/orders/{id}/cancel` — partner-scoped JWT 필수,
    자기 partner_id 의 '접수' 상태 발주만 취소

어드민이 모든 발주를 보는 `/admin/orders` 는 그대로 admin-scoped `/api/orders`
를 사용 — 양쪽이 같은 Aiven `orders` 테이블을 공유하므로 파트너가 발주하면
즉시 어드민 화면에서도 보임.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from db import get_session
from models import Order, Partner
from routes_partner_auth import require_partner_token


router = APIRouter(prefix="/api/partner/orders", tags=["partner-orders"])


def _order_to_dict(order: Order) -> dict[str, Any]:
    return {
        "id": order.id,
        "partner_id": order.partner_id,
        "title": order.title,
        "status": order.status,
        "amount": order.amount,
        "items": list(order.items or []) if isinstance(order.items, list) else (order.items or {}),
        "due_date": order.due_date.isoformat() if order.due_date else None,
        "note": order.note,
        "created_at": order.created_at.isoformat() if order.created_at else None,
        "updated_at": order.updated_at.isoformat() if order.updated_at else None,
    }


class PartnerOrderItem(BaseModel):
    sku: str = ""
    name: str = ""
    unit: str = ""
    qty: int = 0
    price: int = 0


class PartnerOrderCreateIn(BaseModel):
    title: str = Field(min_length=1, max_length=190)
    items: list[PartnerOrderItem] = []
    amount: int = 0
    note: str = ""


@router.get("")
async def list_partner_orders(
    page: int = 1,
    page_size: int = 100,
    partner: Partner = Depends(require_partner_token),
    session: AsyncSession = Depends(get_session),
):
    page = max(1, page)
    page_size = min(max(1, page_size), 200)
    stmt = (
        select(Order)
        .where(Order.partner_id == partner.id)
        .order_by(desc(Order.created_at))
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    rows = (await session.execute(stmt)).scalars().all()
    return {
        "ok": True,
        "page": page,
        "page_size": page_size,
        "items": [_order_to_dict(r) for r in rows],
    }


@router.post("", status_code=201)
async def create_partner_order(
    payload: PartnerOrderCreateIn,
    partner: Partner = Depends(require_partner_token),
    session: AsyncSession = Depends(get_session),
):
    """파트너 본인 발주 생성. partner_id 는 JWT 로부터 채워지며 클라이언트가
    임의로 지정하지 못한다(다른 파트너 사칭 방지).
    """
    if not payload.title.strip():
        raise HTTPException(400, detail="발주 제목이 필요합니다.")
    items_data = [it.model_dump() for it in payload.items]
    order = Order(
        partner_id=partner.id,
        title=payload.title.strip()[:190],
        status="접수",
        amount=int(payload.amount or 0),
        items=items_data,
        note=(payload.note or "").strip()[:2000],
    )
    session.add(order)
    await session.flush()
    return {"ok": True, "item": _order_to_dict(order)}


class PartnerCancelIn(BaseModel):
    reason: str = ""


@router.post("/{order_id}/cancel", status_code=200)
async def cancel_partner_order(
    order_id: int,
    payload: PartnerCancelIn,
    partner: Partner = Depends(require_partner_token),
    session: AsyncSession = Depends(get_session),
):
    """본인 파트너의 '접수' 상태 발주만 취소. 처리중 / 출고완료 단계는 어드민 측만 변경 가능."""
    order = await session.get(Order, order_id)
    if not order or order.partner_id != partner.id:
        # 다른 파트너의 발주를 가리킨 경우에도 같은 404 응답 (정찰 차단).
        raise HTTPException(404, detail="해당 발주를 찾을 수 없습니다.")
    if order.status != "접수":
        raise HTTPException(409, detail="접수 단계의 발주만 취소할 수 있습니다.")
    order.status = "취소"
    if payload.reason:
        order.note = (order.note or "") + f"\n[취소 사유] {payload.reason.strip()[:500]}"
    await session.flush()
    return {"ok": True, "item": _order_to_dict(order)}
