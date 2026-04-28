// 공통 미디어 라이브러리 picker.
//
// 사용법:
//   1) React에서:
//        import { openMediaPicker } from '../components/MediaPicker.jsx';
//        const url = await openMediaPicker({ kind: 'image' });
//   2) Raw admin script(public/admin-*.js)에서:
//        window.openMediaPicker({ kind: 'image' }).then(url => ...)
//
// 반환값: 선택된 자산의 url(string) 또는 cancel 시 null
// 옵션:
//   kind: 'image' | 'video' | 'all' (기본 'all')
//   allowUpload: boolean (기본 true) — 새 자산 업로드 후 즉시 선택
//
// React 트리에 mount하지 않고 호출되는 경우(window.openMediaPicker)에도
// 동작하도록, dialog는 document.body에 포털 형태로 직접 mount/unmount.

import ReactDOM from 'react-dom/client';
import { useState, useEffect, useMemo } from 'react';
import { DB } from '../lib/db.js';
import { safeUrl } from '../lib/safe.js';

const STORAGE_KEY = 'media';

let _activeRoot = null;
let _activeNode = null;

export function openMediaPicker(options = {}) {
  return new Promise((resolve) => {
    if (_activeRoot) {
      // 이미 열려 있는 picker가 있으면 닫고 새로 연다.
      try { _activeRoot.unmount(); } catch (e) { /* ignore */ }
      _activeNode?.remove();
      _activeRoot = null; _activeNode = null;
    }
    const node = document.createElement('div');
    node.id = 'daemu-media-picker-root';
    document.body.appendChild(node);
    const root = ReactDOM.createRoot(node);
    _activeRoot = root;
    _activeNode = node;

    const handleSelect = (url) => {
      try { root.unmount(); } catch (e) { /* ignore */ }
      node.remove();
      _activeRoot = null; _activeNode = null;
      resolve(url);
    };

    root.render(
      <MediaPickerDialog
        options={options}
        onSelect={(url) => handleSelect(url)}
        onCancel={() => handleSelect(null)}
      />
    );
  });
}

// 윈도우에 노출하여 raw admin script에서 사용 가능.
if (typeof window !== 'undefined') {
  window.openMediaPicker = openMediaPicker;
}

function kindOf(d) {
  if (d.kind) return d.kind;
  const s = String(d.src || '');
  if (/^data:video|\.mp4|\.webm/i.test(s)) return 'video';
  return 'image';
}

function fmtBytes(n) {
  if (!n) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

function MediaPickerDialog({ options, onSelect, onCancel }) {
  const [items, setItems] = useState(() => DB.get(STORAGE_KEY) || []);
  const [filter, setFilter] = useState(options.kind || 'all');
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  // localStorage가 외부에서 변경되면 자동 동기화
  useEffect(() => {
    const refresh = () => setItems(DB.get(STORAGE_KEY) || []);
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  // ESC로 취소
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const filtered = useMemo(() => {
    if (filter === 'all') return items;
    return items.filter((d) => kindOf(d) === filter);
  }, [items, filter]);

  const upload = async (files, kind) => {
    if (!files || !files.length) return;
    setUploading(true); setErr('');
    try {
      for (const file of Array.from(files)) {
        const fn = (kind === 'video') ? window.uploadVideo : window.uploadImage;
        if (!fn) throw new Error('업로드 모듈을 찾을 수 없습니다.');
        const r = await fn(file);
        DB.add(STORAGE_KEY, {
          name: r.name || file.name,
          src: r.url,
          size: r.size || file.size,
          kind: r.kind || kind,
          public_id: r.publicUrl || null,
        });
      }
      setItems(DB.get(STORAGE_KEY) || []);
    } catch (e) {
      setErr(String(e && e.message ? e.message : e));
    } finally {
      setUploading(false);
    }
  };

  const allowUpload = options.allowUpload !== false;

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="dialog" aria-modal="true" aria-label="미디어 선택">
      <div className="adm-modal-box is-wide">
        <div className="adm-modal-head">
          <h2>미디어 선택</h2>
          <button type="button" className="adm-modal-close" onClick={onCancel} aria-label="닫기">×</button>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid #d7d4cf', background: '#fff', fontSize: 13 }}>
            <option value="all">전체</option>
            <option value="image">이미지</option>
            <option value="video">영상</option>
          </select>
          <span style={{ color: '#8c867d', fontSize: 12 }}>{filtered.length}개 자산</span>
          {allowUpload && (
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <label className="adm-btn-sm" style={{ cursor: 'pointer' }}>
                <input type="file" accept="image/*" multiple style={{ display: 'none' }}
                  onChange={(e) => { upload(e.target.files, 'image'); e.target.value = ''; }} />
                + 이미지
              </label>
              <label className="adm-btn-sm" style={{ cursor: 'pointer' }}>
                <input type="file" accept="video/mp4,video/webm" multiple style={{ display: 'none' }}
                  onChange={(e) => { upload(e.target.files, 'video'); e.target.value = ''; }} />
                + 영상
              </label>
            </span>
          )}
        </div>

        {uploading && <p style={{ fontSize: 12, color: '#b87333', margin: '0 0 10px' }}>업로드 중…</p>}
        {err && <p style={{ fontSize: 12, color: '#c0392b', margin: '0 0 10px' }}>{err}</p>}

        {!filtered.length ? (
          <div className="adm-doc-empty">
            <strong>등록된 미디어가 없습니다</strong>
            위 + 이미지 / + 영상 버튼으로 업로드한 뒤 선택할 수 있습니다.
          </div>
        ) : (
          <div className="adm-media-grid" style={{ maxHeight: 480, overflowY: 'auto', padding: 4 }}>
            {filtered.map((d) => {
              const safe = safeUrl(d.src) || (typeof d.src === 'string' && d.src.startsWith('data:') ? d.src : '');
              return (
                <button key={d.id} type="button"
                  onClick={() => safe && onSelect(safe)}
                  className="adm-media-item"
                  style={{ background: '#fff', border: '1px solid #d7d4cf', padding: 0, textAlign: 'left', cursor: 'pointer' }}
                  title={d.name}>
                  {kindOf(d) === 'video' ? (
                    <video src={safe} muted playsInline preload="metadata"
                      style={{ width: '100%', height: 120, objectFit: 'cover', background: '#000' }} />
                  ) : (
                    <img src={safe} alt={d.name || ''} loading="lazy"
                      style={{ width: '100%', height: 120, objectFit: 'cover', background: '#f6f4f0' }} />
                  )}
                  <div style={{ padding: '6px 10px', fontSize: 11, color: '#5a534b', display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name || ''}</span>
                    <span style={{ color: '#8c867d', marginLeft: 6 }}>{fmtBytes(d.size)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onCancel}>취소</button>
        </div>
      </div>
    </div>
  );
}
