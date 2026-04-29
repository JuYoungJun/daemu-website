import ErrorPage from '../../components/ErrorPage.jsx';
import { OvenSmoking } from '../../components/errorIllustrations.jsx';

export default function ServerError({ resetError, errorMessage, componentStack }) {
  // stale chunk 의심 — 메시지에 chunk/dynamic-import 흔적이 있으면 cache-bust
  // 쿼리 부착 후 hard reload 안내. 일반 에러면 단순 reload.
  const isChunkFail = /chunk|Failed to fetch dynamically|Loading.*chunk|Importing a module script failed/i.test(errorMessage || '');
  const hardReload = () => {
    try {
      // 모든 chunk-reload marker 초기화 — 사용자가 명시적으로 다시 시도하므로
      // 자동 reload 가드를 풀어준다.
      sessionStorage.removeItem('daemu_chunk_reload_ts');
      sessionStorage.removeItem('daemu_chunk_reload_count');
    } catch { /* ignore */ }
    try {
      const cur = window.location.href.replace(/[?&]_cb=\d+/g, '');
      const sep = cur.includes('?') ? '&' : '?';
      window.location.href = cur + sep + '_cb=' + Date.now();
    } catch { /* ignore */ }
  };
  const tryAgain = (
    <button type="button" className="err-btn" onClick={() => {
      if (typeof resetError === 'function') resetError();
      hardReload();
    }}>
      {isChunkFail ? '강제 새로고침 (캐시 무시)' : '다시 시도'}
    </button>
  );
  // 운영자 진단용 details — 평소엔 접혀있다 details 클릭 시 펼쳐짐.
  // window.__daemu_lastError 도 동시에 보관되므로 DevTools 콘솔에서도
  // 같은 정보 접근 가능.
  const debugDetails = (errorMessage || componentStack) ? (
    <details style={{ marginTop: 24, fontSize: 12, color: '#6f6b68', textAlign: 'left' }}>
      <summary style={{ cursor: 'pointer', userSelect: 'none' }}>운영자 진단 정보 (개발자 도구 콘솔에서도 확인 가능)</summary>
      <pre style={{
        marginTop: 8, padding: '10px 14px', background: '#f6f4f0',
        border: '1px solid #e6e3dd', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        fontSize: 11, color: '#2a2724', lineHeight: 1.6, maxHeight: 240, overflowY: 'auto',
      }}>
{errorMessage ? `Error: ${errorMessage}\n` : ''}{componentStack || ''}
      </pre>
      <p style={{ fontSize: 11, color: '#8c867d' }}>
        이 메시지를 복사해 daemu_office@naver.com 으로 보내시면 빠르게 원인을 찾는 데 도움이 됩니다.
      </p>
    </details>
  ) : null;
  return (
    <ErrorPage
      code="500"
      title="주방에 잠시 문제가 생겼어요"
      message="오븐이 잠깐 멈춘 것 같아요. 잠시 후 다시 시도해 주세요. 같은 문제가 계속되면 daemu_office@naver.com 으로 알려주세요."
      illustration={<OvenSmoking />}
      primaryAction={tryAgain}
      meta="Internal Error · 500"
      extra={debugDetails}
    />
  );
}
