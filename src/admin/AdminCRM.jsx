import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { GuideButton, CRMGuide } from './PageGuides.jsx';
import html from './raw/admin-crm.html.js';

export default function AdminCRM() {
  return (
    <AdminShell>
      <GuideButton GuideComponent={CRMGuide} />
      <AdminHelp title="CRM 사용 안내" items={[
        '리드 자동 수집: Contact 페이지·Partners 가입 신청에서 들어온 신청은 자동으로 "리드" 단계로 등록됩니다.',
        '단계 이동: 카드 카드를 클릭 → 드로어에서 단계를 변경(리드→검토중→전환). 이탈 처리도 가능합니다.',
        '태그·세그먼트: 태그는 자유 입력. 캠페인 페이지의 수신자 필터에서 태그/단계 기준 그룹 발송이 가능합니다.',
        '메모: 상담 내용·통화 기록을 활동 메모로 남겨 타임라인으로 확인합니다.',
        '더미 데이터 없음: 비어있다면 실제 신청이 들어오기 전 정상 상태입니다.',
      ]} />
      <RawPage html={html} script="/admin-crm-page.js" />
    </AdminShell>
  );
}
