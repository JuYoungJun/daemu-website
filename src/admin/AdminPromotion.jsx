import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { GuideButton, RawPageCsvButton, PromotionGuide } from './PageGuides.jsx';
import html from './raw/admin-promotion.html.js';

const PROMO_CSV_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'code', label: '쿠폰 코드' },
  { key: 'type', label: '타입' },
  { key: 'discount', label: '할인' },
  { key: 'validFrom', label: '시작일' },
  { key: 'validUntil', label: '만료일' },
  { key: 'maxUses', label: '최대 사용' },
  { key: 'used', label: '사용 횟수' },
  { key: (r) => (r.active ? '활성' : '비활성'), label: '상태' },
  { key: 'note', label: '메모' },
];

export default function AdminPromotion() {
  return (
    <AdminShell>
      <GuideButton GuideComponent={PromotionGuide} />
      <RawPageCsvButton storageKey="promotions" filename="daemu-promotions" columns={PROMO_CSV_COLUMNS} />
      <AdminHelp title="프로모션 사용 안내" items={[
        '쿠폰 등록: 코드(영문/숫자), 할인 방식(정률·정액·1+1), 유효기간, 최대 사용 횟수를 입력합니다.',
        '활성화: "활성"으로 표시된 쿠폰만 사용자에게 노출됩니다. 상세 코드는 비활성화로 임시 중지하세요.',
        '이벤트 배너: 본 페이지에서 이벤트/공지를 만들면 메인·About·Service 등 사용자 페이지 상단에 자동 노출됩니다.',
        '사용량 추적: 쿠폰 적용 시 자동으로 카운트가 올라갑니다. 최대 사용 횟수 도달 시 자동 만료됩니다.',
      ]} />
      <RawPage html={html} script="/admin-promotion-page.js" />
    </AdminShell>
  );
}
