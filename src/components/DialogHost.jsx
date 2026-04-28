import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Replaces window.alert / confirm / prompt with site-styled modals.
//
// 동작 요약:
//   alert(msg)              — fire-and-forget. window.alert 자동 override.
//   window.siteAlert(msg)   — 동일.
//   window.siteConfirm(msg) — Promise<boolean>. 새 코드는 await 로 사용.
//   window.sitePrompt(msg,
//                     def,
//                     opts) — Promise<string|null>. 취소 시 null.
//   window.siteToast(msg)   — 우하단 자동 사라짐.
//
// window.confirm 자체는 레거시 raw script(public/admin-*-page.js) 호환을
// 위해 *native* 그대로 둡니다. React 측 새 코드는 siteConfirm 사용을 권장.
export default function DialogHost() {
  const [queue, setQueue] = useState([]);

  useEffect(() => {
    const nativeAlert = window.alert.bind(window);
    const nativeConfirm = window.confirm.bind(window);
    const nativePrompt = window.prompt ? window.prompt.bind(window) : null;

    window.alert = (msg) => {
      setQueue((q) => [...q, { type: 'alert', msg: String(msg ?? ''), id: rand() }]);
    };

    window.confirm = (msg) => nativeConfirm(String(msg ?? ''));

    window.siteAlert = window.alert;
    window.siteConfirm = (msg) => new Promise((resolve) => {
      setQueue((q) => [...q, { type: 'confirm', msg: String(msg ?? ''), id: rand(), resolve }]);
    });

    window.sitePrompt = (msg, defaultValue = '', opts = {}) => new Promise((resolve) => {
      setQueue((q) => [...q, {
        type: 'prompt',
        msg: String(msg ?? ''),
        defaultValue: String(defaultValue ?? ''),
        placeholder: opts.placeholder ? String(opts.placeholder) : '',
        inputType: opts.inputType || 'text',
        required: !!opts.required,
        id: rand(),
        resolve,
      }]);
    });

    window.siteToast = (msg, opts = {}) => {
      const id = rand();
      setQueue((q) => [...q, { type: 'toast', msg: String(msg ?? ''), id, tone: opts.tone || 'default' }]);
      setTimeout(() => setQueue((q) => q.filter((x) => x.id !== id)), opts.duration || 2600);
    };

    return () => {
      window.alert = nativeAlert;
      window.confirm = nativeConfirm;
      if (nativePrompt) window.prompt = nativePrompt;
      delete window.siteAlert;
      delete window.siteConfirm;
      delete window.sitePrompt;
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
        <div className="site-dialog-overlay"
          onClick={() => top.type === 'alert' && close(top.id)}>
          <div className="site-dialog-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            {top.type === 'prompt'
              ? <PromptBody item={top} onSubmit={(v) => close(top.id, v)} onCancel={() => close(top.id, null)} />
              : (
                <>
                  <p className="site-dialog-msg">{top.msg}</p>
                  <div className="site-dialog-actions">
                    {top.type === 'confirm' && (
                      <button type="button" className="site-dialog-btn site-dialog-btn--ghost" onClick={() => close(top.id, false)}>취소</button>
                    )}
                    <button type="button" className="site-dialog-btn"
                      onClick={() => close(top.id, top.type === 'confirm' ? true : undefined)} autoFocus>
                      확인
                    </button>
                  </div>
                </>
              )}
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

function PromptBody({ item, onSubmit, onCancel }) {
  const [value, setValue] = useState(item.defaultValue || '');
  const inputRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => {
      try { inputRef.current?.focus(); inputRef.current?.select(); } catch { /* ignore */ }
    }, 30);
    return () => clearTimeout(t);
  }, []);
  const submit = (e) => {
    e?.preventDefault?.();
    if (item.required && !value.trim()) return;
    onSubmit(value);
  };
  return (
    <form onSubmit={submit}>
      <p className="site-dialog-msg">{item.msg}</p>
      <input
        ref={inputRef}
        type={item.inputType}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={item.placeholder || ''}
        required={item.required}
        className="site-dialog-input"
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      />
      <div className="site-dialog-actions">
        <button type="button" className="site-dialog-btn site-dialog-btn--ghost" onClick={onCancel}>취소</button>
        <button type="submit" className="site-dialog-btn">확인</button>
      </div>
    </form>
  );
}

function rand() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
