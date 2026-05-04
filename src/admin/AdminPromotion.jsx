import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { PageActions, GuideButton, RawPageCsvButton, PromotionGuide } from './PageGuides.jsx';
import html from './raw/admin-promotion.html.js';

// CSV 컬럼은 backend Promotion shape 와 raw page (admin-promotion-page.js) 의
// admin shape 둘 다 fallback.
//   admin shape (mapBackendCoupon 결과): id / code / desc / type / value / from /
//                                          to / max / uses / status / note
//   backend shape: id / code / type / discount / validFrom / validUntil /
//                  maxUses / used / active / note
const PROMO_CSV_COLUMNS = [
  { key: (r) => r.id ?? '', label: 'ID' },
  { key: (r) => r.code || '', label: '쿠폰 코드' },
  { key: (r) => r.type || '', label: '타입' },
  { key: (r) => r.discount ?? r.value ?? '', label: '할인' },
  { key: (r) => r.validFrom || r.from || '', label: '시작일' },
  { key: (r) => r.validUntil || r.to || '', label: '만료일' },
  { key: (r) => r.maxUses ?? r.max ?? '', label: '최대 사용' },
  { key: (r) => r.used ?? r.uses ?? '', label: '사용 횟수' },
  { key: (r) => (r.active === true ? '활성' : (r.active === false ? '비활성' : (r.status || ''))), label: '상태' },
  { key: (r) => r.note || '', label: '메모' },
];

export default function AdminPromotion() {
  return (
    <AdminShell>
      <PageActions>
        {/* storageKey 는 raw page (admin-promotion-page.js) 의 STORAGE_KEY="coupons"
            와 일치해야 cached fallback 이 같은 localStorage 슬롯을 읽음.
            옛 코드는 'promotions' 로 mismatch 였음 → 0행 CSV 회귀. */}
        <RawPageCsvButton storageKey="coupons" apiPath="/api/promotions?page_size=500" filename="daemu-promotions" columns={PROMO_CSV_COLUMNS} />
        <GuideButton GuideComponent={PromotionGuide} />
      </PageActions>
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
