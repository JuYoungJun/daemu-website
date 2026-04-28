import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import RawPage from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/work-detail.html.js';
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd } from '../lib/seo.js';

// Pretty-print a slug like "beclassy-naju" → "Beclassy 나주점"
function slugToTitle(slug) {
  if (!slug) return '작업 사례';
  if (slug === 'beclassy-naju') return 'Beclassy 나주점';
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function WorkDetail() {
  const { slug } = useParams();
  const projectTitle = slugToTitle(slug);
  useSeo({
    title: `${projectTitle} — 작업 사례`,
    description: `대무가 진행한 ${projectTitle} 프로젝트 — 브랜드 전략, 메뉴 개발, 공간 설계, 운영까지 전 과정을 아우르는 카페·베이커리 컨설팅 사례.`,
    path: `/work/${slug}`,
    keywords: `${projectTitle}, 대무 작업 사례, 카페 프로젝트, 베이커리 컨설팅 사례`,
    jsonLd: [breadcrumbLd([
      { name: '홈', path: '/' },
      { name: 'Work', path: '/work' },
      { name: projectTitle, path: `/work/${slug}` },
    ])],
  });
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = import.meta.env.BASE_URL + 'work-detail-page.css';
    link.dataset.pageStyle = 'work-detail';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  // Force re-mount + re-script-execution when slug changes
  return <RawPage key={slug} html={html} bodyClass={bodyClass} script="/work-detail-page.js" />;
}
