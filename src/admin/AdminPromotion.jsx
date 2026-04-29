import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { GuideButton, PromotionGuide } from './PageGuides.jsx';
import html from './raw/admin-promotion.html.js';

export default function AdminPromotion() {
  return (
    <AdminShell>
      <GuideButton GuideComponent={PromotionGuide} />
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
