// localStorage CRUD utilities (port of admin-shared.js)
let __id_counter = 0;
function nextId() {
  const now = Date.now();
  __id_counter = now > __id_counter ? now : __id_counter + 1;
  return __id_counter;
}

export const DB = {
  get(key) {
    try { return JSON.parse(localStorage.getItem('daemu_' + key)) || []; }
    catch (e) { return []; }
  },
  set(key, data) { localStorage.setItem('daemu_' + key, JSON.stringify(data)); },
  add(key, item) {
    const d = DB.get(key);
    item.id = nextId();
    item.date = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' });
    d.push(item);
    DB.set(key, d);
    return item;
  },
  del(key, id) { DB.set(key, DB.get(key).filter(i => i.id !== id)); },
  update(key, id, updates) {
    const d = DB.get(key);
    const i = d.findIndex(x => x.id === id);
    if (i >= 0) Object.assign(d[i], updates);
    DB.set(key, d);
  }
};

// HTML 문자열을 반환하는 옛 헬퍼들 — 외부 코드 리뷰 F-3.8 권장에 따라
// status 값에 inline HTML escape 적용 (admin 페이지에서 사용자 입력이
// status 자리로 흘러들어오는 케이스 방어).
//
// 권장 패턴: 신규 코드는 {status} 텍스트로 React 컴포넌트 사용 (StatusBadge
// 같은 형태). 본 헬퍼는 RawPage 호환성용으로 유지하지만 escape 강제.
function _escAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const _STATUS_CLASS_MAP = {
  '운영중':'done','활성':'done','NEW':'new','준비중':'pending',
  '대기':'pending','신규':'new','처리중':'pending','완료':'done',
  '답변완료':'done','접수':'new','출고완료':'done','비활성':'pending','일시중지':'pending'
};

export function badge(status) {
  const cls = _STATUS_CLASS_MAP[status] || 'done';
  return { __html: '<span class="adm-badge adm-badge--' + cls + '">' + _escAttr(status) + '</span>' };
}

export function badgeStr(status) {
  const cls = _STATUS_CLASS_MAP[status] || 'done';
  return '<span class="adm-badge adm-badge--' + cls + '">' + _escAttr(status) + '</span>';
}

export function confirmDel(msg) { return confirm(msg || '정말 삭제하시겠습니까?'); }

export function fmtMoney(n) { return Number(n || 0).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }); }

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
