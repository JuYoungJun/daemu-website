// /admin/products 는 옛 파트너 포털 카탈로그 (브라우저 localStorage) 편집기였습니다.
// 운영 단계 진입에 맞춰 어드민 SKU·재고 관리는 `/admin/inventory` (Aiven MySQL 기반)
// 으로 일원화되었으며, 본 라우트는 즉시 그쪽으로 redirect 합니다.
//
// 이로써 어드민 측에서 같은 계정으로 다른 PC / 다른 브라우저로 들어와도
// 동일 데이터(`products` 테이블, Aiven) 를 볼 수 있습니다.
//
// 옛 nested-category 카탈로그는 `src/lib/partnerProducts.js` 에 남아 있어
// 파트너 포털(`/partners` 의 발주 페이지) 의 화면 표시에만 사용됩니다.
// 운영 단계 전환 시 partner-shop 카탈로그까지 backend 로 일원화 예정.

import { Navigate } from 'react-router-dom';

export default function AdminProducts() {
  return <Navigate to="/admin/inventory" replace />;
}
