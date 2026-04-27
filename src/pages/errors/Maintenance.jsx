import ErrorPage from '../../components/ErrorPage.jsx';
import { BreadRising } from '../../components/errorIllustrations.jsx';

export default function Maintenance() {
  return (
    <ErrorPage
      code="503"
      title="잠시 베이킹 중입니다"
      message="더 좋은 결과물을 준비하느라 잠깐 자리를 비웠어요. 곧 따끈한 페이지로 돌아올게요."
      illustration={<BreadRising />}
      meta="Service Unavailable · 503"
    />
  );
}
