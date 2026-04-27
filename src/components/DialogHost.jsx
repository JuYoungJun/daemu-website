import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Replaces window.alert / window.confirm with site-styled modals.
// - alert(msg) → fire-and-forget, queued, OK button closes.
// - confirm(msg) → returns a Promise<boolean> (async). For inline admin scripts
//   that call sync confirm(), we keep a synchronous fallback to native.
//   The siteConfirm helper exposes the async version for new code.
export default function DialogHost() {
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);

    // Async alert (custom modal)
    window.alert = (msg) => {
      setQueue((q) => [...q, { type: 'alert', msg: String(msg ?? ''), id: rand() }]);
    };

    // confirm() must remain synchronous for legacy admin inline scripts
    // that use `if (confirm(...))`. So override is kept as native confirm.
    // Code wanting async UX should use window.siteConfirm.
    window.confirm = (msg) => nativeConfirm(String(msg ?? ''));

    window.siteAlert = window.alert;
    window.siteConfirm = (msg) => new Promise((resolve) => {
      setQueue((q) => [...q, { type: 'confirm', msg: String(msg ?? ''), id: rand(), resolve }]);
    });
    window.siteToast = (msg, opts = {}) => {
      const id = rand();
      setQueue((q) => [...q, { type: 'toast', msg: String(msg ?? ''), id, tone: opts.tone || 'default' }]);
      setTimeout(() => setQueue((q) => q.filter((x) => x.id !== id)), opts.duration || 2600);
    };

    return () => {
      window.alert = nativeAlert;
      window.confirm = nativeConfirm;
      delete window.siteAlert;
      delete window.siteConfirm;
      delete window.siteToast;
    };
  }, []);

  const close = (id, value) => {
    setQueue((q) => {
      const item = q.find((x) => x.id === id);
      if (item && item.resolve) item.resolve(value);
      return q.filter((x) => x.id !== id);
    });
  };

  if (!queue.length) return null;

  const modals = queue.filter((x) => x.type !== 'toast');
  const toasts = queue.filter((x) => x.type === 'toast');
  const top = modals[0];

  return createPortal(
    <>
      {top && (
        <div className="site-dialog-overlay" onClick={() => top.type === 'alert' && close(top.id)}>
          <div className="site-dialog-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <p className="site-dialog-msg">{top.msg}</p>
            <div className="site-dialog-actions">
              {top.type === 'confirm' && (
                <button type="button" className="site-dialog-btn site-dialog-btn--ghost" onClick={() => close(top.id, false)}>취소</button>
              )}
              <button type="button" className="site-dialog-btn" onClick={() => close(top.id, top.type === 'confirm' ? true : undefined)} autoFocus>
                확인
              </button>
            </div>
          </div>
        </div>
      )}
      {!!toasts.length && (
        <div className="site-toast-stack">
          {toasts.map((t) => (
            <div key={t.id} className={'site-toast site-toast--' + t.tone}>
              {t.msg}
            </div>
          ))}
        </div>
      )}
    </>,
    document.body
  );
}

function rand() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
