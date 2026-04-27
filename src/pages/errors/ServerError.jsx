import ErrorPage from '../../components/ErrorPage.jsx';
import { OvenSmoking } from '../../components/errorIllustrations.jsx';

export default function ServerError({ resetError }) {
  const tryAgain = (
    <button type="button" className="err-btn" onClick={() => {
      if (typeof resetError === 'function') resetError();
      window.location.reload();
    }}>
      다시 시도
    </button>
  );
  return (
    <ErrorPage
      code="500"
      title="주방에 잠시 문제가 생겼어요"
      message="오븐이 잠깐 멈춘 것 같아요. 잠시 후 다시 시도해 주세요. 같은 문제가 계속되면 daemu_office@naver.com 으로 알려주세요."
      illustration={<OvenSmoking />}
      primaryAction={tryAgain}
      meta="Internal Error · 500"
    />
  );
}
