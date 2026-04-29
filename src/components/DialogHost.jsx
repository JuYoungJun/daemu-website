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
        <div className="site-dialog-overlay"
          onClick={() => top.type === 'alert' && close(top.id)}>
          <div className={'site-dialog-box' + (top.type === 'csv-preview' ? ' site-dialog-box--wide' : '')}
            onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
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

function CsvPreviewBody({ item, onConfirm, onCancel }) {
  const { filename, rows, columns, sampleSize } = item;
  const sample = rows.slice(0, sampleSize);
  const cellValue = (row, col) => {
    const v = typeof col.key === 'function' ? col.key(row) : row[col.key];
    if (v == null) return '';
    if (Array.isArray(v)) return v.join(' | ');
    if (typeof v === 'object') return JSON.stringify(v);
    const s = String(v);
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  };
  const totalBytes = rows.length * columns.length * 16; // 거친 추정
  const sizeLabel = totalBytes > 1024 * 1024
    ? (totalBytes / 1024 / 1024).toFixed(1) + ' MB'
    : (totalBytes / 1024).toFixed(1) + ' KB';

  return (
    <>
      <div className="csv-preview-head">
        <div>
          <p className="site-dialog-msg" style={{ marginBottom: 4 }}>CSV 다운로드 미리보기</p>
          <div style={{ fontSize: 11, color: '#8c867d', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <span><strong style={{ color: '#5a534b' }}>{filename}</strong></span>
            <span>총 <strong style={{ color: '#1f5e7c' }}>{rows.length.toLocaleString('ko')}</strong> 행</span>
            <span>{columns.length} 컬럼</span>
            <span>~{sizeLabel}</span>
          </div>
        </div>
      </div>
      <div className="csv-preview-table-wrap">
        {!rows.length ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: '#8c867d', fontSize: 13 }}>
            내보낼 데이터가 없습니다.
          </div>
        ) : (
          <table className="csv-preview-table">
            <thead>
              <tr>
                <th style={{ width: 36, color: '#8c867d', fontSize: 10 }}>#</th>
                {columns.map((c, i) => (
                  <th key={i}>{c.label || c.key}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.map((row, i) => (
                <tr key={i}>
                  <td style={{ color: '#8c867d', fontSize: 10, fontFamily: 'SF Mono, Menlo, monospace' }}>{i + 1}</td>
                  {columns.map((c, j) => (
                    <td key={j} title={String(typeof c.key === 'function' ? c.key(row) : row[c.key] ?? '')}>
                      {cellValue(row, c)}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length > sampleSize && (
                <tr>
                  <td colSpan={columns.length + 1} style={{ textAlign: 'center', fontSize: 11, color: '#8c867d', padding: 8 }}>
                    … 이하 {(rows.length - sampleSize).toLocaleString('ko')} 행 생략
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="csv-preview-note">
        Excel 호환을 위해 UTF-8 BOM 이 포함됩니다. 셀 값에 =/+/-/@ 로 시작하는 항목은
        formula injection 방지를 위해 자동으로 작은따옴표가 붙습니다.
      </div>
      <div className="site-dialog-actions">
        <button type="button" className="site-dialog-btn site-dialog-btn--ghost" onClick={onCancel}>취소</button>
        <button type="button" className="site-dialog-btn" onClick={onConfirm} disabled={!rows.length} autoFocus>
          다운로드
        </button>
      </div>
    </>
  );
}

function rand() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
