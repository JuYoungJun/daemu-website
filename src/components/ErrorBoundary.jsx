import { Component } from 'react';
import ServerError from '../pages/errors/ServerError.jsx';

export default class ErrorBoundary extends Component {
  state = { error: null, info: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 디버깅을 위해 stack 도 함께 보존 — ServerError 화면에서 details
    // 토글로 확인할 수 있게.
    this.setState({ info });
    if (typeof window !== 'undefined') {
      console.error('[ErrorBoundary]', error, info?.componentStack);
      try {
        // 추가 진단을 위해 window.__daemu_lastError 에도 보관 — DevTools
        // 콘솔에서 바로 접근 가능.
        window.__daemu_lastError = {
          message: String(error?.message || error),
          stack: String(error?.stack || ''),
          componentStack: String(info?.componentStack || ''),
          ts: new Date().toISOString(),
        };
      } catch { /* ignore */ }
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
