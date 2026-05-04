import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { PageActions, GuideButton, RawPageCsvButton, WorksGuide } from './PageGuides.jsx';
import html from './raw/admin-works.html.js';

// CSV 컬럼은 backend Work shape 와 raw page (admin-works-page.js) 의 admin
// shape 둘 다 fallback. backend 빈 응답 + cached fallback 시 어느 source 든
// 빈 칸 최소화.
//   backend shape: id / slug / title / category / summary / hero_image_url /
//                  sort_order / published / created_at
//   admin SEED:    brand / name / slug / brandLine / overview / hero / status / year
const WORKS_CSV_COLUMNS = [
  { key: (r) => r.id ?? '', label: 'ID' },
  { key: (r) => r.slug || '', label: 'slug' },
  { key: (r) => r.name || r.title || r.brand || '', label: '제목' },
  { key: (r) => r.category || r.brandLine || r.brand || '', label: '카테고리' },
  { key: (r) => r.summary || r.overview || '', label: '요약' },
  { key: (r) => r.hero_image_url || r.hero || r.image || '', label: '히어로이미지' },
  { key: (r) => r.sort_order ?? '', label: '정렬순서' },
  { key: (r) => (r.published === true ? '게시' : (r.published === false ? '숨김' : (r.status || ''))), label: '상태' },
  { key: (r) => r.created_at || r.date || r.year || '', label: '등록일' },
];

export default function AdminWorks() {
  return (
    <AdminShell>
      <PageActions>
        {/* storageKey 는 raw page (admin-works-page.js) 의 STORAGE_KEY="projects"
            와 일치해야 backend 빈 응답 시 cached fallback 이 같은 localStorage
            슬롯을 읽음. 옛 코드는 'works' 로 mismatch 였음 → 0행 CSV 회귀. */}
        <RawPageCsvButton storageKey="projects" apiPath="/api/works?page_size=500" filename="daemu-works" columns={WORKS_CSV_COLUMNS} />
        <GuideButton GuideComponent={WorksGuide} />
      </PageActions>
      <AdminHelp title="작업사례 관리 사용 안내" items={[
        '신규 등록: "작업사례 등록" → 슬러그(영문 URL), 제목, 카테고리, 요약, 갤러리 이미지 입력.',
        '브랜드 자유 입력: 브랜드 항목에서 "직접 입력"을 선택하면 새 브랜드명을 입력할 수 있습니다.',
        '게시 상태: "게시"로 설정한 사례만 사용자 Work 페이지에 표시됩니다.',
        '정렬: sort_order 값이 낮을수록 먼저 표시됩니다. 동일 값일 경우 최신순.',
      ]} />
      <RawPage html={html} script="/admin-works-page.js" />
    </AdminShell>
  );
}
