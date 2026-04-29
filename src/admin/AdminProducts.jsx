// 발주 상품 카탈로그 관리.
//
// 데이터: localStorage 'daemu_products' — 형태:
//   [
//     { category, accent, items: [
//        { sku, name, unit, price, stock, emoji?, image?, desc? }
//     ] },
//     ...
//   ]
//
// 카탈로그가 비어 있으면 첫 진입 시 시드(PRODUCT_CATALOG)를 복사해 시작점으로 둡니다.
// 파트너 포털의 Shop은 같은 storage를 보고 즉시 반영됩니다.
// 향후 backend Product 테이블이 추가되면 이 페이지가 그것을 통해 호출하게
// 바꾸기 쉽도록, 모든 mutation을 한 함수(saveCatalog)로 모아두었습니다.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { ensureSeededProducts, getActiveCatalog } from '../lib/partnerProducts.js';
import { safeMediaUrl } from '../lib/safe.js';
import ProductThumb from './ProductThumb.jsx';
import { downloadCSV } from '../lib/csv.js';
import { siteAlert, siteConfirm } from '../lib/dialog.js';
import { formatCurrencyTyping, unformatNumber } from '../lib/inputFormat.js';
import { nextSku } from '../lib/numbering.js';
import { LOW_STOCK_THRESHOLD } from '../lib/inventory.js';
import { GuideButton, ProductsGuide } from './PageGuides.jsx';

const STORAGE_KEY = 'daemu_products';

function readCatalog() { return getActiveCatalog(); }
function saveCatalog(catalog) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(catalog));
  window.dispatchEvent(new Event('daemu-db-change'));
}

const PRESET_EMOJIS = ['📦', '🥐', '🥖', '🥯', '🍞', '🧁', '🥧', '☕', '🍵', '🥤', '🧃', '🍶', '🍯', '🧈', '🥛', '🍫', '🍪', '🛍️', '🧢'];

export default function AdminProducts() {
  // 처음 진입 시 카탈로그가 비어 있으면 시드 복제
  useEffect(() => { ensureSeededProducts(); }, []);

  const [catalog, setCatalog] = useState(() => readCatalog());
  const [editingProduct, setEditingProduct] = useState(null); // { catIdx, item, isNew }
  const [editingCategory, setEditingCategory] = useState(null); // { idx, value, accent }
  const [creatingCategory, setCreatingCategory] = useState(false);

  useEffect(() => {
    const refresh = () => setCatalog(readCatalog());
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  const totalItems = useMemo(() => catalog.reduce((a, c) => a + (c.items || []).length, 0), [catalog]);

  // -------- 카테고리 --------
  const addCategory = (label, accent = '#8c867d') => {
    const next = [...catalog, { category: label, accent, items: [] }];
    saveCatalog(next);
    setCatalog(next);
    setCreatingCategory(false);
  };
  const updateCategory = (idx, label, accent) => {
    const next = [...catalog];
    next[idx] = { ...next[idx], category: label, accent };
    saveCatalog(next);
    setCatalog(next);
    setEditingCategory(null);
  };
  const deleteCategory = async (idx) => {
    const cat = catalog[idx];
    const itemCount = (cat.items || []).length;
    const msg = itemCount
      ? `"${cat.category}" 카테고리에 ${itemCount}개 상품이 있습니다. 카테고리와 상품 모두 삭제할까요?`
      : `"${cat.category}" 카테고리를 삭제할까요?`;
    if (!(await siteConfirm(msg))) return;
    const next = catalog.filter((_, i) => i !== idx);
    saveCatalog(next);
    setCatalog(next);
  };

  // -------- 상품 --------
  const saveProduct = (catIdx, item, originalSku) => {
    if (!item.sku?.trim()) { siteAlert('SKU(상품 코드)를 입력하세요.'); return; }
    if (!item.name?.trim()) { siteAlert('상품명을 입력하세요.'); return; }
    // 다른 카테고리의 SKU 중복 검사
    const dup = catalog.some((c, ci) =>
      (c.items || []).some((x) => x.sku === item.sku && (ci !== catIdx || x.sku !== originalSku))
    );
    if (dup) { siteAlert('이미 사용 중인 SKU 입니다. 다른 코드를 입력하세요.'); return; }

    const next = catalog.map((c, i) => {
      if (i !== catIdx) return c;
      const items = [...(c.items || [])];
      const idx = originalSku ? items.findIndex((x) => x.sku === originalSku) : -1;
      const cleaned = {
        sku: item.sku.trim(),
        name: item.name.trim(),
        unit: (item.unit || '').trim(),
        price: Math.max(0, Number(item.price) || 0),
        stock: Math.max(0, Number(item.stock) || 0),
        emoji: item.emoji || '',
        image: item.image || '',
        desc: item.desc || '',
      };
      if (idx >= 0) items[idx] = cleaned;
      else items.push(cleaned);
      return { ...c, items };
    });
    saveCatalog(next);
    setCatalog(next);
    setEditingProduct(null);
  };
  const deleteProduct = async (catIdx, sku) => {
    if (!(await siteConfirm(`상품 "${sku}"를 삭제할까요?`))) return;
    const next = catalog.map((c, i) =>
      i !== catIdx ? c : { ...c, items: (c.items || []).filter((x) => x.sku !== sku) }
    );
    saveCatalog(next);
    setCatalog(next);
  };

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <GuideButton GuideComponent={ProductsGuide} />
          <h1 className="page-title">발주 상품 관리</h1>

          <AdminHelp title="발주 상품 관리 안내" items={[
            '여기서 등록한 상품이 파트너 포털의 "상품 발주" 페이지에 즉시 반영됩니다.',
            '카테고리 → 상품 순서로 관리합니다. 카테고리 색상은 발주 페이지의 카테고리 라벨/카드 액센트에 사용됩니다.',
            'SKU(상품 코드)는 카탈로그 전체에서 유일해야 합니다. 예: DG-CRO-FZ',
            '이미지는 미디어 라이브러리에서 선택하거나 외부 URL을 직접 입력할 수 있습니다. 비워두면 이모지가 표시됩니다.',
            '재고 수량은 표시·관리 용도이며, 발주 시 자동으로 차감되지는 않습니다. (필요 시 발주 처리 단계에서 수동 차감)',
            '데이터는 브라우저 localStorage에 저장됩니다. 운영 시점에 backend로 옮기면 자동으로 같은 형태로 마이그레이션됩니다.',
          ]} />

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 18px' }}>
            <span className="adm-doc-pill" style={{ borderColor: '#6f6b68', color: '#6f6b68' }}>카테고리 {catalog.length}</span>
            <span className="adm-doc-pill" style={{ borderColor: '#1f5e7c', color: '#1f5e7c' }}>상품 {totalItems}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="adm-btn-sm" disabled={!totalItems}
              onClick={() => downloadCSV(
                'daemu-products-' + new Date().toISOString().slice(0, 10) + '.csv',
                catalog.flatMap((c) => (c.items || []).map((it) => ({ ...it, _category: c.category }))),
                [
                  { key: '_category', label: '카테고리' },
                  { key: 'sku', label: 'SKU' },
                  { key: 'name', label: '상품명' },
                  { key: 'unit', label: '단위' },
                  { key: 'price', label: '가격' },
                  { key: 'stock', label: '재고' },
                  { key: 'emoji', label: '이모지' },
                  { key: 'image', label: '이미지URL' },
                  { key: 'desc', label: '설명' },
                ],
              )}>CSV 내보내기</button>
            <button type="button" className="btn" onClick={() => setCreatingCategory(true)}>+ 카테고리 추가</button>
          </div>

          {!catalog.length && (
            <div className="adm-doc-empty">
              <strong>등록된 카테고리가 없습니다</strong>
              상단 <em>+ 카테고리 추가</em>로 첫 카테고리를 만들고, 이어서 상품을 등록하세요.
            </div>
          )}

          {catalog.map((cat, ci) => (
            <section key={ci} style={{
              background: '#fff', border: '1px solid #d7d4cf', borderLeft: '3px solid ' + (cat.accent || '#8c867d'),
              padding: '18px 20px', marginBottom: 18,
            }}>
              <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h3 style={{ fontSize: 15, color: '#231815', margin: 0, fontWeight: 600 }}>
                    {cat.category} <span style={{ color: '#8c867d', fontWeight: 400, fontSize: 12, marginLeft: 6 }}>· {(cat.items || []).length}개 상품</span>
                  </h3>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="adm-btn-sm" onClick={() => setEditingCategory({ idx: ci, value: cat.category, accent: cat.accent || '#8c867d' })}>카테고리 수정</button>
                  <button type="button" className="adm-btn-sm danger" onClick={() => deleteCategory(ci)}>카테고리 삭제</button>
                  <button type="button" className="btn" onClick={() => setEditingProduct({ catIdx: ci, item: { sku: '', name: '', unit: '', price: 0, stock: 0, emoji: '📦', image: '', desc: '' }, isNew: true })}>+ 상품</button>
                </div>
              </header>

              {!(cat.items || []).length ? (
                <p style={{ color: '#8c867d', fontSize: 12, padding: '14px 0', margin: 0 }}>등록된 상품이 없습니다.</p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th style={{ width: 56 }}></th>
                        <th>상품명 / SKU</th>
                        <th style={{ width: 90 }}>단위</th>
                        <th style={{ width: 110 }}>가격</th>
                        <th style={{ width: 80 }}>재고</th>
                        <th className="col-actions" style={{ width: 160 }}>관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(cat.items || []).map((p) => (
                        <tr key={p.sku}>
                          <td data-label="">
                            <ProductThumb rawSrc={p.image} emoji={p.emoji} accent={cat.accent} />
                          </td>
                          <td data-label="상품명 / SKU">
                            <div style={{ fontWeight: 500 }}>{p.name}</div>
                            <div style={{ fontSize: 11, color: '#8c867d', fontFamily: 'monospace' }}>{p.sku}</div>
                          </td>
                          <td data-label="단위">{p.unit || '-'}</td>
                          <td data-label="가격" style={{ fontFamily: "'Cormorant Garamond', serif", fontStyle: 'italic', fontSize: 16 }}>
                            {Number(p.price || 0).toLocaleString('ko')}원
                          </td>
                          <td data-label="재고">
                            {p.stock != null ? (
                              <span style={{
                                color: p.stock === 0 ? '#c0392b' : p.stock < LOW_STOCK_THRESHOLD ? '#b87333' : '#231815',
                                fontWeight: p.stock < LOW_STOCK_THRESHOLD ? 600 : 400,
                              }}>
                                {p.stock.toLocaleString('ko')}
                                {p.stock === 0 && <span style={{ fontSize: 10, marginLeft: 6, color: '#c0392b' }}>품절</span>}
                                {p.stock > 0 && p.stock < LOW_STOCK_THRESHOLD && <span style={{ fontSize: 10, marginLeft: 6, color: '#b87333' }}>부족</span>}
                              </span>
                            ) : '-'}
                          </td>
                          <td data-label="관리" className="col-actions">
                            <button type="button" className="adm-btn-sm" onClick={() => setEditingProduct({ catIdx: ci, item: p, isNew: false })}>수정</button>
                            <button type="button" className="adm-btn-sm danger" onClick={() => deleteProduct(ci, p.sku)}>삭제</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ))}

          {(creatingCategory || editingCategory) && (
            <CategoryEditor
              data={editingCategory}
              onClose={() => { setCreatingCategory(false); setEditingCategory(null); }}
              onSave={(label, accent) => {
                if (editingCategory) updateCategory(editingCategory.idx, label, accent);
                else addCategory(label, accent);
              }}
            />
          )}

          {editingProduct && (
            <ProductEditor
              catalog={catalog}
              data={editingProduct}
              presetEmojis={PRESET_EMOJIS}
              onClose={() => setEditingProduct(null)}
              onSave={(item) => saveProduct(editingProduct.catIdx, item, editingProduct.isNew ? null : editingProduct.item.sku)}
            />
          )}
        </section>
      </main>
    </AdminShell>
  );
}

function CategoryEditor({ data, onClose, onSave }) {
  const [label, setLabel] = useState(data?.value || '');
  const [accent, setAccent] = useState(data?.accent || '#8c867d');
  const ACCENTS = ['#c79a6b', '#7a4f2e', '#8c867d', '#1f5e7c', '#2e7d32', '#b87333', '#c0392b', '#5a4a2a'];
  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-narrow">
        <div className="adm-modal-head">
          <h2>{data ? '카테고리 수정' : '카테고리 추가'}</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <label className="adm-inline-field">
            <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>카테고리명</span>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 베이커리 / 커피·음료 / 포장재" autoFocus />
          </label>
          <div>
            <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>액센트 색상</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {ACCENTS.map((c) => (
                <button key={c} type="button" onClick={() => setAccent(c)}
                  style={{ width: 28, height: 28, border: accent === c ? '2px solid #111' : '1px solid #d7d4cf', background: c, cursor: 'pointer', borderRadius: 3 }} aria-label={c} />
              ))}
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)}
                style={{ width: 40, height: 28, border: '1px solid #d7d4cf', padding: 0, cursor: 'pointer' }} />
              <span style={{ fontSize: 11, color: '#8c867d', marginLeft: 6 }}>{accent}</span>
            </div>
          </div>
        </div>
        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn" onClick={() => label.trim() && onSave(label.trim(), accent)}>저장</button>
        </div>
      </div>
    </div>
  );
}

function ProductEditor({ catalog, data, presetEmojis, onClose, onSave }) {
  const [form, setForm] = useState({
    sku: data.item.sku || '',
    name: data.item.name || '',
    unit: data.item.unit || '',
    price: data.item.price ?? 0,
    stock: data.item.stock ?? 0,
    emoji: data.item.emoji || '📦',
    image: data.item.image || '',
    desc: data.item.desc || '',
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setNum = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value === '' ? '' : Number(e.target.value) }));
  const cat = catalog[data.catIdx];

  const pickImage = async () => {
    if (window.openMediaPicker) {
      const url = await window.openMediaPicker({ kind: 'image', allowUpload: true });
      if (url) setForm((f) => ({ ...f, image: url }));
    } else {
      siteAlert('미디어 라이브러리를 불러올 수 없습니다.');
    }
  };

  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-narrow">
        <div className="adm-modal-head">
          <h2>{data.isNew ? '상품 추가' : '상품 수정'} <span style={{ fontSize: 12, color: '#8c867d', marginLeft: 8 }}>{cat?.category}</span></h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <label className="adm-inline-field">
            <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>SKU (상품 코드, 영문/숫자)</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="text" value={form.sku} onChange={set('sku')} placeholder="예: BAKERY-001" disabled={!data.isNew}
                title={data.isNew ? '' : 'SKU는 등록 후 변경할 수 없습니다.'} style={{ fontFamily: 'monospace', flex: 1 }} />
              {data.isNew && (
                <button type="button" className="adm-btn-sm"
                  onClick={() => setForm((f) => ({ ...f, sku: nextSku(cat?.category) }))}
                  title="카테고리별 다음 SKU 자동 생성">
                  자동 생성
                </button>
              )}
            </div>
          </label>
          <label className="adm-inline-field">
            <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>상품명</span>
            <input type="text" value={form.name} onChange={set('name')} placeholder="예: 크루아상 생지 (냉동)" autoFocus />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            <label className="adm-inline-field">
              <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>단위</span>
              <input type="text" value={form.unit} onChange={set('unit')} placeholder="예: 100g / 1kg / 500ea" />
            </label>
            <label className="adm-inline-field">
              <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>단가 (원)</span>
              <input type="text" inputMode="numeric"
                value={formatCurrencyTyping(form.price)}
                onChange={(e) => setForm((f) => ({ ...f, price: unformatNumber(e.target.value) }))}
                placeholder="예: 1,500" />
            </label>
            <label className="adm-inline-field">
              <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>재고</span>
              <input type="text" inputMode="numeric"
                value={formatCurrencyTyping(form.stock)}
                onChange={(e) => setForm((f) => ({ ...f, stock: unformatNumber(e.target.value) }))}
                placeholder="예: 100" />
            </label>
          </div>
          <label className="adm-inline-field">
            <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>설명 (간단히, 1~2줄)</span>
            <textarea rows={2} value={form.desc} onChange={set('desc')} placeholder="예: 버터 풍미가 진한 정통 프렌치 크루아상 생지" />
          </label>

          <div>
            <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>이미지 (선택)</span>
            {(() => {
              // 이미지 미리보기 — Snyk DOM-XSS 방지: safeMediaUrl 통과한 값만
              // CSS background-image에 사용. 무효 URL은 무시되고 emoji가 표시됨.
              const previewSrc = safeMediaUrl(form.image);
              return (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{
                width: 72, height: 72,
                background: previewSrc ? `url("${previewSrc}") center/cover no-repeat` : (cat?.accent || '#f6f4f0'),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: '1px solid #d7d4cf', borderRadius: 3, fontSize: 32,
              }}>
                {!previewSrc && (form.emoji || '📦')}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button type="button" className="adm-btn-sm" onClick={pickImage}>라이브러리에서 선택</button>
                {form.image && (
                  <button type="button" className="adm-btn-sm danger" onClick={() => setForm((f) => ({ ...f, image: '' }))}>이미지 제거</button>
                )}
              </div>
            </div>
              );
            })()}
            <input type="text" value={form.image} onChange={set('image')} placeholder="또는 외부 이미지 URL 직접 입력 (https://...)"
              style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px', marginTop: 8, border: '1px solid #d7d4cf', fontSize: 11, fontFamily: 'monospace' }} />
          </div>

          <div>
            <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 6 }}>이모지 (이미지가 없을 때 표시)</span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {presetEmojis.map((e) => (
                <button key={e} type="button" onClick={() => setForm((f) => ({ ...f, emoji: e }))}
                  style={{ fontSize: 20, padding: 6, minWidth: 36, border: form.emoji === e ? '2px solid #111' : '1px solid #d7d4cf', background: form.emoji === e ? '#f6f4f0' : '#fff', cursor: 'pointer' }}>
                  {e}
                </button>
              ))}
              <input type="text" maxLength={4} value={form.emoji} onChange={set('emoji')}
                style={{ width: 50, padding: 6, fontSize: 16, textAlign: 'center', border: '1px solid #d7d4cf' }} />
            </div>
          </div>
        </div>
        <div className="adm-action-row">
          <button type="button" className="adm-btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn" onClick={() => onSave(form)}>저장</button>
        </div>
      </div>
    </div>
  );
}
