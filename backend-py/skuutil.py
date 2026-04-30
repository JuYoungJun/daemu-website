"""SKU 표준 (DAEMU-CAT-NNNN-LL) 헬퍼.

형식:
    DAEMU-CAT-NNNN-LL
    │     │   │    │
    │     │   │    └─ 옵션 코드 (사이즈/맛/색깔, 없으면 "00")
    │     │   └────── 카테고리 내 일련번호 (4자리, 0001~)
    │     └────────── 카테고리 (3자리, BAK/CAF/EQP/PCK/MSC)
    └──────────────── 회사 prefix

예: DAEMU-BAK-0042-S1 (베이커리 42번 상품, 옵션 S1)

운영자가 카테고리 + 옵션을 지정하면 backend 가 일련번호를 자동 할당.
이 모듈은 sync helper 만 노출 — DB 호출은 호출처가 비동기 SQLAlchemy 로 처리.
"""

from __future__ import annotations

import re

# 카테고리 정의. 한국어 표시명 + 영문 alias 매핑.
CATEGORIES: dict[str, dict[str, str]] = {
    "BAK": {"label": "베이커리", "aliases": "베이커리,bakery,bread"},
    "CAF": {"label": "카페", "aliases": "카페,cafe,coffee,beverage,음료,커피"},
    "EQP": {"label": "설비/장비", "aliases": "설비,장비,equipment,equip"},
    "PCK": {"label": "패키징", "aliases": "패키징,포장,package,packaging"},
    "MSC": {"label": "기타", "aliases": "기타,misc,other"},
}

CATEGORY_CODES: tuple[str, ...] = tuple(CATEGORIES.keys())

# DAEMU-CAT-NNNN-LL 정확 매칭. 옵션 LL 은 영숫자 2자리.
SKU_RE = re.compile(r"^DAEMU-(BAK|CAF|EQP|PCK|MSC)-(\d{4})-([A-Za-z0-9]{2})$")


def is_valid_sku(value: str) -> bool:
    """엄격한 SKU 형식 검증."""
    return bool(SKU_RE.match(str(value or "")))


def parse_sku(value: str) -> dict[str, str] | None:
    """SKU 분해 — 잘못된 형식이면 None."""
    m = SKU_RE.match(str(value or ""))
    if not m:
        return None
    return {"category": m.group(1), "seq": m.group(2), "option": m.group(3)}


def category_from_label(label: str) -> str:
    """한국어 카테고리명 → 3자리 코드. 매칭 실패 시 'MSC'."""
    if not label:
        return "MSC"
    raw = str(label).strip().lower()
    # 직접 코드 입력이면 그대로
    upper = raw.upper()
    if upper in CATEGORIES:
        return upper
    for code, meta in CATEGORIES.items():
        aliases = meta.get("aliases", "").lower().split(",")
        if raw in [a.strip() for a in aliases]:
            return code
    return "MSC"


def build_sku(category_code: str, seq: int, option_code: str = "00") -> str:
    """DAEMU-CAT-NNNN-LL 조립."""
    cat = (category_code or "MSC").upper()
    if cat not in CATEGORIES:
        cat = "MSC"
    opt = (option_code or "00")[:2].upper()
    if not re.match(r"^[A-Z0-9]{1,2}$", opt):
        opt = "00"
    if len(opt) == 1:
        opt = opt + "0"
    return f"DAEMU-{cat}-{int(seq):04d}-{opt}"


def next_seq_for_category(existing_skus: list[str], category_code: str) -> int:
    """같은 카테고리의 마지막 일련번호 + 1. 비어있으면 1."""
    cat = (category_code or "MSC").upper()
    max_seq = 0
    for sku in existing_skus or []:
        m = SKU_RE.match(str(sku or ""))
        if not m:
            continue
        if m.group(1) != cat:
            continue
        try:
            n = int(m.group(2))
            if n > max_seq:
                max_seq = n
        except ValueError:
            continue
    return max_seq + 1
