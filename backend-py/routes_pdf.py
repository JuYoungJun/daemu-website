"""PDF rasterize — PyMuPDF 로 업로드 PDF 를 페이지별 PNG 으로 변환.

목적:
    어드민이 외부에서 만든 PDF(아래아한글/Word/법무팀 양식)를 그대로 보존
    하면서 e-Sign 영역만 오버레이할 수 있게, 프론트가 받아 표시할 페이지별
    PNG dataURL 을 반환한다. 텍스트만 추출하던 기존 흐름(pdfExtract.js) 의
    한계 — 표 / 도장 이미지 / 한글 폰트 깨짐 — 를 우회.

성능/안전 가드:
    · 파일 크기: 20 MB 제한.
    · 페이지 수: 50 페이지 제한.
    · DPI: 144(고해상도). 클라이언트가 줌 가능. 더 큰 dpi 는 메모리 폭증.
    · 인증: 어드민 'contracts' resource read 권한 필요.
"""

from __future__ import annotations

import asyncio
import base64
import io
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from auth import require_perm

router = APIRouter(prefix="/api/pdf", tags=["pdf"])

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 50
DPI = 144
# PDF bomb / 비정상 파일 처리 타임아웃 — 정상 PDF 는 페이지당 100~300ms.
# 50 페이지 × 300ms ≈ 15s + 여유. 초과 시 504 반환.
RASTERIZE_TIMEOUT_SECONDS = 30


def _rasterize_sync(data: bytes) -> tuple[int, list[dict]]:
    """blocking 작업 — asyncio.to_thread 로 격리해서 timeout 가능하게."""
    import fitz  # PyMuPDF
    doc = fitz.open(stream=data, filetype="pdf")
    if doc.page_count > MAX_PAGES:
        doc.close()
        raise HTTPException(status_code=413, detail=f"페이지가 너무 많습니다 (최대 {MAX_PAGES})")
    pages: list[dict] = []
    try:
        zoom = DPI / 72
        matrix = fitz.Matrix(zoom, zoom)
        for i, page in enumerate(doc):
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            buf = io.BytesIO(pix.tobytes("png"))
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            pages.append({
                "index": i,
                "width": pix.width,
                "height": pix.height,
                "dataUrl": f"data:image/png;base64,{b64}",
            })
    finally:
        doc.close()
    return len(pages), pages


@router.post("/rasterize")
async def rasterize_pdf(
    file: UploadFile = File(...),
    _: Any = Depends(require_perm("contracts", action="read")),
):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail=f"파일이 너무 큽니다 (최대 {MAX_BYTES // 1024 // 1024} MB)")
    if not data[:5].startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="PDF 파일이 아닙니다")

    try:
        import fitz  # noqa: F401  — 사전 import 검증, 실제 사용은 _rasterize_sync.
    except ImportError:
        raise HTTPException(status_code=500, detail="PyMuPDF 미설치 — requirements 의 pymupdf 확인")

    # PDF bomb / 악성 파일 timeout 가드 — 정상 처리는 asyncio.to_thread 로 격리,
    # 30초 초과 시 timeout 504.
    try:
        page_count, pages = await asyncio.wait_for(
            asyncio.to_thread(_rasterize_sync, data),
            timeout=RASTERIZE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="PDF 변환 시간이 초과되었습니다 (30초). 더 작은 파일로 시도해 주세요.")
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"PDF 파싱 실패: {e}")

    return {
        "page_count": page_count,
        "dpi": DPI,
        "pages": pages,
    }
