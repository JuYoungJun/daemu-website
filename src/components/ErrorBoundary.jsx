import { Component } from 'react';
import ServerError from '../pages/errors/ServerError.jsx';

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

      // Stale chunk 감지 — 새 빌드 deploy 후 옛 chunk URL 이 404 가 나서
      // dynamic import 가 실패한 케이스. 1분 안에 한 번만 자동 reload.
      const msg = String(error?.message || '');
      if (/chunk|Failed to fetch dynamically|Loading.*chunk|Importing a module script failed/i.test(msg)) {
        try {
          const KEY = 'daemu_chunk_reload_ts';
          const last = Number(sessionStorage.getItem(KEY) || 0);
          if (!last || Date.now() - last > 60_000) {
            sessionStorage.setItem(KEY, String(Date.now()));
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
