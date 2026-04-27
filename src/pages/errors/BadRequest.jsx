import ErrorPage from '../../components/ErrorPage.jsx';
import { CoffeeSpill } from '../../components/errorIllustrations.jsx';

export default function BadRequest() {
  return (
    <ErrorPage
      code="400"
      title="요청을 이해하지 못했어요"
      message="입력하신 내용에 문제가 있어 페이지를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요."
      illustration={<CoffeeSpill />}
      meta="Bad Request · 400"
    />
  );
}
