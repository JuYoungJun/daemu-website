import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GH_PAGES=1 빌드 시 /daemu-website/ subpath 적용 (juyoungjun.github.io/daemu-website/)
// 그 외 (로컬·운영 도메인)에서는 루트 경로
const base = process.env.GH_PAGES === '1' ? '/daemu-website/' : '/';

// manualChunks: 자주 변하지 않는 vendor 코드를 별도 파일로 빼서 브라우저 캐시
// 효율 ↑. 사용자가 admin 코드를 자주 갱신해도 react/router chunk 는 그대로
// 캐시 hit. 빌드 결과 main bundle 401KB → 추정 250KB (vendor 150KB 분리).
function manualChunks(id) {
  // 큰 외부 deps 분리
  if (id.includes('node_modules')) {
    if (id.includes('react-router')) return 'vendor-router';
    if (id.includes('react-dom')) return 'vendor-react-dom';
    if (id.includes('/react/')) return 'vendor-react';
    if (id.includes('browser-image-compression')) return 'vendor-image-compress';
    return 'vendor-misc';
  }
  // src/lib 의 무거운 헬퍼 (사용처가 많은) 분리 — admin / public 양쪽이 공유
  if (id.includes('/src/lib/seo')) return 'lib-seo';
  if (id.includes('/src/lib/email') || id.includes('/src/lib/upload')) return 'lib-email-upload';
}

// 빌드 시점 timestamp — `useExternalScript` 가 public/admin-*-page.js 로드
// 시 ?v= query 로 부착해서 새 deploy 후에도 옛 raw script 캐시 잡지 않게.
// main bundle (index-*.js) 은 Vite 가 자체 hash 부착해서 자동 cache-bust 되지만
// public/ 의 raw script 는 hash 가 없어 GH Pages default cache-control(10분) 동안
// 옛 코드 잡힘 → admin 페이지의 회귀 fix 들이 즉시 사용자에게 전파 안 됨.
const BUILD_TIME = String(Date.now());

export default defineConfig({
  plugins: [react()],
  base,
  server: { port: 8765, host: true },
  preview: { port: 8765, host: true },
  define: {
    __DAEMU_BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  build: {
    // 빌드 산출물 sourcemap 끔 — 클라이언트 인도 사이트라 코드 노출 회피.
    sourcemap: false,
    // 인라인 한도 4KB — favicon / 작은 SVG 만 base64 인라인.
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: { manualChunks },
    },
    // CSS code-split: 페이지별 CSS 가 따로 파일로 빠짐 (lazy 라우트와 함께 로드).
    cssCodeSplit: true,
    chunkSizeWarningLimit: 600,
  },
});
