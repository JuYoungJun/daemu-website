import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/process.html.js';
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd } from '../lib/seo.js';

export default function Process() {
  useSeo({
    title: '프로세스 — 초기 상담부터 운영까지 10단계',
    description: '대무의 10단계 카페 컨설팅 프로세스. 일반 컨설팅의 사진이팅 → 인테리어 시공 → 장비 납품 한계를 넘어, 전략·메뉴·브랜드·공간·운영을 하나의 통합 구조로 연결합니다.',
    path: '/process',
    keywords: '카페 컨설팅 프로세스, 베이커리 창업 단계, 카페 오픈 절차, 매장 운영 프로세스',
    jsonLd: [breadcrumbLd([{ name: '홈', path: '/' }, { name: 'Process', path: '/process' }])],
  });
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = import.meta.env.BASE_URL + 'process-page.css';
    link.dataset.pageStyle = 'process';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  return <RawPage html={html} bodyClass={bodyClass} script="/process-page.js" />;
}
