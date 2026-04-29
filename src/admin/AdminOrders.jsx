import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { PageActions, GuideButton, RawPageCsvButton, OrdersGuide } from './PageGuides.jsx';
import html from './raw/admin-orders.html.js';

const ORDERS_CSV_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'po_no', label: '발주번호' },
  { key: 'date', label: '접수일' },
  { key: 'partner', label: '파트너' },
  { key: 'product', label: '상품' },
  { key: 'qty', label: '수량' },
  { key: 'price', label: '단가' },
  { key: (r) => (Number(r.qty || 0) * Number(r.price || 0)).toLocaleString('ko-KR'), label: '합계금액' },
  { key: 'status', label: '상태' },
  { key: 'note', label: '비고' },
];

export default function AdminOrders() {
  return (
    <AdminShell>
      <PageActions>
        <RawPageCsvButton storageKey="orders" filename="daemu-orders" columns={ORDERS_CSV_COLUMNS} />
        <GuideButton GuideComponent={OrdersGuide} />
      </PageActions>
      <AdminHelp title="발주·계약 관리 안내" items={[
        '발주/계약은 본 시스템에서 본문 작성 → 이메일 발송 → Outbox 기록까지 처리합니다.',
        '신규 발주 저장 시 발주번호(DM-PO-YYYY-NNNN)가 자동 부여됩니다. 상품 필드에 SKU(BAKERY-001 등) 가 들어 있으면 입력 수량만큼 재고 자동 차감.',
        '본 페이지는 발주서·계약서 문서 워크플로(작성·발송·상태 추적·이력)에 한정합니다. 실제 대금 수납/결제 처리는 본 시스템에서 다루지 않습니다.',
        '계약서 발송: 본문에 표준 약관/금액/납기 조건을 입력 후 "계약서 발송" 버튼. 파트너 이메일이 등록돼 있어야 발송됩니다.',
        '상태 흐름: 접수 → 처리중 → 출고완료. 단계 변경은 Outbox에 자동 기록되지 않으니 필요한 알림은 별도 발송하세요.',
        '서명이 필요한 계약서는 "계약서/발주서" 메뉴(/admin/contracts)에서 e-Sign 워크플로를 사용하세요.',
      ]} />
      <RawPage html={html} script="/admin-orders-page.js" />
    </AdminShell>
  );
}
