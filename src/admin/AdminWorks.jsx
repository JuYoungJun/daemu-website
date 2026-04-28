import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import AdminHelp from '../components/AdminHelp.jsx';
import html from './raw/admin-works.html.js';

export default function AdminWorks() {
  return (
    <AdminShell>
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
