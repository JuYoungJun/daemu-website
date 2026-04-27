import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GH_PAGES=1 빌드 시 /daemu-website/ subpath 적용 (juyoungjun.github.io/daemu-website/)
// 그 외 (로컬·운영 도메인)에서는 루트 경로
const base = process.env.GH_PAGES === '1' ? '/daemu-website/' : '/';

export default defineConfig({
  plugins: [react()],
  base,
  server: { port: 8765, host: true },
  preview: { port: 8765, host: true }
});
