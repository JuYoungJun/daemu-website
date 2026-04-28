import RawPage from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/work.html.js';
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd } from '../lib/seo.js';

export default function Work() {
  useSeo({
    title: 'Work — 작업 사례 포트폴리오',
    description: '대무가 진행한 베이커리·카페 프로젝트 사례. 비클래시 나주점(4층 플래그십) 외 40+ 프로젝트. BRANDS · BRANCHES · EXECUTION 카테고리별 정리.',
    path: '/work',
    keywords: '대무 작업 사례, 비클래시, 카페 포트폴리오, 베이커리 프로젝트, 나주 카페 사례',
    jsonLd: [breadcrumbLd([{ name: '홈', path: '/' }, { name: 'Work', path: '/work' }])],
  });
  return <RawPage html={html} bodyClass={bodyClass} script="/work.js" />;
}
