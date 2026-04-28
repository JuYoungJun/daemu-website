// Default product catalog for partner ordering. Categories + items with prices.
//
// `image`는 GitHub Pages 서브패스(`/daemu-website`)에서도 동작하도록
// import.meta.env.BASE_URL 을 prefix합니다. 자산 파일은 public/assets/ 에
// 위치하며 Vite가 빌드 시 그대로 dist/assets로 복사합니다.

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
const A = (path) => BASE.replace(/\/$/, '') + (path.startsWith('/') ? path : '/' + path);

export const PRODUCT_CATALOG = [
  {
    category: '베이커리',
    accent: '#c79a6b',
    items: [
      { sku: 'DG-CRO-FZ',   name: '크루아상 생지 (냉동)',     unit: '100g',  price: 1200,  stock: 999, emoji: '🥐', image: A('/assets/work-croissants.png'),       desc: '버터 풍미가 진한 정통 프렌치 크루아상 생지' },
      { sku: 'DG-PAS-FZ',   name: '페이스트리 생지 (냉동)',     unit: '100g',  price: 1400,  stock: 999, emoji: '🥖', image: A('/assets/work-bakery-project.png'),  desc: '데니쉬·뺑오쇼콜라용 다층 페이스트리 생지' },
      { sku: 'DG-BAG-FZ',   name: '베이글 생지 (냉동)',         unit: '120g',  price: 1100,  stock: 999, emoji: '🥯', image: A('/assets/work-desserts.png'),         desc: '쫄깃한 식감의 뉴욕 스타일 베이글 생지' },
    ]
  },
  {
    category: '커피·음료',
    accent: '#7a4f2e',
    items: [
      { sku: 'CF-SP-NT',    name: '스페셜티 원두 - 시그니처 블렌드', unit: '1kg',  price: 38000, stock: 200, emoji: '☕',  image: A('/assets/work-beclassy-1.png'),       desc: '대무 스페셜티 시그니처 — 초콜릿·견과류 노트' },
      { sku: 'CF-DA-1K',    name: '데일리 블렌드 원두',           unit: '1kg',  price: 24000, stock: 300, emoji: '☕',  image: A('/assets/work-beclassy-2.png'),       desc: '에스프레소·드립 모두 적합한 밸런스형 블렌드' },
      { sku: 'SY-VAN-1L',   name: '바닐라 시럽',                 unit: '1L',    price: 9800,  stock: 150, emoji: '🍶',  image: A('/assets/work-beclassy-3.png'),       desc: '천연 바닐라 추출 시럽' },
      { sku: 'SY-CAR-1L',   name: '카라멜 시럽',                 unit: '1L',    price: 9800,  stock: 150, emoji: '🍶',  image: A('/assets/work-beclassy-4.png'),       desc: '버터스카치 풍미의 카라멜 시럽' },
    ]
  },
  {
    category: '포장재',
    accent: '#8c867d',
    items: [
      { sku: 'PK-CUP-12',   name: '테이크아웃 컵 12oz (500입)',  unit: '500ea', price: 32000, stock: 80,  emoji: '🥤',  image: A('/assets/work-beclassy-5.png'),       desc: '재활용 가능 PE 코팅 종이컵' },
      { sku: 'PK-LID-12',   name: '컵 뚜껑 12oz (500입)',        unit: '500ea', price: 18000, stock: 100, emoji: '🧢',  image: A('/assets/work-beclassy-7.png'),       desc: '유아 안전 인증 PP 뚜껑' },
      { sku: 'PK-BAG-PA',   name: '페이퍼 백 (200입)',           unit: '200ea', price: 14000, stock: 60,  emoji: '🛍️',  image: A('/assets/work-pumjang.png'),          desc: 'FSC 인증 크라프트 페이퍼 백' },
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
