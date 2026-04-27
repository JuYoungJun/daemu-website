import ErrorPage from '../../components/ErrorPage.jsx';
import { ShopClosed } from '../../components/errorIllustrations.jsx';

export default function Forbidden() {
  return (
    <ErrorPage
      code="403"
      title="접근 권한이 필요해요"
      message="이 페이지는 관리자 전용 공간입니다. 로그인 후 다시 접속해 주세요."
      illustration={<ShopClosed />}
      meta="Forbidden · 403"
    />
  );
}
