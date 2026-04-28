import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import html from './raw/admin-orders.html.js';

export default function AdminOrders() {
  return (
    <AdminShell>
      <AdminHelp title="발주·계약 관리 안내" items={[
        '발주/계약은 본 시스템에서 본문 작성 → 이메일 발송 → Outbox 기록까지 처리합니다.',
        '본 페이지는 발주서·계약서 문서 워크플로(작성·발송·상태 추적·이력)에 한정합니다. 실제 대금 수납/결제 처리는 본 시스템에서 다루지 않습니다.',
        '계약서 발송: 본문에 표준 약관/금액/납기 조건을 입력 후 "계약서 발송" 버튼. 파트너 이메일이 등록돼 있어야 발송됩니다.',
        '상태 흐름: 접수 → 처리중 → 출고완료. 단계 변경은 Outbox에 자동 기록되지 않으니 필요한 알림은 별도 발송하세요.',
        '엑셀 내보내기는 우측 하단 "CSV 다운로드" 버튼(BOM UTF-8). Excel/Numbers에서 한국어가 정상 표시됩니다.',
        '서명이 필요한 계약서는 "계약서/발주서" 메뉴(/admin/contracts)에서 e-Sign 워크플로를 사용하세요.',
      ]} />
      <RawPage html={html} script="/admin-orders-page.js" />
    </AdminShell>
  );
}
