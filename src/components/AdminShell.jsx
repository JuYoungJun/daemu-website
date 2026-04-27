import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { DB } from '../lib/db.js';
import { downloadCSV } from '../lib/csv.js';

const STAGE_LABEL = { lead:'리드', qualified:'검토중', customer:'전환', lost:'이탈' };

const EXPORTS = {
  '/admin/inquiries': {
    key: 'inquiries',
    filename: '문의내역',
    columns: [
      { key: 'date',   label: '접수일' },
      { key: 'name',   label: '이름' },
      { key: 'phone',  label: '연락처' },
      { key: 'email',  label: '이메일' },
      { key: 'type',   label: '카테고리' },
      { key: 'region', label: '지역' },
      { key: 'open',   label: '오픈시기' },
      { key: 'brand',  label: '브랜드' },
      { key: 'msg',    label: '문의내용' },
      { key: 'reply',  label: '회신메모' },
      { key: 'status', label: '상태' }
    ]
  },
  '/admin/partners': {
    key: 'partners',
    filename: '파트너목록',
    columns: [
      { key: 'date',   label: '등록일' },
      { key: 'name',   label: '회사명' },
      { key: 'person', label: '담당자' },
      { key: 'phone',  label: '연락처' },
      { key: 'email',  label: '이메일' },
      { key: 'type',   label: '업종' },
      { key: 'role',   label: '권한' },
      { key: 'active', label: '상태' },
      { key: 'note',   label: '메모' }
    ]
  },
  '/admin/orders': {
    key: 'orders',
    filename: '발주내역',
    columns: [
      { key: 'date',     label: '접수일' },
      { key: (r) => '#' + String(r.id).slice(-6), label: '주문번호' },
      { key: 'partner',  label: '파트너' },
      { key: 'product',  label: '상품' },
      { key: 'qty',      label: '수량' },
      { key: 'price',    label: '단가' },
      { key: (r) => Number(r.qty || 0) * Number(r.price || 0), label: '금액' },
      { key: 'status',   label: '상태' },
      { key: 'note',     label: '비고' }
    ]
  },
  '/admin/crm': {
    key: 'crm',
    filename: 'CRM',
    columns: [
      { key: 'date',    label: '등록일' },
      { key: 'name',    label: '이름' },
      { key: 'company', label: '회사' },
      { key: 'email',   label: '이메일' },
      { key: 'phone',   label: '연락처' },
      { key: 'source',  label: '유입경로' },
      { key: (r) => STAGE_LABEL[r.status] || r.status, label: '단계' },
      { key: 'value',   label: '예상금액' },
      { key: (r) => (r.tags || []).join(' | '), label: '태그' },
      { key: 'summary', label: '요약메모' },
      { key: (r) => (r.notes || []).map(n => '[' + n.ts + '] ' + n.text).join(' || '), label: '활동로그' }
    ]
  },
  '/admin/works': {
    key: 'projects',
    filename: '작업사례',
    columns: [
      { key: 'date',   label: '등록일' },
      { key: 'brand',  label: '브랜드' },
      { key: 'name',   label: '지점' },
      { key: 'size',   label: '규모' },
      { key: 'year',   label: '연도' },
      { key: 'addr',   label: '주소' },
      { key: 'status', label: '상태' },
      { key: 'desc',   label: '설명' },
      { key: (r) => (r.images || []).length, label: '이미지수' }
    ]
  },
  '/admin/campaign': {
    key: 'campaigns',
    filename: '캠페인',
    columns: [
      { key: 'date',         label: '작성일' },
      { key: 'title',        label: '제목' },
      { key: 'channel',      label: '채널' },
      { key: 'subject',      label: '이메일제목' },
      { key: 'segGroup',     label: '대상그룹' },
      { key: 'segStage',     label: 'CRM단계' },
      { key: (r) => (r.segTags || []).join(' | '), label: '태그' },
      { key: 'recipients',   label: '수신자수' },
      { key: 'opens',        label: '오픈' },
      { key: 'clicks',       label: '클릭' },
      { key: 'sentDate',     label: '발송일' },
      { key: 'status',       label: '상태' }
    ]
  },
  '/admin/promotion': {
    key: 'coupons',
    filename: '쿠폰',
    columns: [
      { key: 'date',   label: '등록일' },
      { key: 'code',   label: '코드' },
      { key: 'desc',   label: '설명' },
      { key: 'type',   label: '유형' },
      { key: 'value',  label: '값' },
      { key: 'from',   label: '시작' },
      { key: 'to',     label: '종료' },
      { key: 'max',    label: '최대' },
      { key: 'uses',   label: '사용' },
      { key: 'status', label: '상태' }
    ]
  },
  '/admin/popup': {
    key: 'popups',
    filename: '팝업',
    columns: [
      { key: 'date',         label: '등록일' },
      { key: 'title',        label: '제목' },
      { key: 'position',     label: '위치' },
      { key: 'frequency',    label: '빈도' },
      { key: 'from',         label: '시작' },
      { key: 'to',           label: '종료' },
      { key: (r) => (r.targetPages || []).join(' | '), label: '타겟페이지' },
      { key: 'impressions',  label: '노출' },
      { key: 'clicks',       label: '클릭' },
      { key: 'status',       label: '상태' }
    ]
  }
};

export default function AdminShell({ children }) {
  const { pathname } = useLocation();
  const exp = EXPORTS[pathname];

  useEffect(() => {
    document.body.dataset.page = 'admin';
    document.body.classList.remove('splash-pending');
    document.body.classList.add('splash-ready');
    return () => { delete document.body.dataset.page; };
  }, []);

  const onExport = () => {
    const rows = DB.get(exp.key);
    const today = new Date().toISOString().slice(0, 10);
    downloadCSV(`${exp.filename}-${today}.csv`, rows, exp.columns);
  };

  return (
    <>
      {exp && (
        <button
          type="button"
          onClick={onExport}
          className="adm-export-fab"
          title={exp.filename + ' CSV 다운로드'}>
          ↓ CSV 다운로드
        </button>
      )}
      {children}
    </>
  );
}
