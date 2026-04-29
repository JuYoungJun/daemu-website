// QR 코드 생성 — qrcode-generator 라이브러리를 CDN 동적 로드.
//
// pdf.js 와 같은 패턴 — 번들에 포함하지 않고 사용 시점에만 가져옴.
// 외부 API 호출 아님 (정적 라이브러리 CDN). 모든 처리 client-side.
//
// ⚠ 보안 경고: 본 모듈은 *URL 을 그대로* QR 에 인코딩합니다.
// 위변조·재사용 방어가 필요한 케이스라면 QR_SECURITY.md 의 Stage 2
// (서버측 ShortLink + HMAC 서명) 를 도입한 뒤 그 short URL 을 입력으로
// 사용하세요. 본 함수만으로는 인쇄된 QR 위에 다른 QR 스티커가 덧붙는
// 단순 물리 공격은 막을 수 없습니다.

const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';

let _qrLibPromise = null;

function loadQrLib() {
  if (typeof window !== 'undefined' && typeof window.qrcode === 'function') {
    return Promise.resolve(window.qrcode);
  }
  if (_qrLibPromise) return _qrLibPromise;
  _qrLibPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('document 없음'));
      return;
    }
    const s = document.createElement('script');
    s.src = QR_CDN;
    s.async = true;
    s.onload = () => {
      if (typeof window.qrcode === 'function') resolve(window.qrcode);
      else reject(new Error('qrcode global 미발견'));
    };
    s.onerror = () => {
      _qrLibPromise = null; // retry 가능하도록.
      reject(new Error('QR 라이브러리 로드 실패 — CDN 차단 또는 네트워크 문제'));
    };
    document.head.appendChild(s);
  });
  return _qrLibPromise;
}

// QR SVG 문자열 생성 — UI 에서 dangerouslySetInnerHTML 대신 dataURL 로
// img.src 에 바인딩해도 안전 (svg+xml).
export async function generateQrSvg(text, opts = {}) {
  const cellSize = opts.cellSize || 6;
  const margin = opts.margin || 4;
  const errorCorrection = opts.errorCorrection || 'M'; // L / M / Q / H

  const qrcode = await loadQrLib();
  const qr = qrcode(0, errorCorrection); // type 0 = auto-detect smallest version
  qr.addData(String(text || ''));
  qr.make();
  return qr.createSvgTag({ cellSize, margin });
}

// QR PNG dataURL — canvas 로 그려 download 가능한 png 생성.
export async function generateQrPngDataUrl(text, opts = {}) {
  const size = opts.size || 320;
  const errorCorrection = opts.errorCorrection || 'M';

  const qrcode = await loadQrLib();
  const qr = qrcode(0, errorCorrection);
  qr.addData(String(text || ''));
  qr.make();

  if (typeof document === 'undefined') return '';
  const moduleCount = qr.getModuleCount();
  const cellSize = Math.max(2, Math.floor(size / (moduleCount + 8)));
  const margin = cellSize * 4;
  const canvasSize = cellSize * moduleCount + margin * 2;

  const canvas = document.createElement('canvas');
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasSize, canvasSize);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(margin + c * cellSize, margin + r * cellSize, cellSize, cellSize);
      }
    }
  }
  return canvas.toDataURL('image/png');
}
