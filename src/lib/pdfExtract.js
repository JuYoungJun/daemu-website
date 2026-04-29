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
    const content = await page.getTextContent({
      // pdf.js 가 가까이 있는 텍스트 item 들을 자동으로 합쳐줌.
      // 한 줄 안에서 여러 item 으로 분리된 글자가 자연스럽게 이어짐.
      includeMarkedContent: false,
      disableCombineTextItems: false,
    });

    // 1) 모든 item 의 (x, y, str, width, hasEOL) 수집.
    const items = [];
    for (const item of content.items) {
      if (!item || typeof item.str !== 'string') continue;
      const tr = item.transform || [1, 0, 0, 1, 0, 0];
      items.push({
        x: tr[4],
        y: tr[5],
        w: item.width || 0,
        str: item.str,
        hasEOL: !!item.hasEOL,
      });
    }
    if (!items.length) {
      pages.push('');
      onProgress(i, total);
      continue;
    }

    // 2) y 좌표로 라인 그루핑. PDF 좌표는 좌하단 원점이므로 y 가 큰 것이
    //    위쪽. 같은 라인으로 보는 임계값은 폰트 height 의 0.5 수준 (≈4px).
    //    너무 빡빡하면 같은 라인이 여러 줄로 쪼개지고, 너무 느슨하면 다른
    //    라인이 합쳐지므로 4px 가 한국어 본문 PDF 에 잘 맞음.
    const Y_TOLERANCE = 4;
    const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));
    const linesByY = [];
    let curLine = null;
    for (const it of sorted) {
      if (!curLine || Math.abs(curLine.y - it.y) > Y_TOLERANCE) {
        curLine = { y: it.y, items: [it] };
        linesByY.push(curLine);
      } else {
        curLine.items.push(it);
        // 라인 y 를 평균쪽으로 미세 조정 — 다음 비교가 더 안정적.
        curLine.y = (curLine.y + it.y) / 2;
      }
    }

    // 3) 각 라인 안에서 x 정렬 + 인접한 item 사이에 공백 보정.
    //    이전 item 의 (x + w) 와 다음 item 의 x 사이 갭이 폰트 width 의
    //    1/3 이상이면 단어 경계로 보고 공백 1개 삽입.
    const lines = [];
    for (const line of linesByY) {
      const sortedItems = line.items.sort((a, b) => a.x - b.x);
      let buf = '';
      let lastEnd = null;
      for (const it of sortedItems) {
        const itStr = it.str;
        if (!itStr) continue;
        if (lastEnd !== null) {
          const gap = it.x - lastEnd;
          // 한국어/한자는 글자폭이 평균 width 와 비슷하므로 절반(0.5w)
          // 이상이면 공백. 영문 본문은 글자폭이 좁아 0.3w 도 OK.
          const charW = (it.w || 0) / Math.max(1, itStr.length);
          if (gap > charW * 0.4 && !/\s$/.test(buf) && !/^\s/.test(itStr)) {
            buf += ' ';
          }
        }
        buf += itStr;
        lastEnd = it.x + (it.w || 0);
      }
      const trimmed = buf.replace(/\s+/g, ' ').trim();
      if (trimmed) lines.push(trimmed);
    }

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
