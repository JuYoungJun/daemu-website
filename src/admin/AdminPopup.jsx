import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { GuideButton, RawPageCsvButton, PopupGuide } from './PageGuides.jsx';
import html from './raw/admin-popup.html.js';

const POPUP_CSV_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'title', label: '제목' },
  { key: 'position', label: '위치' },
  { key: 'frequency', label: '노출 빈도' },
  { key: (r) => (Array.isArray(r.target_pages) ? r.target_pages.join(' | ') : r.target_pages || ''), label: '대상 페이지' },
  { key: 'status', label: '상태' },
  { key: 'from', label: '노출 시작' },
  { key: 'to', label: '노출 종료' },
  { key: 'impressions', label: '노출수' },
  { key: 'clicks', label: '클릭수' },
  { key: (r) => (r.impressions > 0 ? Math.round((r.clicks || 0) / r.impressions * 1000) / 10 + '%' : '0%'), label: 'CTR' },
];

export default function AdminPopup() {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = import.meta.env.BASE_URL + 'admin-popup-page.css';
    link.dataset.pageStyle = 'admin-popup';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  return (
    <AdminShell>
      <GuideButton GuideComponent={PopupGuide} />
      <RawPageCsvButton storageKey="popups" filename="daemu-popups" columns={POPUP_CSV_COLUMNS} />
      <AdminHelp title="팝업 / 이벤트 사용 안내" items={[
        '위치·빈도: 중앙/우하단/상단 중 선택. 매번/하루 1회/영구 1회로 노출 빈도를 정합니다.',
        '타겟 페이지: 팝업이 노출될 페이지를 다중 선택할 수 있습니다 (메인/소개/서비스 등).',
        '상태: "활성"인 팝업만 사용자에게 노출됩니다. 등록 후 노출 시작 전까지 "일시중지"로 두는 것을 권장합니다.',
        'CTR 추적: 노출(impressions) / 클릭(clicks) 자동 집계. CTR = 클릭 ÷ 노출 × 100. 통계 페이지에서 비교 분석할 수 있습니다.',
      ]} />
      <RawPage html={html} script="/admin-popup-page.js" />
    </AdminShell>
  );
}
