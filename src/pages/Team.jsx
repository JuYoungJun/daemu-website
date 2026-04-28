import RawPage, { } from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/team.html.js';
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd } from '../lib/seo.js';

export default function Team() {
  useSeo({
    title: '팀 — 다섯 팀이 만드는 하나의 흐름',
    description: '브랜드는 한 사람의 아이디어로 완성되지 않습니다. 전략·메뉴 개발·공간·디자인·운영, 각 분야의 전문가들이 하나의 흐름으로 연결되어 시작부터 운영까지 함께 설계합니다.',
    path: '/team',
    keywords: '대무 팀, 카페 컨설팅 팀, 베이커리 전문가, 카페 컨설턴트',
    jsonLd: [breadcrumbLd([{ name: '홈', path: '/' }, { name: 'Team', path: '/team' }])],
  });
  return (
    <>
      <RawPage html={html} bodyClass={bodyClass} script="/team.js" />
    </>
  );
}
