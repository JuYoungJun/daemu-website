// 재고 / SKU / LOT / 유통기한 관리.
// 표준 SKU 형식: DAEMU-CAT-NNNN-LL (CAT = BAK / CAF / EQP / PCK / MSC)
// FIFO 차감 + D-3 임박 알림 + 만료 자동 격리 (cron).
//
// backend endpoints:
//   GET  /api/products
//   POST /api/products  { name, sku?, category, unit, price, stock_count }
//   PATCH /api/products/{id}
//   DELETE /api/products/{id}
//   POST /api/inventory/sku/preview  { category, label_suffix? }  → { sku }
//   GET  /api/inventory/sku/categories
//   GET  /api/inventory/lots?sku=&within_days=
//   POST /api/inventory/lots  { sku, lot_number, quantity, produced_at, expires_at, supplier, note }
//   PATCH /api/inventory/lots/{id}
//   DELETE /api/inventory/lots/{id}
//   POST /api/inventory/adjust  { sku, delta, reason }
//   GET  /api/inventory/alerts  → { low_stock, expiring_soon, expired }
//   GET  /api/inventory/best-sellers?days=30

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { PageActions, GuideButton } from './PageGuides.jsx';
import { api } from '../lib/api.js';
import { siteAlert, siteConfirm, siteToast } from '../lib/dialog.js';
import { downloadCSV } from '../lib/csv.js';

const TABS = [
  { key: 'products', label: 'SKU / 상품' },
  { key: 'lots', label: 'LOT / 유통기한' },
  { key: 'alerts', label: '알림' },
  { key: 'bestsellers', label: 'TOP 30일' },
];

function fmtDate(s) {
  if (!s) return '';
  try { return new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }); }
  catch { return String(s); }
}
function fmtDateOnly(s) {
  if (!s) return '';
  try { return new Date(s).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }); }
  catch { return String(s); }
}
function daysUntil(s) {
  if (!s) return null;
  const ms = new Date(s).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export default function AdminInventory() {
  const [tab, setTab] = useState('products');

  return (
    <AdminShell>
      <main className="page fade-up">
        <section className="wide">
          <Link to="/admin" className="adm-back">← Dashboard</Link>
          <h1 className="page-title">재고 / SKU / LOT 관리</h1>

          <PageActions>
            <GuideButton GuideComponent={InventoryGuide} />
          </PageActions>

          <AdminHelp title="재고 관리 안내" items={[
            'SKU 표준 형식: DAEMU-CAT-NNNN-LL (CAT=BAK/CAF/EQP/PCK/MSC, NNNN=일련번호, LL=옵션).',
            '신규 상품 등록 시 카테고리만 선택하면 다음 일련번호가 자동 할당됩니다.',
            'LOT 단위로 입고 시 유통기한을 등록하면 D-3 부터 알림 + 만료 시 자동 격리.',
            '발주 처리는 LOT FIFO (가장 오래된 LOT 부터 차감) 로 자동 처리됩니다.',
            '재고 < 10 인 SKU 는 알림 탭에 표시됩니다.',
            'TOP 30일 = 최근 30일 발주 수량 기준 베스트셀러 SKU.',
          ]} />

          <div style={{ display: 'flex', gap: 6, borderBottom: '2px solid #e6e3dd', margin: '20px 0 18px' }}>
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                style={{
                  padding: '10px 16px', fontSize: 12.5, letterSpacing: '.04em',
                  border: 'none', borderBottom: tab === t.key ? '2px solid #2a2724' : '2px solid transparent',
                  background: 'transparent', cursor: 'pointer', marginBottom: -2,
                  color: tab === t.key ? '#231815' : '#8c867d',
                  fontWeight: tab === t.key ? 600 : 400,
                }}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'products' && <ProductsTab />}
          {tab === 'lots' && <LotsTab />}
          {tab === 'alerts' && <AlertsTab />}
          {tab === 'bestsellers' && <BestSellersTab />}
        </section>
      </main>
    </AdminShell>
  );
}

// ── SKU / 상품 탭 ─────────────────────────────────────────────────
function ProductsTab() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ category: 'BAK', name: '', unit: '개', price: 0, stock_count: 0, sku: '' });
  const [skuPreview, setSkuPreview] = useState('');

  const load = async () => {
    setLoading(true);
    const r = await api.get('/api/products?page_size=500');
    setLoading(false);
    if (!r.ok) { siteAlert(r.error || '불러오기 실패'); return; }
    setProducts(r.items || []);
  };
  useEffect(() => { load(); }, []);

  const previewSku = async (category) => {
    const r = await api.post('/api/inventory/sku/preview', { category });
    if (r.ok) setSkuPreview(r.sku || '');
  };
  useEffect(() => { if (!editing) previewSku(form.category); }, [form.category, editing]);

  const onSave = async () => {
    if (!form.name.trim()) { siteAlert('상품명을 입력하세요.'); return; }
    const body = { ...form, name: form.name.trim(), price: Number(form.price) || 0, stock_count: Number(form.stock_count) || 0 };
    const r = editing
      ? await api.patch(`/api/products/${editing}`, body)
      : await api.post('/api/products', body);
    if (!r.ok) { siteAlert(r.error || '저장 실패'); return; }
    siteToast(editing ? '수정 완료' : '등록 완료', { tone: 'success' });
    setEditing(null);
    setForm({ category: 'BAK', name: '', unit: '개', price: 0, stock_count: 0, sku: '' });
    await load();
  };

  const onDelete = async (id, sku) => {
    if (!(await siteConfirm(`${sku} 상품을 영구 삭제하시겠습니까?`))) return;
    const r = await api.del(`/api/products/${id}`);
    if (r.ok || r.status === 204) {
      siteToast('삭제 완료', { tone: 'success' });
      await load();
    } else siteAlert(r.error || '삭제 실패');
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      (p.sku || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q)
    );
  }, [products, search]);

  return (
    <>
      <h3 className="admin-section-title">{editing ? `상품 수정 (id=${editing})` : '신규 상품 등록'}</h3>
      <div style={{ display: 'grid', gap: 10, marginBottom: 24 }}>
        <Row>
          <Field label="카테고리">
            <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
              <option value="BAK">BAK 베이커리</option>
              <option value="CAF">CAF 카페</option>
              <option value="EQP">EQP 설비</option>
              <option value="PCK">PCK 패키징</option>
              <option value="MSC">MSC 기타</option>
            </select>
          </Field>
          <Field label={editing ? 'SKU (수정 불가)' : `SKU (자동 발급 미리보기: ${skuPreview || '...'})`}>
            <input type="text" value={editing ? form.sku : skuPreview} disabled style={{ ...inputStyle, background: '#f6f4f0' }} />
          </Field>
        </Row>
        <Field label="상품명 *">
          <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} style={inputStyle} maxLength={120} />
        </Field>
        <Row>
          <Field label="단위">
            <input type="text" value={form.unit} onChange={(e) => setForm(f => ({ ...f, unit: e.target.value }))} style={inputStyle} maxLength={20} />
          </Field>
          <Field label="단가 (원)">
            <input type="number" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))} style={inputStyle} min={0} />
          </Field>
          <Field label="초기 재고">
            <input type="number" value={form.stock_count} onChange={(e) => setForm(f => ({ ...f, stock_count: e.target.value }))} style={inputStyle} min={0} />
          </Field>
        </Row>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn" onClick={onSave}>{editing ? '저장' : '등록'}</button>
          {editing && (
            <button type="button" className="adm-btn-sm" onClick={() => {
              setEditing(null);
              setForm({ category: 'BAK', name: '', unit: '개', price: 0, stock_count: 0, sku: '' });
            }}>취소</button>
          )}
        </div>
      </div>

      <h3 className="admin-section-title">
        등록된 상품 ({filtered.length})
        <input type="text" placeholder="SKU / 이름 검색" value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ marginLeft: 12, padding: '4px 8px', border: '1px solid #d7d4cf', fontSize: 12, fontWeight: 400 }} />
        <button type="button" className="adm-page-action-btn adm-page-action-btn--csv" style={{ marginLeft: 8 }}
          onClick={() => downloadCSV(
            'daemu-products-' + new Date().toISOString().slice(0, 10) + '.csv',
            filtered,
            [
              { key: 'sku', label: 'SKU' },
              { key: 'name', label: '상품명' },
              { key: 'category', label: '카테고리' },
              { key: 'unit', label: '단위' },
              { key: 'price', label: '단가' },
              { key: 'stock_count', label: '재고' },
            ],
          )}>
          CSV
        </button>
      </h3>
      {loading ? <div style={{ padding: 24, color: '#8c867d' }}>불러오는 중…</div> : !filtered.length ? (
        <div className="adm-doc-empty" style={{ padding: '24px 16px' }}>
          <strong>등록된 상품이 없습니다</strong>
          상단 폼에서 첫 SKU 를 등록하세요.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #2a2724', background: '#faf8f5' }}>
                <th style={th}>SKU</th><th style={th}>상품명</th><th style={th}>단위</th>
                <th style={th}>단가</th><th style={th}>재고</th><th style={th}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #e6e3dd' }}>
                  <td style={td}><code style={{ fontSize: 11.5 }}>{p.sku}</code></td>
                  <td style={td}>{p.name}</td>
                  <td style={td}>{p.unit}</td>
                  <td style={td}>{(p.price || 0).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td>
                  <td style={{ ...td, color: (p.stock_count || 0) < 10 ? '#c0392b' : '#231815', fontWeight: (p.stock_count || 0) < 10 ? 600 : 400 }}>
                    {p.stock_count || 0}
                  </td>
                  <td style={td}>
                    <button type="button" className="adm-btn-sm" onClick={() => {
                      setEditing(p.id);
                      setForm({
                        category: p.category || 'BAK', name: p.name || '', unit: p.unit || '개',
                        price: p.price || 0, stock_count: p.stock_count || 0, sku: p.sku || '',
                      });
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}>수정</button>
                    <button type="button" className="adm-btn-sm danger" style={{ marginLeft: 4 }}
                      onClick={() => onDelete(p.id, p.sku)}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── LOT 탭 ────────────────────────────────────────────────────────
function LotsTab() {
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ sku: '', within_days: '' });
  const [form, setForm] = useState({ sku: '', lot_number: '', quantity: 0, produced_at: '', expires_at: '', supplier: '', note: '' });

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filter.sku) params.set('sku', filter.sku);
    if (filter.within_days) params.set('within_days', filter.within_days);
    const r = await api.get('/api/inventory/lots' + (params.toString() ? `?${params}` : ''));
    setLoading(false);
    if (!r.ok) { siteAlert(r.error || '불러오기 실패'); return; }
    setLots(r.items || []);
  };
  useEffect(() => { load(); }, [filter]);

  const onSave = async () => {
    if (!form.sku.trim() || !form.lot_number.trim()) { siteAlert('SKU 와 LOT 번호는 필수입니다.'); return; }
    const r = await api.post('/api/inventory/lots', {
      ...form, sku: form.sku.trim(), lot_number: form.lot_number.trim(),
      quantity: Number(form.quantity) || 0,
    });
    if (!r.ok) { siteAlert(r.error || '저장 실패'); return; }
    siteToast('LOT 입고 완료', { tone: 'success' });
    setForm({ sku: '', lot_number: '', quantity: 0, produced_at: '', expires_at: '', supplier: '', note: '' });
    await load();
  };

  const onDelete = async (id, lot) => {
    if (!(await siteConfirm(`LOT ${lot} 을 삭제하시겠습니까?`))) return;
    const r = await api.del(`/api/inventory/lots/${id}`);
    if (r.ok || r.status === 204) { siteToast('삭제 완료', { tone: 'success' }); await load(); }
    else siteAlert(r.error || '삭제 실패');
  };

  return (
    <>
      <h3 className="admin-section-title">신규 LOT 입고</h3>
      <div style={{ display: 'grid', gap: 10, marginBottom: 24 }}>
        <Row>
          <Field label="SKU *"><input type="text" value={form.sku} onChange={(e) => setForm(f => ({ ...f, sku: e.target.value }))} style={inputStyle} placeholder="DAEMU-BAK-0001-00" /></Field>
          <Field label="LOT 번호 *"><input type="text" value={form.lot_number} onChange={(e) => setForm(f => ({ ...f, lot_number: e.target.value }))} style={inputStyle} maxLength={40} /></Field>
          <Field label="수량 *"><input type="number" value={form.quantity} onChange={(e) => setForm(f => ({ ...f, quantity: e.target.value }))} style={inputStyle} min={1} /></Field>
        </Row>
        <Row>
          <Field label="생산일"><input type="date" value={form.produced_at} onChange={(e) => setForm(f => ({ ...f, produced_at: e.target.value }))} style={inputStyle} /></Field>
          <Field label="유통기한"><input type="date" value={form.expires_at} onChange={(e) => setForm(f => ({ ...f, expires_at: e.target.value }))} style={inputStyle} /></Field>
          <Field label="공급사"><input type="text" value={form.supplier} onChange={(e) => setForm(f => ({ ...f, supplier: e.target.value }))} style={inputStyle} /></Field>
        </Row>
        <Field label="비고">
          <input type="text" value={form.note} onChange={(e) => setForm(f => ({ ...f, note: e.target.value }))} style={inputStyle} maxLength={300} />
        </Field>
        <div><button type="button" className="btn" onClick={onSave}>입고 등록</button></div>
      </div>

      <h3 className="admin-section-title">LOT 목록 ({lots.length})</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input type="text" placeholder="SKU 필터" value={filter.sku} onChange={(e) => setFilter(f => ({ ...f, sku: e.target.value }))}
          style={{ ...inputStyle, width: 200 }} />
        <select value={filter.within_days} onChange={(e) => setFilter(f => ({ ...f, within_days: e.target.value }))} style={{ ...inputStyle, width: 160 }}>
          <option value="">모든 LOT</option>
          <option value="3">D-3 임박</option>
          <option value="7">D-7 임박</option>
          <option value="14">D-14 임박</option>
          <option value="0">이미 만료</option>
        </select>
      </div>
      {loading ? <div style={{ padding: 24, color: '#8c867d' }}>불러오는 중…</div> : !lots.length ? (
        <div className="adm-doc-empty" style={{ padding: '24px 16px' }}>해당 LOT 없음</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #2a2724', background: '#faf8f5' }}>
                <th style={th}>SKU</th><th style={th}>LOT</th><th style={th}>수량</th>
                <th style={th}>유통기한</th><th style={th}>상태</th><th style={th}>입고</th><th style={th}>관리</th>
              </tr>
            </thead>
            <tbody>
              {lots.map(l => {
                const dleft = daysUntil(l.expires_at);
                const isExpired = dleft != null && dleft < 0;
                const isImminent = dleft != null && dleft >= 0 && dleft <= 3;
                const isQuarantined = !!l.quarantined;
                return (
                  <tr key={l.id} style={{ borderBottom: '1px solid #e6e3dd', opacity: isQuarantined ? 0.55 : 1 }}>
                    <td style={td}><code style={{ fontSize: 11 }}>{l.sku}</code></td>
                    <td style={td}>{l.lot_number}</td>
                    <td style={td}>{l.quantity || 0}</td>
                    <td style={{ ...td, fontSize: 11.5, color: isExpired ? '#c0392b' : isImminent ? '#b87333' : '#5a534b' }}>
                      {l.expires_at ? fmtDateOnly(l.expires_at) : '—'}
                      {dleft != null && (
                        <span style={{ display: 'block', fontSize: 10.5 }}>
                          {dleft < 0 ? `${-dleft}일 만료` : `D-${dleft}`}
                        </span>
                      )}
                    </td>
                    <td style={td}>
                      {isQuarantined ? <span style={{ color: '#c0392b', fontSize: 11 }}>격리</span>
                        : isExpired ? <span style={{ color: '#c0392b', fontSize: 11 }}>만료</span>
                        : isImminent ? <span style={{ color: '#b87333', fontSize: 11 }}>임박</span>
                        : <span style={{ color: '#2e7d32', fontSize: 11 }}>정상</span>}
                    </td>
                    <td style={{ ...td, fontSize: 11, color: '#8c867d' }}>{l.received_at ? fmtDateOnly(l.received_at) : '—'}</td>
                    <td style={td}><button type="button" className="adm-btn-sm danger" onClick={() => onDelete(l.id, l.lot_number)}>삭제</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ── 알림 탭 ───────────────────────────────────────────────────────
function AlertsTab() {
  const [data, setData] = useState({ low_stock: [], expiring_soon: [], expired: [] });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/api/inventory/alerts').then(r => {
      setLoading(false);
      if (r.ok) setData(r);
      else siteAlert(r.error || '불러오기 실패');
    });
  }, []);
  if (loading) return <div style={{ padding: 24, color: '#8c867d' }}>불러오는 중…</div>;
  return (
    <>
      <Section title={`재고 부족 (< 10) — ${data.low_stock?.length || 0}건`}>
        {!data.low_stock?.length ? <Empty msg="재고 부족 없음" /> : <SimpleList rows={data.low_stock} cols={[['sku', 'SKU'], ['name', '상품명'], ['stock_count', '재고']]} />}
      </Section>
      <Section title={`유통기한 임박 (D-3) — ${data.expiring_soon?.length || 0}건`}>
        {!data.expiring_soon?.length ? <Empty msg="임박 LOT 없음" /> : <SimpleList rows={data.expiring_soon} cols={[['sku', 'SKU'], ['lot_number', 'LOT'], ['quantity', '수량'], ['expires_at', '유통기한', fmtDateOnly]]} />}
      </Section>
      <Section title={`만료 LOT — ${data.expired?.length || 0}건 (자동 격리됨)`}>
        {!data.expired?.length ? <Empty msg="만료 LOT 없음" /> : <SimpleList rows={data.expired} cols={[['sku', 'SKU'], ['lot_number', 'LOT'], ['quantity', '수량'], ['expires_at', '만료일', fmtDateOnly]]} />}
      </Section>
    </>
  );
}

function BestSellersTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api.get('/api/inventory/best-sellers?days=30').then(r => {
      setLoading(false);
      if (r.ok) setItems(r.items || []);
      else siteAlert(r.error || '불러오기 실패');
    });
  }, []);
  if (loading) return <div style={{ padding: 24, color: '#8c867d' }}>불러오는 중…</div>;
  return (
    <>
      <h3 className="admin-section-title">최근 30일 베스트셀러 (발주 수량 기준 TOP)</h3>
      {!items.length ? <Empty msg="발주 데이터 없음" /> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #2a2724', background: '#faf8f5' }}>
                <th style={th}>순위</th><th style={th}>SKU</th><th style={th}>상품명</th><th style={th}>발주 수량</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={it.sku} style={{ borderBottom: '1px solid #e6e3dd' }}>
                  <td style={{ ...td, fontWeight: 600 }}>{i + 1}</td>
                  <td style={td}><code style={{ fontSize: 11 }}>{it.sku}</code></td>
                  <td style={td}>{it.name || '—'}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{it.qty || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 className="admin-section-title">{title}</h3>
      {children}
    </div>
  );
}
function Empty({ msg }) { return <div className="adm-doc-empty" style={{ padding: '16px 12px', fontSize: 13, color: '#8c867d' }}>{msg}</div>; }
function SimpleList({ rows, cols }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead><tr style={{ borderBottom: '2px solid #2a2724', background: '#faf8f5' }}>{cols.map(c => <th key={c[0]} style={th}>{c[1]}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #e6e3dd' }}>
              {cols.map(c => <td key={c[0]} style={td}>{c[2] ? c[2](r[c[0]]) : (r[c[0]] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ children }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>{children}</div>; }
function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: '#8c867d', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
const inputStyle = { width: '100%', padding: '8px 10px', border: '1px solid #d7d4cf', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' };
const th = { padding: '8px 10px', textAlign: 'left', fontSize: 11, letterSpacing: '.08em', color: '#5a534b', fontWeight: 600 };
const td = { padding: '10px', verticalAlign: 'top' };

function InventoryGuide({ onClose }) {
  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} role="dialog">
      <div className="adm-modal-box">
        <div className="adm-modal-head">
          <h2>재고/SKU/LOT — 사용 가이드</h2>
          <button type="button" className="adm-modal-close" onClick={onClose}>×</button>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.8, color: '#5a534b' }}>
          <h3 style={{ fontSize: 14, marginTop: 12 }}>SKU 표준</h3>
          <p><code>DAEMU-CAT-NNNN-LL</code></p>
          <ul style={{ paddingLeft: 18 }}>
            <li>CAT: BAK(베이커리) / CAF(카페) / EQP(설비) / PCK(패키징) / MSC(기타)</li>
            <li>NNNN: 카테고리 내 일련번호 (자동 할당)</li>
            <li>LL: 옵션 (사이즈/맛/색깔), 기본 00</li>
          </ul>
          <h3 style={{ fontSize: 14, marginTop: 12 }}>LOT / 유통기한</h3>
          <p>LOT 단위로 입고하면 가장 오래된 LOT 부터 자동 차감(FIFO). D-3 부터 임박 알림, 만료 시 자동 격리.</p>
          <h3 style={{ fontSize: 14, marginTop: 12 }}>발주 차단</h3>
          <p>파트너가 SKU 의 가용 재고보다 많이 발주하면 자동으로 막힙니다.</p>
        </div>
      </div>
    </div>
  );
}
