// Default product catalog for partner ordering. Categories + items with prices.
// Can be moved to admin (daemu_products) later — for now this is the source of truth.
//
// `image` 필드:
//   · 외부 도메인 의존 없이 동작하도록 emoji fallback을 함께 제공합니다.
//     실제 사진을 쓰려면 image: '/assets/products/foo.png' 또는
//     관리자가 미디어 라이브러리에서 선택한 data URL/원격 URL로 교체.
//   · emoji 필드는 항상 채워져 있어 이미지가 없을 때도 시각적으로 구분 가능.

export const PRODUCT_CATALOG = [
  {
    category: '베이커리',
    accent: '#c79a6b',
    items: [
      { sku: 'DG-CRO-FZ',   name: '크루아상 생지 (냉동)',     unit: '100g',  price: 1200,  stock: 999, emoji: '🥐', desc: '버터 풍미가 진한 정통 프렌치 크루아상 생지' },
      { sku: 'DG-PAS-FZ',   name: '페이스트리 생지 (냉동)',     unit: '100g',  price: 1400,  stock: 999, emoji: '🥖', desc: '데니쉬·뺑오쇼콜라용 다층 페이스트리 생지' },
      { sku: 'DG-BAG-FZ',   name: '베이글 생지 (냉동)',         unit: '120g',  price: 1100,  stock: 999, emoji: '🥯', desc: '쫄깃한 식감의 뉴욕 스타일 베이글 생지' },
    ]
  },
  {
    category: '커피·음료',
    accent: '#7a4f2e',
    items: [
      { sku: 'CF-SP-NT',    name: '스페셜티 원두 - 시그니처 블렌드', unit: '1kg',  price: 38000, stock: 200, emoji: '☕', desc: '대무 스페셜티 시그니처 — 초콜릿·견과류 노트' },
      { sku: 'CF-DA-1K',    name: '데일리 블렌드 원두',           unit: '1kg',  price: 24000, stock: 300, emoji: '☕', desc: '에스프레소·드립 모두 적합한 밸런스형 블렌드' },
      { sku: 'SY-VAN-1L',   name: '바닐라 시럽',                 unit: '1L',    price: 9800,  stock: 150, emoji: '🍶', desc: '천연 바닐라 추출 시럽' },
      { sku: 'SY-CAR-1L',   name: '카라멜 시럽',                 unit: '1L',    price: 9800,  stock: 150, emoji: '🍶', desc: '버터스카치 풍미의 카라멜 시럽' },
    ]
  },
  {
    category: '포장재',
    accent: '#8c867d',
    items: [
      { sku: 'PK-CUP-12',   name: '테이크아웃 컵 12oz (500입)',  unit: '500ea', price: 32000, stock: 80,  emoji: '🥤', desc: '재활용 가능 PE 코팅 종이컵' },
      { sku: 'PK-LID-12',   name: '컵 뚜껑 12oz (500입)',        unit: '500ea', price: 18000, stock: 100, emoji: '🧢', desc: '유아 안전 인증 PP 뚜껑' },
      { sku: 'PK-BAG-PA',   name: '페이퍼 백 (200입)',           unit: '200ea', price: 14000, stock: 60,  emoji: '🛍️', desc: 'FSC 인증 크라프트 페이퍼 백' },
    ]
  },
];

// Flat lookup by sku
export function findProduct(sku) {
  for (const cat of PRODUCT_CATALOG) {
    const it = cat.items.find((x) => x.sku === sku);
    if (it) return { ...it, category: cat.category, accent: cat.accent };
  }
  return null;
}

export function flatProducts() {
  return PRODUCT_CATALOG.flatMap((c) => c.items.map((it) => ({ ...it, category: c.category, accent: c.accent })));
}
