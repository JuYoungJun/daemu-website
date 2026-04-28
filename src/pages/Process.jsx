import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/process.html.js';
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd, howToLd } from '../lib/seo.js';

const PROCESS_STEPS = [
  { name: '01. 사전 상담', text: '브랜드 비전, 매장 위치, 예산, 타깃 고객을 정리하고 프로젝트 범위를 확정합니다.' },
  { name: '02. 시장 분석', text: '경쟁 매장·상권·타깃 인구 통계를 분석해 포지셔닝 전략을 수립합니다.' },
  { name: '03. 브랜드 전략', text: '브랜드 미션·톤·핵심 메시지를 정의하고 비주얼 시스템 방향을 결정합니다.' },
  { name: '04. 메뉴 R&D', text: '베이커리·음료·디저트 메뉴를 시제품 개발부터 SOP 문서화까지 진행합니다.' },
  { name: '05. 공간 설계', text: '동선·매대·홀 비율·키친 워크플로우를 매장 평수·운영 인원에 맞춰 설계합니다.' },
  { name: '06. 인테리어 협력 시공', text: '대무가 신뢰하는 시공 파트너와 협력해 디자인 의도가 그대로 매장에 반영되도록 감리합니다.' },
  { name: '07. 장비·납품', text: '오븐·에스프레소·POS·가구 등 운영에 필요한 모든 장비를 일괄 조달합니다.' },
  { name: '08. 운영 매뉴얼', text: '서비스 SOP, 위생 관리, 발주 주기, 인력 운영을 한 권의 매뉴얼로 정리합니다.' },
  { name: '09. 오픈 지원', text: '소프트 오픈부터 정식 개점까지 현장 지원 + 초기 마케팅 캠페인을 함께 운영합니다.' },
  { name: '10. 사후 운영 점검', text: '오픈 후 30일·90일·180일 시점에 매출·재구매·피드백을 점검하고 운영 구조를 재조정합니다.' },
];

export default function Process() {
  useSeo({
    title: '프로세스 — 초기 상담부터 운영까지 10단계',
    description: '대무의 10단계 카페 컨설팅 프로세스. 일반 컨설팅의 사진 미팅 → 인테리어 시공 → 장비 납품 한계를 넘어, 전략·메뉴·브랜드·공간·운영을 하나의 통합 구조로 연결합니다.',
    path: '/process',
    keywords: '카페 컨설팅 프로세스, 베이커리 창업 단계, 카페 오픈 절차, 매장 운영 프로세스, 카페 창업 10단계',
    jsonLd: [
      breadcrumbLd([{ name: '홈', path: '/' }, { name: 'Process', path: '/process' }]),
      howToLd(
        '카페·베이커리 창업 컨설팅 10단계',
        '사전 상담부터 오픈 후 사후 점검까지, 대무가 진행하는 10단계 카페·베이커리 창업 컨설팅 프로세스.',
        PROCESS_STEPS,
      ),
    ],
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
