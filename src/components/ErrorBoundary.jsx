import { Component } from 'react';
import ServerError from '../pages/errors/ServerError.jsx';

// sessionStorage marker — App.jsx 의 lazyWithReload 와 동일 키. KEY 라는 짧은
// 변수명은 Snyk CWE-547 가 hardcoded secret 으로 오인하므로 _STORAGE_KEY 접미.
const CHUNK_RELOAD_STORAGE_KEY = 'daemu_chunk_reload_ts';

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
      // dynamic import 가 실패한 케이스. 1분 안에 한 번만 자동 reload.
      const msg = String(error?.message || '');
      if (/chunk|Failed to fetch dynamically|Loading.*chunk|Importing a module script failed/i.test(msg)) {
        try {
          const last = Number(sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) || 0);
          if (!last || Date.now() - last > 60_000) {
            sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(Date.now()));
            window.location.reload();
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
