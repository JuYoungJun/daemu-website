// PDF rasterize — 백엔드 PyMuPDF 호출 클라이언트 헬퍼.
//
// 흐름:
//   1) 사용자가 어드민에서 PDF 파일 선택
//   2) FormData 로 백엔드 /api/pdf/rasterize 에 POST
//   3) 응답: { page_count, dpi, pages: [{ index, width, height, dataUrl }] }
//   4) 어드민 모달이 페이지별 dataUrl 을 <img> 로 표시 → 원본 그대로 보존
//      되며 e-Sign 영역만 그 위에 오버레이 가능.
//
// pdfExtract.js 의 텍스트 추출과 상호 보완 — rasterize 는 시각 보존,
// extractText 는 변수 매칭/검색용.

const ADMIN_TOKEN_STORAGE_KEY = 'daemu_admin_token';

export async function rasterizePdf(file) {
  const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  if (!base) {
    throw new Error('백엔드 미연결 — VITE_API_BASE_URL 환경변수를 확인해 주세요.');
  }
  const fd = new FormData();
  fd.append('file', file, file.name || 'upload.pdf');

  const headers = {};
  try {
    const t = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
    if (t) headers['Authorization'] = 'Bearer ' + t;
  } catch { /* ignore */ }

  const res = await fetch(base + '/api/pdf/rasterize', {
    method: 'POST',
    body: fd,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try { const j = JSON.parse(text); detail = j.detail || j.error || text; } catch { /* not JSON */ }
    throw new Error(`PDF 변환 실패 (HTTP ${res.status}): ${detail}`);
  }
  return await res.json();
}
