import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import html from './raw/admin-orders.html.js';

export default function AdminOrders() {
  return (
    <AdminShell>
      <AdminHelp title="발주·계약 관리 안내" items={[
        '발주/계약은 본 시스템에서 본문 작성 → 이메일 발송 → Outbox 기록까지 처리합니다.',
        '⚠️ 결제(PG 연동)는 데모 단계에서 미구현 상태입니다. amount 필드는 단순 금액 표기이며, 실제 결제는 별도 시스템(예: 이니시스/포트원)이 필요합니다.',
        '계약서 발송: 본문에 표준 약관/금액/조건을 입력 후 "계약서 발송" 버튼. 파트너 이메일이 등록돼 있어야 발송됩니다.',
        '상태 흐름: 접수 → 처리중 → 출고완료. 단계 변경은 Outbox에 자동 기록되지 않으니 필요한 알림은 별도 발송하세요.',
        '엑셀 내보내기는 우측 하단 "CSV 다운로드" 버튼(BOM UTF-8). Excel/Numbers에서 한국어가 정상 표시됩니다.',
      ]} />
      <RawPage html={html} script="/admin-orders-page.js" />
    </AdminShell>
  );
}
