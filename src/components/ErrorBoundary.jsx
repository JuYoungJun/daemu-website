import { Component } from 'react';
import ServerError from '../pages/errors/ServerError.jsx';

// sessionStorage marker — App.jsx 의 lazyWithReload 와 동일 키. KEY 라는 짧은
// 변수명은 Snyk CWE-547 가 hardcoded secret 으로 오인하므로 _STORAGE_KEY 접미.
const CHUNK_RELOAD_STORAGE_KEY = 'daemu_chunk_reload_ts';
const CHUNK_RELOAD_COUNT_STORAGE_KEY = 'daemu_chunk_reload_count';

export default class ErrorBoundary extends Component {
  state = { error: null, info: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 디버깅을 위해 stack 도 함께 보존 — ServerError 화면에서 details 토글.
    this.setState({ info });
    if (typeof window !== 'undefined') {
      console.error('[ErrorBoundary]', error, info?.componentStack);
      try {
        window.__daemu_lastError = {
          message: String(error?.message || error),
          stack: String(error?.stack || ''),
          componentStack: String(info?.componentStack || ''),
          ts: new Date().toISOString(),
        };
      } catch { /* ignore */ }

      // Stale chunk 감지 — 새 빌드 deploy 후 옛 chunk URL 이 404 가 나
      // dynamic import 가 실패한 케이스. App.jsx 의 lazyWithReload 와 같은
      // count 마커를 공유 — count==0 이면 단순 reload, count>=1 은 cache-bust
      // 쿼리 부착으로 옛 index.html 캐시까지 우회. count>=3 도달 시 더 이상
      // 자동 reload 안 하고 ServerError 화면이 그대로 표시 (수동 버튼 사용).
      const msg = String(error?.message || '');
      // chunk 로드 실패 + stale-bundle ReferenceError (변수 삭제 회귀) 도 매칭.
      // 두 번째 패턴은 deploy 직후 사용자가 옛 main bundle 을 잡고 있을 때
      // 발생 — index.html 의 새 hash 가 캐시 우회되면 해소되므로 같은 복구 OK.
      const isStaleChunk = /chunk|Failed to fetch dynamically|Loading.*chunk|Importing a module script failed/i.test(msg);
      const isStaleRef = /ReferenceError|is not defined|Cannot read propert(?:y|ies) of undefined/i.test(msg);
      if (isStaleChunk || isStaleRef) {
        try {
          const last = Number(sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) || 0);
          const count = Number(sessionStorage.getItem(CHUNK_RELOAD_COUNT_STORAGE_KEY) || 0);
          const sinceLast = Date.now() - last;
          if (count < 3 && (last === 0 || sinceLast > 60_000)) {
            sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(Date.now()));
            sessionStorage.setItem(CHUNK_RELOAD_COUNT_STORAGE_KEY, String(count + 1));
            if (count === 0) {
              window.location.reload();
            } else {
              const cur = window.location.href.replace(/[?&]_cb=\d+/g, '');
              const sep = cur.includes('?') ? '&' : '?';
              window.location.href = cur + sep + '_cb=' + Date.now();
            }
          }
        } catch { /* ignore */ }
      }
    }
  }

  reset = () => this.setState({ error: null, info: null });

  render() {
    if (this.state.error) {
      return <ServerError
        resetError={this.reset}
        errorMessage={String(this.state.error?.message || this.state.error || '')}
        componentStack={String(this.state.info?.componentStack || '')}
      />;
    }
    return this.props.children;
  }
}
