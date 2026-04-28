import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/service.html.js';
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd } from '../lib/seo.js';

export default function Service() {
  useSeo({
    title: '서비스 — Strategy · Product · Brand · Space · Operation',
    description: '대무의 5단계 컨설팅 서비스: 시장 분석부터 매장 운영까지. 카페·베이커리 비즈니스가 필요로 하는 모든 단계를 한 팀이 책임집니다.',
    path: '/service',
    keywords: '카페 컨설팅 서비스, 베이커리 컨설팅 단계, 메뉴 개발 서비스, 카페 브랜딩, 매장 공간 설계',
    jsonLd: [breadcrumbLd([{ name: '홈', path: '/' }, { name: 'Service', path: '/service' }])],
  });
  // Inject inline-extracted CSS into <head> on mount
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = import.meta.env.BASE_URL + 'service-page.css';
    link.dataset.pageStyle = 'service';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  return <RawPage html={html} bodyClass={bodyClass} script="/service-page.js" />;
}
