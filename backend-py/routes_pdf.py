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

import base64
import io
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File

from auth import require_perm

router = APIRouter(prefix="/api/pdf", tags=["pdf"])

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 50
DPI = 144


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
        import fitz  # PyMuPDF
    except ImportError:
        raise HTTPException(status_code=500, detail="PyMuPDF 미설치 — requirements 의 pymupdf 확인")

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"PDF 파싱 실패: {e}")

    if doc.page_count > MAX_PAGES:
        doc.close()
        raise HTTPException(status_code=413, detail=f"페이지가 너무 많습니다 (최대 {MAX_PAGES})")

    pages: list[dict] = []
    try:
        zoom = DPI / 72  # PDF 표준 72dpi → 144dpi
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

    return {
        "page_count": len(pages),
        "dpi": DPI,
        "pages": pages,
    }
