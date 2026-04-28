import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/service.html.js';
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd, serviceLd } from '../lib/seo.js';

const SERVICE_STAGES = [
  { name: 'Strategy 컨설팅', desc: '시장 분석과 브랜드 포지셔닝을 기반으로 카페 비즈니스의 방향을 설계합니다.', type: 'BusinessConsulting' },
  { name: 'Product 메뉴 개발', desc: '베이커리·음료·디저트 메뉴를 R&D부터 SOP 문서화까지 일괄 개발합니다.', type: 'MenuDevelopment' },
  { name: 'Brand 브랜딩', desc: '로고·톤 앤 보이스·비주얼 시스템을 일관되게 구축합니다.', type: 'BrandConsulting' },
  { name: 'Space 공간 설계', desc: '고객 동선과 운영 효율을 고려해 매장 공간을 기획·설계합니다.', type: 'InteriorDesign' },
  { name: 'Operation 매장 운영', desc: '오픈 이후 운영 구조와 매뉴얼을 정비하여 지속 가능한 매장을 만듭니다.', type: 'OperationsConsulting' },
];

export default function Service() {
  useSeo({
    title: '서비스 — Strategy · Product · Brand · Space · Operation',
    description: '대무의 5단계 컨설팅 서비스: 시장 분석부터 매장 운영까지. 카페·베이커리 비즈니스가 필요로 하는 모든 단계를 한 팀이 책임집니다.',
    path: '/service',
    keywords: '카페 컨설팅 서비스, 베이커리 컨설팅 단계, 메뉴 개발 서비스, 카페 브랜딩, 매장 공간 설계, 카페 운영 컨설팅',
    jsonLd: [
      breadcrumbLd([{ name: '홈', path: '/' }, { name: 'Service', path: '/service' }]),
      ...SERVICE_STAGES.map((s) => serviceLd(s.name, s.desc, s.type)),
    ],
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
