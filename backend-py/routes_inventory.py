"""재고 / SKU / LOT / 유통기한 관리 endpoint.

표준 SKU 형식 DAEMU-CAT-NNNN-LL 을 자동 할당하고, LOT 단위 입고/출고/만료
관리와 발주 시 FIFO 차감을 지원. 어드민 콘솔의 /admin/inventory 와
/admin/products 에서 사용.

정책:
- 모든 재고 변동은 stock_history 에 audit row 1건 기록.
- expires_at 가장 이른 LOT 부터 차감 (FIFO).
- 만료 LOT 은 quarantined=true 자동 마크 (sweep cron).
- 재고 부족 시 발주 차단 (routes_crud.py 의 order create 에서 검증).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, func, select, asc
from sqlalchemy.ext.asyncio import AsyncSession

from auth import require_admin, require_perm
from db import get_session
from models import (
    AdminUser,
    Product,
    StockHistory,
    StockLot,
    as_utc,
)
from skuutil import (
    CATEGORIES,
    CATEGORY_CODES,
    build_sku,
    category_from_label,
    is_valid_sku,
    next_seq_for_category,
)

router = APIRouter(prefix="/api", tags=["inventory"])


def _model_to_dict(obj) -> dict[str, Any]:
    """간단 변환. routes_crud.py 의 동명 함수와 동일 정책."""
    out: dict[str, Any] = {}
    for col in obj.__table__.columns:
        v = getattr(obj, col.name)
        if isinstance(v, datetime):
            out[col.name] = v.isoformat()
        else:
            out[col.name] = v
    return out


# ─────────────────────────────────────────────────────────────────────
# SKU helper API

@router.get("/inventory/sku/categories")
async def list_categories(_u: AdminUser = Depends(require_perm("products", "read"))):
    """SKU 카테고리 정의 — frontend 가 dropdown 채울 때 사용."""
    return {
        "ok": True,
        "categories": [
            {"code": code, "label": meta["label"]}
            for code, meta in CATEGORIES.items()
        ],
    }


class SkuPreviewIn(BaseModel):
    category_code: str = Field(min_length=3, max_length=3)
    option_code: str = Field(default="00", min_length=1, max_length=2)


@router.post("/inventory/sku/preview")
async def preview_next_sku(
    payload: SkuPreviewIn,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("products", "read")),
):
    """다음 발급될 SKU 미리보기 — 운영자가 신규 상품 등록 form 에서 즉시 확인."""
    cat = (payload.category_code or "MSC").upper()
    if cat not in CATEGORY_CODES:
        raise HTTPException(400, detail=f"카테고리 코드는 {','.join(CATEGORY_CODES)} 중 하나여야 합니다.")
    res = await session.execute(select(Product.sku).where(Product.category_code == cat))
    existing = [row[0] for row in res.all()]
    seq = next_seq_for_category(existing, cat)
    sku = build_sku(cat, seq, payload.option_code)
    return {"ok": True, "sku": sku, "category_code": cat, "seq": seq, "option_code": payload.option_code}


# ─────────────────────────────────────────────────────────────────────
# Products CRUD

class ProductCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=190)
    category_code: str | None = None  # 미입력 시 category_label 기반 매핑
    category_label: str = ""
    option_code: str = "00"
    option_label: str = ""
    unit: str = "EA"
    price: int = 0
    stock_count: int = 0
    low_stock_threshold: int = 10
    description: str = ""
    image_url: str = ""
    sku: str | None = None  # 운영자가 직접 지정 시 그대로, 아니면 자동 할당


class ProductUpdateIn(BaseModel):
    name: str | None = None
    option_label: str | None = None
    unit: str | None = None
    price: int | None = None
    low_stock_threshold: int | None = None
    description: str | None = None
    image_url: str | None = None
    active: bool | None = None


@router.get("/products")
async def list_products(
    page: int = 1,
    page_size: int = 100,
    q: str = "",
    category: str = "",
    low_stock_only: bool = False,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("products", "read")),
):
    page = max(1, page)
    page_size = min(max(1, page_size), 500)
    stmt = select(Product).order_by(desc(Product.created_at))
    if q:
        like = f"%{q.strip()}%"
        from sqlalchemy import or_
        stmt = stmt.where(or_(Product.sku.ilike(like), Product.name.ilike(like)))
    if category:
        stmt = stmt.where(Product.category_code == category.upper())
    if low_stock_only:
        stmt = stmt.where(Product.stock_count <= Product.low_stock_threshold)
    total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await session.execute(stmt.limit(page_size).offset((page - 1) * page_size))).scalars().all()
    return {"ok": True, "total": total, "page": page, "page_size": page_size,
            "items": [_model_to_dict(r) for r in rows]}


@router.post("/products", status_code=201)
async def create_product(
    payload: ProductCreateIn,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("products", "write")),
):
    cat = (payload.category_code or category_from_label(payload.category_label)).upper()
    if cat not in CATEGORY_CODES:
        cat = "MSC"
    cat_label = payload.category_label or CATEGORIES[cat]["label"]

    # SKU 자동 할당 또는 사용자 지정
    if payload.sku:
        if not is_valid_sku(payload.sku):
            raise HTTPException(400, detail="SKU 형식이 표준에 맞지 않습니다 (DAEMU-CAT-NNNN-LL).")
        # 중복 체크
        dup = await session.execute(select(Product).where(Product.sku == payload.sku))
        if dup.scalar_one_or_none():
            raise HTTPException(409, detail="이미 존재하는 SKU 입니다.")
        sku = payload.sku
    else:
        existing = (await session.execute(select(Product.sku).where(Product.category_code == cat))).all()
        seq = next_seq_for_category([row[0] for row in existing], cat)
        sku = build_sku(cat, seq, payload.option_code)

    obj = Product(
        sku=sku,
        name=payload.name,
        category_code=cat,
        category_label=cat_label,
        option_code=(payload.option_code or "00")[:2].upper(),
        option_label=payload.option_label,
        unit=payload.unit,
        price=payload.price,
        stock_count=payload.stock_count,
        low_stock_threshold=payload.low_stock_threshold,
        description=payload.description,
        image_url=payload.image_url,
    )
    session.add(obj)
    await session.flush()

    # 초기 stock 기록
    if payload.stock_count:
        session.add(StockHistory(
            sku=sku, delta=payload.stock_count, reason="initial",
            ref_type="product", ref_id=str(obj.id),
            note="신규 상품 등록 시 초기 재고",
        ))
        await session.flush()

    return {"ok": True, "item": _model_to_dict(obj)}


@router.patch("/products/{pid}")
async def update_product(
    pid: int,
    payload: ProductUpdateIn,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("products", "write")),
):
    obj = await session.get(Product, pid)
    if not obj:
        raise HTTPException(404, detail="not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(obj, k, v)
    await session.flush()
    return {"ok": True, "item": _model_to_dict(obj)}


@router.delete("/products/{pid}", status_code=204)
async def delete_product(
    pid: int,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("products", "delete")),
):
    obj = await session.get(Product, pid)
    if not obj:
        return
    await session.delete(obj)


# ─────────────────────────────────────────────────────────────────────
# Stock adjust (수동 입고/조정/폐기)

class StockAdjustIn(BaseModel):
    sku: str
    delta: int  # 음수=출고, 양수=입고
    reason: str = "adjust"
    note: str = ""


@router.post("/inventory/adjust")
async def adjust_stock(
    payload: StockAdjustIn,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(require_perm("products", "write")),
):
    """수동 재고 조정 — 재고 변동을 stock_history 에 기록."""
    res = await session.execute(select(Product).where(Product.sku == payload.sku))
    p = res.scalar_one_or_none()
    if not p:
        raise HTTPException(404, detail="해당 SKU 상품이 없습니다.")
    new_count = (p.stock_count or 0) + payload.delta
    if new_count < 0:
        raise HTTPException(400, detail=f"재고 부족 — 현재 {p.stock_count}, 요청 차감 {-payload.delta}")
    p.stock_count = new_count
    session.add(StockHistory(
        sku=payload.sku, delta=payload.delta, reason=payload.reason or "adjust",
        ref_type="manual", ref_id=str(me.id), note=payload.note,
        actor_user_id=me.id,
    ))
    await session.flush()
    return {"ok": True, "stock_count": new_count}


# ─────────────────────────────────────────────────────────────────────
# StockLot — LOT 입고 / 만료 관리

class LotCreateIn(BaseModel):
    sku: str
    lot_number: str = Field(min_length=1, max_length=40)
    quantity: int = Field(ge=0)
    produced_at: datetime | None = None
    expires_at: datetime | None = None
    received_at: datetime | None = None
    supplier: str = ""
    note: str = ""


class LotUpdateIn(BaseModel):
    quantity: int | None = None
    expires_at: datetime | None = None
    supplier: str | None = None
    note: str | None = None
    quarantined: bool | None = None


@router.get("/inventory/lots")
async def list_lots(
    sku: str = "",
    days_to_expiry: int | None = None,  # D-N 임박 LOT 만 (만료 N일 이내)
    include_expired: bool = False,
    page: int = 1,
    page_size: int = 200,
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("products", "read")),
):
    page = max(1, page)
    page_size = min(max(1, page_size), 500)
    stmt = select(StockLot).order_by(asc(StockLot.expires_at), desc(StockLot.created_at))
    if sku:
        stmt = stmt.where(StockLot.sku == sku)
    now = datetime.now(timezone.utc)
    if days_to_expiry is not None:
        cutoff = now + timedelta(days=days_to_expiry)
        stmt = stmt.where(StockLot.expires_at != None, StockLot.expires_at <= cutoff)  # noqa: E711
    if not include_expired:
        stmt = stmt.where((StockLot.expires_at == None) | (StockLot.expires_at > now))  # noqa: E711
    total = (await session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (await session.execute(stmt.limit(page_size).offset((page - 1) * page_size))).scalars().all()
    return {"ok": True, "total": total, "page": page, "page_size": page_size,
            "items": [_model_to_dict(r) for r in rows]}


@router.post("/inventory/lots", status_code=201)
async def create_lot(
    payload: LotCreateIn,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(require_perm("products", "write")),
):
    # SKU 존재 확인 (느슨한 검증 — Product 가 미등록인 임시 자재도 허용)
    res = await session.execute(select(Product).where(Product.sku == payload.sku))
    product = res.scalar_one_or_none()

    obj = StockLot(
        sku=payload.sku,
        lot_number=payload.lot_number,
        quantity=payload.quantity,
        produced_at=payload.produced_at,
        expires_at=payload.expires_at,
        received_at=payload.received_at or datetime.now(timezone.utc),
        supplier=payload.supplier,
        note=payload.note,
        created_by=me.id,
    )
    session.add(obj)
    await session.flush()

    # Product 의 stock_count 도 동기화 (있으면)
    if product:
        product.stock_count = (product.stock_count or 0) + payload.quantity

    session.add(StockHistory(
        sku=payload.sku, lot_id=obj.id, delta=payload.quantity,
        reason="restock", ref_type="lot", ref_id=str(obj.id),
        note=f"LOT 입고 ({payload.lot_number})", actor_user_id=me.id,
    ))
    await session.flush()
    return {"ok": True, "item": _model_to_dict(obj)}


@router.patch("/inventory/lots/{lot_id}")
async def update_lot(
    lot_id: int,
    payload: LotUpdateIn,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(require_perm("products", "write")),
):
    obj = await session.get(StockLot, lot_id)
    if not obj:
        raise HTTPException(404, detail="not found")
    delta_qty = 0
    for k, v in payload.model_dump(exclude_unset=True).items():
        if k == "quantity":
            delta_qty = (v or 0) - (obj.quantity or 0)
        setattr(obj, k, v)
    if delta_qty:
        # Product stock 도 동기화
        res = await session.execute(select(Product).where(Product.sku == obj.sku))
        product = res.scalar_one_or_none()
        if product:
            product.stock_count = (product.stock_count or 0) + delta_qty
        session.add(StockHistory(
            sku=obj.sku, lot_id=obj.id, delta=delta_qty,
            reason="adjust", ref_type="lot", ref_id=str(obj.id),
            note="LOT 수량 조정", actor_user_id=me.id,
        ))
    await session.flush()
    return {"ok": True, "item": _model_to_dict(obj)}


@router.delete("/inventory/lots/{lot_id}", status_code=204)
async def delete_lot(
    lot_id: int,
    session: AsyncSession = Depends(get_session),
    me: AdminUser = Depends(require_perm("products", "delete")),
):
    obj = await session.get(StockLot, lot_id)
    if not obj:
        return
    if (obj.quantity or 0) > 0:
        # Product stock 도 차감
        res = await session.execute(select(Product).where(Product.sku == obj.sku))
        product = res.scalar_one_or_none()
        if product:
            product.stock_count = max(0, (product.stock_count or 0) - obj.quantity)
        session.add(StockHistory(
            sku=obj.sku, lot_id=obj.id, delta=-(obj.quantity or 0),
            reason="discard", ref_type="lot", ref_id=str(obj.id),
            note="LOT 폐기", actor_user_id=me.id,
        ))
    await session.delete(obj)


# ─────────────────────────────────────────────────────────────────────
# Alerts / dashboards

@router.get("/inventory/alerts")
async def inventory_alerts(
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("products", "read")),
):
    """어드민 메인 대시보드용 — 재고 부족 + 임박 LOT + 만료 LOT 카운트."""
    now = datetime.now(timezone.utc)
    in_3_days = now + timedelta(days=3)
    in_7_days = now + timedelta(days=7)

    low_stock = (await session.execute(
        select(func.count(Product.id))
        .where(Product.active == True, Product.stock_count <= Product.low_stock_threshold)  # noqa: E712
    )).scalar_one()

    expiring_3d = (await session.execute(
        select(func.count(StockLot.id))
        .where(StockLot.expires_at != None,  # noqa: E711
               StockLot.expires_at > now, StockLot.expires_at <= in_3_days,
               StockLot.quantity > 0)
    )).scalar_one()

    expiring_7d = (await session.execute(
        select(func.count(StockLot.id))
        .where(StockLot.expires_at != None,  # noqa: E711
               StockLot.expires_at > now, StockLot.expires_at <= in_7_days,
               StockLot.quantity > 0)
    )).scalar_one()

    expired = (await session.execute(
        select(func.count(StockLot.id))
        .where(StockLot.expires_at != None,  # noqa: E711
               StockLot.expires_at <= now, StockLot.quantity > 0)
    )).scalar_one()

    return {
        "ok": True,
        "low_stock_count": low_stock,
        "expiring_3d_count": expiring_3d,
        "expiring_7d_count": expiring_7d,
        "expired_count": expired,
    }


@router.get("/inventory/best-sellers")
async def best_sellers(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("products", "read")),
):
    """최근 N일간 발주(출고)량 기준 SKU TOP — stock_history 의 음수 delta 합."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    res = await session.execute(
        select(StockHistory.sku, func.sum(StockHistory.delta).label("delta_sum"))
        .where(StockHistory.created_at >= since,
               StockHistory.reason == "order")
        .group_by(StockHistory.sku)
    )
    rows = [{"sku": sku, "outbound_qty": int(-(delta or 0))} for sku, delta in res.all()]
    rows.sort(key=lambda r: r["outbound_qty"], reverse=True)
    return {"ok": True, "since_days": days, "items": rows[:limit]}


@router.get("/inventory/history")
async def stock_history(
    sku: str = "",
    days: int = Query(90, ge=1, le=365),
    limit: int = Query(200, ge=1, le=1000),
    session: AsyncSession = Depends(get_session),
    _u: AdminUser = Depends(require_perm("products", "read")),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    stmt = select(StockHistory).where(StockHistory.created_at >= since).order_by(desc(StockHistory.created_at))
    if sku:
        stmt = stmt.where(StockHistory.sku == sku)
    rows = (await session.execute(stmt.limit(limit))).scalars().all()
    return {"ok": True, "items": [_model_to_dict(r) for r in rows]}


# ─────────────────────────────────────────────────────────────────────
# 발주 시 재고 차감 — routes_crud.py 의 order create 에서 호출되는 헬퍼

async def reserve_stock_for_order(
    session: AsyncSession,
    *,
    items: list[dict[str, Any]],
    order_id: int | str,
    actor_user_id: int | None = None,
) -> dict[str, Any]:
    """발주 항목의 SKU/qty 를 LOT FIFO 로 차감.
    - 가용 재고 부족 시 HTTPException(400) 발생.
    - 차감 결과를 audit (stock_history) 에 기록.
    - 사용된 LOT 정보는 반환 dict 에 동봉 → caller 가 order metadata 에 저장 가능.
    """
    used_lots: list[dict[str, Any]] = []
    for item in items or []:
        sku = str(item.get("sku") or "").strip()
        qty = int(item.get("qty") or item.get("quantity") or 0)
        if not sku or qty <= 0:
            continue

        # 가용 재고 — Product.stock_count 또는 활성 LOT 합 중 작은 쪽
        prod_res = await session.execute(select(Product).where(Product.sku == sku))
        product = prod_res.scalar_one_or_none()

        lot_res = await session.execute(
            select(StockLot)
            .where(StockLot.sku == sku, StockLot.quantity > 0,
                   StockLot.quarantined == False)  # noqa: E712
            .order_by(asc(StockLot.expires_at), asc(StockLot.id))
        )
        lots = lot_res.scalars().all()
        # 만료 LOT 자동 제외 (Sweep 가 늦게 돌 수도 있어 inline 검증)
        now = datetime.now(timezone.utc)
        active_lots = [l for l in lots if not l.expires_at or as_utc(l.expires_at) > now]
        lot_total = sum(l.quantity or 0 for l in active_lots)

        # Product 가 있으면 stock_count, 없으면 LOT 합산을 가용 재고로 사용
        available = product.stock_count if product else lot_total
        if lot_total and product:
            # LOT 이 더 정확 — 둘 중 작은 쪽 사용
            available = min(available, lot_total) if lot_total > 0 else available

        if qty > available:
            raise HTTPException(
                400,
                detail=f"재고 부족 — {sku} 의 가용 재고는 {available} 개 입니다 (요청 {qty}).",
            )

        # FIFO 차감
        remaining = qty
        for lot in active_lots:
            if remaining <= 0:
                break
            take = min(lot.quantity or 0, remaining)
            if take <= 0:
                continue
            lot.quantity = (lot.quantity or 0) - take
            remaining -= take
            used_lots.append({
                "sku": sku, "lot_id": lot.id, "lot_number": lot.lot_number,
                "expires_at": lot.expires_at.isoformat() if lot.expires_at else None,
                "qty": take,
            })
            session.add(StockHistory(
                sku=sku, lot_id=lot.id, delta=-take,
                reason="order", ref_type="order", ref_id=str(order_id),
                note=f"발주 차감 (LOT {lot.lot_number})",
                actor_user_id=actor_user_id,
            ))

        # LOT 으로 충분히 못 찼으면 (Product 만 있는 경우) Product.stock_count 직접 차감
        if remaining > 0 and product:
            product.stock_count = (product.stock_count or 0) - remaining
            session.add(StockHistory(
                sku=sku, delta=-remaining,
                reason="order", ref_type="order", ref_id=str(order_id),
                note="발주 차감 (LOT 미등록)", actor_user_id=actor_user_id,
            ))
            remaining = 0

        # Product.stock_count 동기화 (LOT 차감만 한 경우에도)
        if product:
            # LOT 합으로 다시 정확히 맞춤
            new_lot_total = sum(l.quantity or 0 for l in active_lots)
            # LOT 합 + (LOT 미등록 자재) — 단순화: LOT 합을 신뢰
            if new_lot_total > 0 and product.stock_count > new_lot_total:
                # 입고 안 된 LOT 잔량 가능성 — 차감 후 음수 방지만
                pass

    return {"used_lots": used_lots}


# ─────────────────────────────────────────────────────────────────────
# 만료 LOT 자동 격리 sweep — main.py lifespan cron 에서 호출

async def sweep_expired_lots(session: AsyncSession) -> int:
    """만료 LOT 을 quarantined=true 로 마크 + audit log."""
    now = datetime.now(timezone.utc)
    res = await session.execute(
        select(StockLot)
        .where(StockLot.quarantined == False,  # noqa: E712
               StockLot.expires_at != None,  # noqa: E711
               StockLot.expires_at <= now,
               StockLot.quantity > 0)
    )
    expired = res.scalars().all()
    for lot in expired:
        lot.quarantined = True
        session.add(StockHistory(
            sku=lot.sku, lot_id=lot.id, delta=0,
            reason="quarantine", ref_type="lot", ref_id=str(lot.id),
            note="유통기한 만료 자동 격리",
        ))
    if expired:
        await session.flush()
    return len(expired)
