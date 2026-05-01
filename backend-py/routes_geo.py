"""GeoIP proxy — IP 주소로 국가/도시/ISP 조회.

외부 무료 API(ipapi.co) 를 호출해 결과를 캐싱(1시간)해서 반환한다.
운영자 인증 토큰 필요(어드민 analytics 페이지 전용).

캐싱 이유:
    · ipapi.co 무료 한도: 1,000 req/day. 같은 IP 로 분 단위 새로고침되면
      금방 소진된다.
    · TTL 1시간 — 같은 IP 의 위치는 그 사이에 거의 변하지 않음.
    · 메모리 캐시(LRU 1024) — 단일 backend instance 가정. 재시작 시 휘발이지만
      ipapi.co 한도(1000/day) 보호엔 충분.
    · DB 컬럼이 아님: GeoIP 값이 변할 때 재조회되어야 하므로.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
from collections import OrderedDict

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_perm

router = APIRouter(prefix="/api/analytics", tags=["analytics"])

CACHE_TTL_SEC = 3600
CACHE_MAX = 1024
_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()
_cache_lock = asyncio.Lock()

GEO_API_URL = os.environ.get("GEO_API_URL", "https://ipapi.co/{ip}/json/")
# 사설/예약 대역 — 외부 API 호출하지 않고 즉시 'private' 반환.
PRIVATE_PREFIXES = (
    "10.", "127.", "169.254.", "192.168.",
    "172.16.", "172.17.", "172.18.", "172.19.",
    "172.20.", "172.21.", "172.22.", "172.23.",
    "172.24.", "172.25.", "172.26.", "172.27.",
    "172.28.", "172.29.", "172.30.", "172.31.",
    "::1", "fc", "fd", "fe80",
)
IP_RE = re.compile(r"^[0-9a-fA-F:.]{2,45}$")


def _is_private(ip: str) -> bool:
    return any(ip.startswith(p) for p in PRIVATE_PREFIXES)


async def _lookup(ip: str) -> dict:
    now = time.time()
    async with _cache_lock:
        hit = _cache.get(ip)
        if hit and now - hit[0] < CACHE_TTL_SEC:
            _cache.move_to_end(ip)
            return hit[1]

    if _is_private(ip):
        result = {"ip": ip, "country": "—", "city": "(사설)", "isp": "—", "private": True}
    else:
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                r = await client.get(GEO_API_URL.format(ip=ip))
                if r.status_code != 200:
                    result = {"ip": ip, "error": f"HTTP {r.status_code}"}
                else:
                    j = r.json()
                    result = {
                        "ip": ip,
                        "country": j.get("country_name") or j.get("country") or "—",
                        "country_code": j.get("country_code") or j.get("country") or "",
                        "region": j.get("region") or "",
                        "city": j.get("city") or "",
                        "isp": j.get("org") or j.get("isp") or "",
                        "asn": j.get("asn") or "",
                        "lat": j.get("latitude"),
                        "lon": j.get("longitude"),
                        "tz": j.get("timezone") or "",
                    }
        except Exception as e:  # noqa: BLE001
            result = {"ip": ip, "error": str(e)[:120]}

    async with _cache_lock:
        _cache[ip] = (now, result)
        _cache.move_to_end(ip)
        while len(_cache) > CACHE_MAX:
            _cache.popitem(last=False)
    return result


@router.get("/geo")
async def geo_lookup(
    ip: str = Query(..., min_length=2, max_length=45),
    _: object = Depends(require_perm("analytics", action="read")),
):
    if not IP_RE.match(ip):
        raise HTTPException(status_code=400, detail="invalid ip")
    return await _lookup(ip)


@router.post("/geo/batch")
async def geo_batch(
    payload: dict,
    _: object = Depends(require_perm("analytics", action="read")),
):
    """여러 IP 한 번에 조회 — 캐시 hit 우선, miss 만 외부 호출. 최대 50건."""
    ips = payload.get("ips") or []
    if not isinstance(ips, list) or not ips:
        raise HTTPException(status_code=400, detail="ips required")
    if len(ips) > 50:
        raise HTTPException(status_code=400, detail="max 50 ips per batch")
    valid = [i for i in ips if isinstance(i, str) and IP_RE.match(i)]
    results = await asyncio.gather(*[_lookup(i) for i in valid])
    return {"results": {r["ip"]: r for r in results}}
