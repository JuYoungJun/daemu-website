import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { PageActions, GuideButton, RawPageCsvButton, MediaGuide } from './PageGuides.jsx';
import html from './raw/admin-media.html.js';

const MEDIA_CSV_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: '파일명' },
  { key: 'type', label: '타입' },
  { key: (r) => (r.size ? (r.size / 1024).toFixed(1) + ' KB' : ''), label: '크기' },
  { key: (r) => r.url ? '저장됨' : '—', label: '상태' },
  { key: 'uploaded_at', label: '업로드일' },
  { key: 'tag', label: '태그' },
];

export default function AdminMedia() {
  return (
    <AdminShell>
      <PageActions>
        <RawPageCsvButton storageKey="media" filename="daemu-media" columns={MEDIA_CSV_COLUMNS} />
        <GuideButton GuideComponent={MediaGuide} />
      </PageActions>
      <AdminHelp title="미디어 관리 사용 안내" items={[
        '이미지/영상 업로드: "업로드" 버튼 → 파일 선택. 이미지는 자동으로 1600px 이내로 압축됩니다.',
        '재사용: 작업사례·콘텐츠·팝업 등 다른 관리 페이지에서 미디어를 선택할 때 이곳에 저장된 자산이 표시됩니다.',
        '용량 표시: 화면 상단에 이미지·영상·총 용량이 합산되어 보입니다.',
        '안전 규칙: 허용 확장자(jpg/png/webp/mp4/webm)만 업로드 가능, 영상은 50MB·이미지는 5MB로 제한됩니다.',
      ]} />
      <RawPage html={html} script="/admin-media-page.js" />
    </AdminShell>
  );
}
