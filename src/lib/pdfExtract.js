// PDF 텍스트 추출 — Mozilla pdf.js 를 *CDN 동적 로드* 로 사용.
//
// 본 모듈을 import 한다고 pdf.js 가 번들에 포함되지는 않습니다.
// extractTextFromPdf() 호출 시점에 https://cdn.jsdelivr.net 에서
// 가져옵니다 (외부 API 가 아니라 정적 라이브러리 CDN).
//
// CDN 차단/실패 시: 빈 문자열 반환 + 호출자가 fallback 처리.
//
// 보안: pdf.js 는 PDF 파일을 client-side 에서만 파싱. 서버로 업로드하지
// 않으며 추출된 텍스트는 호출자가 처리. SecurityWorker 모듈 비활성화 X
// (pdf.js 기본값 — 외부 자원 fetch 안 함).

const PDFJS_VERSION = '4.10.38';
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

let _pdfjsPromise = null;

function loadPdfjs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = (async () => {
    // dynamic ESM import from CDN — Vite 가 번들에 포함하지 않도록 변수
    // 경로로 지정.
    /* @vite-ignore */
    const lib = await import(/* @vite-ignore */ PDFJS_CDN);
    if (lib?.GlobalWorkerOptions) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    }
    return lib;
  })();
  return _pdfjsPromise;
}

// File → 페이지별 텍스트 → '\n\n' 으로 join.
//
// 옵션:
//   maxPages — 추출할 최대 페이지 수 (기본 50). 대용량 PDF 방어.
//   onProgress(current, total) — 진행률 콜백.
export async function extractTextFromPdf(file, options = {}) {
  const maxPages = options.maxPages || 50;
  const onProgress = options.onProgress || (() => {});

  if (!file || !(file instanceof Blob)) {
    throw new Error('PDF 파일이 아닙니다.');
  }

  const arrayBuffer = await file.arrayBuffer();
  const pdfjs = await loadPdfjs();
  if (!pdfjs?.getDocument) {
    throw new Error('pdf.js 라이브러리를 불러오지 못했습니다.');
  }

  const loadingTask = pdfjs.getDocument({
    data: arrayBuffer,
    // 외부 폰트·이미지 fetch 차단 — text-only 추출이므로 불필요.
    disableFontFace: true,
    isEvalSupported: false,
  });
  const pdf = await loadingTask.promise;

  const total = Math.min(pdf.numPages, maxPages);
  const pages = [];

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // pdf.js 는 줄바꿈 정보를 잃기 쉬워, item.transform[5](y) 변화로 줄 분리.
    let lastY = null;
    let lineBuffer = '';
    const lines = [];
    for (const item of content.items) {
      if (!item || !item.str) continue;
      const y = item.transform ? item.transform[5] : 0;
      if (lastY !== null && Math.abs(y - lastY) > 1) {
        lines.push(lineBuffer.trim());
        lineBuffer = '';
      }
      lineBuffer += item.str;
      // hasEOL 이 true 면 줄 끝.
      if (item.hasEOL) {
        lines.push(lineBuffer.trim());
        lineBuffer = '';
      }
      lastY = y;
    }
    if (lineBuffer.trim()) lines.push(lineBuffer.trim());
    pages.push(lines.join('\n'));
    onProgress(i, total);
  }

  // 페이지 사이는 빈 줄 2개로 구분.
  return pages.join('\n\n');
}

// File → data URL ('data:application/pdf;base64,...').
// 추출 실패 시 PDF 자체를 첨부하기 위해.
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('파일이 없습니다.')); return; }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}
