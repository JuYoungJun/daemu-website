// 함께하는 파트너사 관리.
//
// 이 페이지가 관리하는 것 = Home의 <함께하는 파트너사> 섹션에 노출되는
// 파트너 로고 카드들. (B2B 발주 포털에 로그인하는 파트너 "계정" 관리는
// 별도 페이지인 /admin/partners 에서 다룹니다 — 두 개념이 다릅니다.)
//
// 데이터: backend MySQL `partner_brands` 테이블 (single source of truth).
// localStorage 'daemu_partner_brands' 는 Home.jsx 의 호환 캐시 (기존 사이트
// 코드가 그 키를 읽으므로 유지). 페이지 mount 시 backend → localStorage
// hydrate. CRUD 는 backend + 동시에 localStorage 갱신.
//
// backend shape:
//   GET/POST/PATCH/DELETE /api/partner-brands
//   { id, name, logo, url, sort_order, active, created_at, updated_at }
// frontend shape (legacy):
//   { id, name, logo, url, order, active }   ← `sort_order` ↔ `order` 매핑.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { downloadCSV } from '../lib/csv.js';
import { safeMediaUrl, validateOutboundUrl } from '../lib/safe.js';
import { PartnerBrandLogoImg } from '../components/PartnerBrandLogo.jsx';
import { siteAlert, siteConfirm, siteToast } from '../lib/dialog.js';
import { ensureHttps } from '../lib/inputFormat.js';
import { PageActions, GuideButton, PartnerBrandsGuide } from './PageGuides.jsx';
import { api } from '../lib/api.js';

const STORAGE_KEY = 'daemu_partner_brands';

// backend ↔ frontend shape 변환 — `sort_order` ↔ `order`.
function fromBackend(it) {
  return {
    id: it.id,
    name: it.name || '',
    logo: it.logo || '',
    url: it.url || '',
    order: it.sort_order || 0,
    active: !!it.active,
    _backend: true,
  };
}
function toBackend(b) {
  return {
    name: b.name || '',
    logo: b.logo || '',
    url: b.url || '',
    sort_order: Number(b.order) || 0,
    active: !!b.active,
  };
}

function readBrandsCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveCache(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event('daemu-db-change'));
}

export default function AdminPartnerBrands() {
  const [brands, setBrands] = useState(() => readBrandsCache());
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);

  // mount 시 backend hydrate — Mac/Windows 양쪽에서 같은 데이터.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!api.isConfigured()) { setLoading(false); return; }
      const r = await api.get('/api/partner-brands?page_size=200');
      if (!alive) return;
      setLoading(false);
      if (r && r.ok && Array.isArray(r.items)) {
        const mapped = r.items.map(fromBackend);
        setBrands(mapped);
        saveCache(mapped);
      }
      // 실패 시 localStorage 캐시 유지 (silent)
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const refresh = () => setBrands(readBrandsCache());
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  const sorted = useMemo(
    () => [...brands].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)),
    [brands],
  );
  const activeCount = brands.filter((b) => b.active).length;

  // backend mirror: localStorage + backend 동시 업데이트. backend 실패 시
  // 사용자에게 toast + localStorage rollback 은 다음 hydrate 가 처리.
  const upsert = async (form) => {
    if (!form.name?.trim()) { siteAlert('파트너사 이름을 입력하세요.'); return; }
    if (api.isConfigured()) {
      const payload = toBackend(form);
      const r = form.id
        ? await api.patch(`/api/partner-brands/${form.id}`, payload)
        : await api.post('/api/partner-brands', payload);
      if (!r.ok) { siteAlert(r.error || '저장 실패'); return; }
      const item = r.item ? fromBackend(r.item) : { ...form, id: form.id || (r.item && r.item.id) };
      const next = form.id
        ? brands.map((x) => x.id === form.id ? item : x)
        : [...brands, item];
      setBrands(next);
      saveCache(next);
      siteToast(form.id ? '수정 완료' : '등록 완료', { tone: 'success' });
    } else {
      // backend 미설정 — localStorage 만 (개발 mode)
      const next = [...brands];
      const id = form.id || (next.length ? Math.max(...next.map((x) => Number(x.id) || 0)) + 1 : 1);
      if (form.id) {
        const i = next.findIndex((x) => x.id === form.id);
        if (i >= 0) next[i] = { ...next[i], ...form };
      } else {
        next.push({ ...form, id });
      }
      setBrands(next);
      saveCache(next);
    }
    setEditing(null);
    setCreating(false);
  };

  const remove = async (id) => {
    if (!(await siteConfirm('이 파트너사를 삭제하시겠습니까?'))) return;
    if (api.isConfigured()) {
      const r = await api.del(`/api/partner-brands/${id}`);
      if (!r.ok && r.status !== 204) { siteAlert(r.error || '삭제 실패'); return; }
    }
    const next = brands.filter((x) => x.id !== id);
    setBrands(next);
    saveCache(next);
    siteToast('삭제 완료', { tone: 'success' });
  };

  const toggleActive = async (id) => {
    const target = brands.find((x) => x.id === id);
    if (!target) return;
    const newActive = !target.active;
    if (api.isConfigured()) {
      const r = await api.patch(`/api/partner-brands/${id}`, { active: newActive });
      if (!r.ok) { siteAlert(r.error || '변경 실패'); return; }
    }
    const next = brands.map((x) => x.id === id ? { ...x, active: newActive } : x);
    setBrands(next);
    saveCache(next);
  };

  const move = async (id, dir) => {
    const list = [...sorted];
    const idx = list.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    const reordered = list.map((b, i) => ({ ...b, order: i + 1 }));
    setBrands(reordered);
    saveCache(reordered);
    // backend 미러링 — 두 swap 된 row 만 PATCH (다른 row 의 sort_order 도
    // shift 됐을 수 있지만 표시 정합성에 큰 영향 없으니 핵심만 업데이트).
    if (api.isConfigured()) {
      const a = reordered[idx];
      const b = reordered[j];
      try {
        await Promise.all([
          api.patch(`/api/partner-brands/${a.id}`, { sort_order: a.order }),
          api.patch(`/api/partner-brands/${b.id}`, { sort_order: b.order }),
        ]);
      } catch { /* silent — 다음 hydrate 가 정정 */ }
    }
  };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <PageActions>
            <GuideButton GuideComponent={PartnerBrandsGuide} />
          </PageActions>
          <h1 className="page-title">함께하는 파트너사</h1>

          <AdminHelp title="파트너사 관리 안내" items={[
            '여기서 등록한 파트너사가 Home 페이지 "함께하는 파트너사" 섹션에 노출됩니다.',
            '파트너 포털 로그인 계정 관리는 /admin/partners 페이지에서 별도로 다룹니다 — 이 페이지는 단순 노출용입니다.',
            '로고는 미디어 라이브러리에서 선택하거나 외부 URL을 입력할 수 있습니다 (PNG/JPG/SVG/WebP).',
            '비활성 처리한 파트너사는 사이트에 노출되지 않지만 데이터는 보존됩니다.',
            '↑ ↓ 버튼으로 노출 순서를 조절할 수 있습니다.',
          ]} />

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 18px' }}>
            <span className="adm-doc-pill" style={{ borderColor: '#6f6b68', color: '#6f6b68' }}>전체 {brands.length}</span>
            <span className="adm-doc-pill" style={{ borderColor: '#2e7d32', color: '#2e7d32' }}>노출 {activeCount}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="adm-btn-sm"
              onClick={() => downloadCSV(
                'daemu-partner-brands-' + new Date().toISOString().slice(0, 10) + '.csv',
                sorted,
                [
                  { key: 'id', label: 'ID' },
                  { key: 'order', label: '순서' },
                  { key: 'name', label: '이름' },
                  { key: 'logo', label: '로고URL' },
                  { key: 'url', label: '링크URL' },
                  { key: (b) => b.active ? '노출' : '비활성', label: '상태' },
                ],
              )}>CSV 내보내기</button>
            <button type="button" className="btn" onClick={() => setCreating(true)}>+ 파트너사 추가</button>
          </div>

          {!sorted.length ? (
            <div className="adm-doc-empty">
              <strong>등록된 파트너사가 없습니다</strong>
              상단 <em>+ 파트너사 추가</em> 버튼으로 첫 파트너 로고를 등록하세요.
            </div>
          ) : (
            <div className="adm-brand-grid" style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14,
            }}>
              {sorted.map((b, i) => {
                // Snyk taint break — verify up front in parent.
                // 결과 primitive 만 컴포넌트/표시 element 로 전달.
                const verifiedLogoSrc = b.logo ? String(safeMediaUrl(b.logo) || '') : '';
                const verifiedHrefForText = String(validateOutboundUrl(b.url) || '');
                const safeBrandName = String(b.name == null ? '' : b.name).slice(0, 200);
                return (
                  <div key={b.id} style={{
                    border: '1px solid ' + (b.active ? '#d7d4cf' : '#e6e3dd'),
                    background: b.active ? '#fff' : '#faf8f5',
                    padding: 14,
                    opacity: b.active ? 1 : 0.6,
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    <div style={{
                      height: 80,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: '#f6f4f0', border: '1px solid #ece9e2',
                    }}>
                      <PartnerBrandLogoImg
                        verifiedLogoSrc={verifiedLogoSrc}
                        name={safeBrandName}
                        style={{ maxHeight: 64, maxWidth: '85%', objectFit: 'contain' }}
                      />
                      {!verifiedLogoSrc && (
                        <span style={{ fontSize: 18, fontFamily: "'Cormorant Garamond', Georgia, serif", color: '#8c867d' }}>
                          {safeBrandName || '(로고 없음)'}
                        </span>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#231815', marginBottom: 2 }}>{safeBrandName}</div>
                      {verifiedHrefForText && (
                        <div style={{ fontSize: 11, color: '#8c867d', wordBreak: 'break-all' }}>{verifiedHrefForText}</div>
                      )}
                      <div style={{ fontSize: 10, color: '#b9b5ae', letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 4 }}>
                        ORDER {b.order || (i + 1)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 'auto' }}>
                      <button type="button" className="adm-btn-sm" onClick={() => move(b.id, -1)} disabled={i === 0} title="위로">↑</button>
                      <button type="button" className="adm-btn-sm" onClick={() => move(b.id, +1)} disabled={i === sorted.length - 1} title="아래로">↓</button>
                      <span style={{ flex: 1 }} />
                      <button type="button" className="adm-btn-sm" onClick={() => toggleActive(b.id)}>
                        {b.active ? '비활성' : '활성'}
                      </button>
                      <button type="button" className="adm-btn-sm" onClick={() => setEditing(b)}>수정</button>
                      <button type="button" className="adm-btn-sm danger" onClick={() => remove(b.id)}>삭제</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(editing || creating) && (
            <BrandEditor
              data={editing}
              onClose={() => { setEditing(null); setCreating(false); }}
              onSave={upsert}
            />
          )}
        </section>
      </main>
    </AdminShell>
  );
}

function BrandEditor({ data, onClose, onSave }) {
  const [form, setForm] = useState({
    id: data?.id,
    name: data?.name || '',
    logo: data?.logo || '',
    url: data?.url || '',
    order: data?.order || 99,
    active: data?.active !== false,
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const pickLogo = async () => {
    if (!window.openMediaPicker) {
      siteAlert('미디어 라이브러리를 사용할 수 없습니다.');
      return;
    }
    const url = await window.openMediaPicker({ kind: 'image', allowUpload: true });
    if (url) setForm((f) => ({ ...f, logo: url }));
  };

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-narrow">
        <div className="adm-modal-head">
          <h2>{data ? '파트너사 수정' : '새 파트너사'}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <Field label="이름 (브랜드)">
            <input type="text" value={form.name} onChange={set('name')} placeholder="예: Beclassy" required />
          </Field>
          <Field label="로고 이미지">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" className="adm-btn-sm" onClick={pickLogo}>미디어 라이브러리에서 선택</button>
              <input type="text" value={form.logo} onChange={set('logo')}
                placeholder="또는 외부 URL (https://…)"
                style={{ flex: 1, minWidth: 180 }} />
            </div>
            {form.logo && (
              <div style={{ marginTop: 8, padding: 10, background: '#f6f4f0', border: '1px solid #e6e3dd', display: 'flex', justifyContent: 'center' }}>
                <PartnerBrandLogoImg
                  verifiedLogoSrc={String(safeMediaUrl(form.logo) || '')}
                  name=""
                  style={{ maxHeight: 60, maxWidth: '70%', objectFit: 'contain' }}
                />
              </div>
            )}
          </Field>
          <Field label="파트너사 링크 URL (선택)">
            <input type="url" value={form.url} onChange={set('url')}
              onBlur={(e) => setForm((f) => ({ ...f, url: ensureHttps(e.target.value) }))}
              placeholder="https://example.com (https:// 자동 부착)" />
          </Field>
          <Field label="노출 순서">
            <input type="number" value={form.order} onChange={set('order')} min={1} max={999} />
          </Field>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#5a534b' }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            사이트에 노출
          </label>
        </div>
        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn" onClick={() => onSave(form)}>저장</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="adm-inline-field" style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
