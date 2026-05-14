import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';

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
  const location = useLocation();

  // 라우트 변경 시 모든 modal/toast/CSV-preview 즉시 정리.
  // 사용자가 CSV preview 가 떠 있는 상태에서 브라우저 Back 을 누르면 portal 이
  // 다음 페이지에 그대로 남는 버그 fix. pending Promise 는 cancel 의미로 resolve.
  useEffect(() => {
    setQueue((q) => {
      if (!q.length) return q;
      for (const it of q) {
        if (typeof it.resolve === 'function') {
          try {
            // 의미상 "취소" — confirm/csv-preview 는 false, prompt 는 null, alert 는 undefined.
            const cancelValue = it.type === 'prompt' ? null
              : (it.type === 'confirm' || it.type === 'csv-preview') ? false
              : undefined;
            it.resolve(cancelValue);
          } catch { /* ignore */ }
        }
      }
      return [];
    });
  }, [location.pathname, location.search, location.hash]);

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

    // CSV 다운로드 미리보기 — 상위 N행 + 컬럼 + 총 건수 + 파일명을 보여주고
    // 사용자 동의 후에만 실제 다운로드. resolve(true) → 다운로드, false → 취소.
    window.siteCsvPreview = ({ filename, rows, columns, sampleSize }) => new Promise((resolve) => {
      setQueue((q) => [...q, {
        type: 'csv-preview',
        id: rand(),
        filename: String(filename ?? 'download.csv'),
        rows: Array.isArray(rows) ? rows : [],
        columns: Array.isArray(columns) ? columns : [],
        sampleSize: typeof sampleSize === 'number' && sampleSize > 0 ? sampleSize : 10,
        resolve,
      }]);
    });

    return () => {
      window.alert = nativeAlert;
      window.confirm = nativeConfirm;
      if (nativePrompt) window.prompt = nativePrompt;
      delete window.siteAlert;
      delete window.siteConfirm;
      delete window.sitePrompt;
      delete window.siteToast;
      delete window.siteCsvPreview;
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
        <ModalShell
          item={top}
          onBackdrop={() => top.type === 'alert' && close(top.id)}
          onEscape={() => {
            // ESC: alert 은 확인, confirm/csv-preview 는 취소, prompt 는 null.
            if (top.type === 'alert') close(top.id);
            else if (top.type === 'confirm' || top.type === 'csv-preview') close(top.id, false);
            else if (top.type === 'prompt') close(top.id, null);
          }}
        >
            {top.type === 'prompt'
              ? <PromptBody item={top} onSubmit={(v) => close(top.id, v)} onCancel={() => close(top.id, null)} />
              : top.type === 'csv-preview'
                ? <CsvPreviewBody item={top} onConfirm={() => close(top.id, true)} onCancel={() => close(top.id, false)} />
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
        </ModalShell>
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

function CsvPreviewBody({ item, onConfirm, onCancel }) {
  const { filename, rows, columns, sampleSize } = item;
  const sample = rows.slice(0, sampleSize);
  const cellValue = (row, col) => {
    const v = typeof col.key === 'function' ? col.key(row) : row[col.key];
    if (v == null || v === '') return '—';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') return JSON.stringify(v);
    const s = String(v);
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  };
  // 추정 크기 — UTF-8 평균 문자 길이 + 컬럼 구분자.
  const approxBytes = rows.length * (columns.length * 16 + 4) + 80;
  const sizeLabel = approxBytes > 1024 * 1024
    ? (approxBytes / 1024 / 1024).toFixed(1) + ' MB'
    : Math.max(1, Math.round(approxBytes / 1024)) + ' KB';

  return (
    <div className="csv-preview">
      <div className="csv-preview__head">
        <div className="csv-preview__title">
          <span className="csv-preview__eyebrow">CSV 다운로드 미리보기</span>
          <code className="csv-preview__filename">{filename}</code>
        </div>
        <div className="csv-preview__meta">
          <span><strong>{rows.length.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</strong> 행</span>
          <span className="csv-preview__sep">·</span>
          <span><strong>{columns.length}</strong> 컬럼</span>
          <span className="csv-preview__sep">·</span>
          <span>약 <strong>{sizeLabel}</strong></span>
        </div>
      </div>

      {!rows.length ? (
        <div className="csv-preview__empty">
          <strong>내보낼 데이터가 없습니다</strong>
          <span>현재 필터 조건에 맞는 행이 0건입니다. 필터를 조정한 뒤 다시 시도해 주세요.</span>
        </div>
      ) : (
        <>
          <div className="csv-preview__sample-label">
            <span>상위 {Math.min(sampleSize, rows.length)}행 미리보기</span>
            {rows.length > sampleSize && (
              <span className="csv-preview__sample-rest">
                + {(rows.length - sampleSize).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}행 추가 (CSV 에 모두 포함)
              </span>
            )}
          </div>
          <div className="csv-preview__table-wrap">
            <table className="csv-preview__table">
              <thead>
                <tr>
                  <th className="csv-preview__num-col">#</th>
                  {columns.map((c, i) => (
                    <th key={i}>{c.label || c.key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sample.map((row, i) => (
                  <tr key={i}>
                    <td className="csv-preview__num-col">{i + 1}</td>
                    {columns.map((c, j) => {
                      const raw = typeof c.key === 'function' ? c.key(row) : row[c.key];
                      const display = cellValue(row, c);
                      return (
                        <td key={j} title={raw == null ? '' : String(raw)}>{display}</td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="csv-preview__note">
        Excel 호환을 위해 UTF-8 BOM 이 포함됩니다. =/+/-/@ 로 시작하는 셀은
        formula injection 방지를 위해 자동으로 작은따옴표가 붙습니다.
      </p>

      <div className="site-dialog-actions csv-preview__actions">
        <button type="button" className="site-dialog-btn site-dialog-btn--ghost" onClick={onCancel}>
          취소
        </button>
        <button type="button" className="site-dialog-btn" onClick={onConfirm}
          disabled={!rows.length} autoFocus>
          {rows.length ? `다운로드 (${rows.length.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}행)` : '다운로드'}
        </button>
      </div>
    </div>
  );
}

function rand() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

// ModalShell — focus trap + ESC + backdrop + body scroll lock.
// 모달이 열리는 동안 Tab/Shift+Tab 이 dialog 안에서만 순환하고, ESC 로 닫고,
// 마운트 시 첫 focusable 에 focus, 닫힐 때 직전 focus 로 복귀.
function ModalShell({ item, onBackdrop, onEscape, children }) {
  const overlayRef = useRef(null);
  const boxRef = useRef(null);
  const lastFocusRef = useRef(null);

  useEffect(() => {
    lastFocusRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 초기 focus — 첫 focusable 요소 (autoFocus 가 이미 동작 중이면 그대로).
    const raf = requestAnimationFrame(() => {
      if (!boxRef.current) return;
      if (boxRef.current.contains(document.activeElement)) return;
      const first = boxRef.current.querySelector(
        'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
      );
      try { first?.focus(); } catch { /* ignore */ }
    });

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onEscape?.();
        return;
      }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const focusables = Array.from(boxRef.current.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !boxRef.current.contains(active)) {
          e.preventDefault();
          try { last.focus(); } catch { /* ignore */ }
        }
      } else {
        if (active === last) {
          e.preventDefault();
          try { first.focus(); } catch { /* ignore */ }
        }
      }
    };
    document.addEventListener('keydown', onKey, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      try {
        if (lastFocusRef.current && typeof lastFocusRef.current.focus === 'function') {
          lastFocusRef.current.focus();
        }
      } catch { /* ignore */ }
    };
    // item.id 가 바뀌면 새 모달 → effect 재실행.
  }, [item.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="site-dialog-overlay" ref={overlayRef} onClick={onBackdrop}>
      <div
        ref={boxRef}
        className={'site-dialog-box' + (item.type === 'csv-preview' ? ' site-dialog-box--wide' : '')}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
