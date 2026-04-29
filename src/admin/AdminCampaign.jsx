import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { GuideButton, RawPageCsvButton, CampaignGuide } from './PageGuides.jsx';
import html from './raw/admin-campaign.html.js';

const CAMPAIGN_CSV_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'date', label: '작성일' },
  { key: 'name', label: '캠페인명' },
  { key: 'channel', label: '채널' },
  { key: 'status', label: '상태' },
  { key: 'subject', label: '제목' },
  { key: 'target', label: '대상 그룹' },
  { key: 'sent', label: '발송 수' },
  { key: 'opened', label: '오픈' },
  { key: 'clicked', label: '클릭' },
  { key: 'scheduled_at', label: '예약시각' },
];

export default function AdminCampaign() {
  return (
    <AdminShell>
      <GuideButton GuideComponent={CampaignGuide} />
      <RawPageCsvButton storageKey="campaigns" filename="daemu-campaigns" columns={CAMPAIGN_CSV_COLUMNS} />
      <AdminHelp title="캠페인 / 뉴스레터 사용 안내" items={[
        '뉴스레터 구독자: Partners 페이지의 "뉴스레터 구독" 폼에서 들어옵니다. 본 페이지의 "구독자 관리"에서 확인할 수 있습니다.',
        '발송 그룹: CRM 단계/태그, 뉴스레터 활성 구독자, 파트너 활성 계정 중 선택해 발송합니다.',
        '예약 발송: 예약 시간을 설정하면 백엔드 작업이 해당 시각에 자동 발송합니다 (단, RESEND_API_KEY 환경변수가 등록된 경우만 실제 발송).',
        '이메일 미설정 시: 시뮬레이션 모드 — Outbox에 "simulated"로 기록되어 발송되지 않습니다.',
      ]} />
      <RawPage html={html} script="/admin-campaign-page.js" />
    </AdminShell>
  );
}
