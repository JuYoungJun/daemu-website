import ErrorPage from '../../components/ErrorPage.jsx';
import { CroissantRolling } from '../../components/errorIllustrations.jsx';

export default function NotFound() {
  return (
    <ErrorPage
      code="404"
      title="페이지를 찾을 수 없어요"
      message="크루아상이 길을 잘못 들었나봐요. 입력하신 주소가 변경되었거나 더 이상 존재하지 않는 페이지일 수 있습니다."
      illustration={<CroissantRolling />}
      meta="Page Not Found · 404"
    />
  );
}
