// Default product catalog for partner ordering. Categories + items with prices.
// Can be moved to admin (daemu_products) later — for now this is the source of truth.

export const PRODUCT_CATALOG = [
  {
    category: '베이커리',
    items: [
      { sku: 'DG-CRO-FZ',   name: '크루아상 생지 (냉동)',     unit: '100g',  price: 1200,  stock: 999 },
      { sku: 'DG-PAS-FZ',   name: '페이스트리 생지 (냉동)',     unit: '100g',  price: 1400,  stock: 999 },
      { sku: 'DG-BAG-FZ',   name: '베이글 생지 (냉동)',         unit: '120g',  price: 1100,  stock: 999 },
    ]
  },
  {
    category: '커피·음료',
    items: [
      { sku: 'CF-SP-NT',    name: '스페셜티 원두 - 시그니처 블렌드', unit: '1kg',  price: 38000, stock: 200 },
      { sku: 'CF-DA-1K',    name: '데일리 블렌드 원두',           unit: '1kg',  price: 24000, stock: 300 },
      { sku: 'SY-VAN-1L',   name: '바닐라 시럽',                 unit: '1L',    price: 9800,  stock: 150 },
      { sku: 'SY-CAR-1L',   name: '카라멜 시럽',                 unit: '1L',    price: 9800,  stock: 150 },
    ]
  },
  {
    category: '포장재',
    items: [
      { sku: 'PK-CUP-12',   name: '테이크아웃 컵 12oz (500입)',  unit: '500ea', price: 32000, stock: 80 },
      { sku: 'PK-LID-12',   name: '컵 뚜껑 12oz (500입)',        unit: '500ea', price: 18000, stock: 100 },
      { sku: 'PK-BAG-PA',   name: '페이퍼 백 (200입)',           unit: '200ea', price: 14000, stock: 60 },
    ]
  },
];

// Flat lookup by sku
export function findProduct(sku) {
  for (const cat of PRODUCT_CATALOG) {
    const it = cat.items.find((x) => x.sku === sku);
    if (it) return { ...it, category: cat.category };
  }
  return null;
}

export function flatProducts() {
  return PRODUCT_CATALOG.flatMap((c) => c.items.map((it) => ({ ...it, category: c.category })));
}
