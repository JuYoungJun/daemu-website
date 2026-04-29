import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import { GuideButton, MediaGuide } from './PageGuides.jsx';
import html from './raw/admin-media.html.js';

export default function AdminMedia() {
  return (
    <AdminShell>
      <GuideButton GuideComponent={MediaGuide} />
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
