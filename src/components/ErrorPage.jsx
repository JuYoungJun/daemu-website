import { useNavigate } from 'react-router-dom';
import '../styles/errors.css';
import { useSeo } from '../hooks/useSeo.js';

export default function ErrorPage({
  code = '500',
  title = '잠시 문제가 발생했어요',
  message = '예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
  illustration = null,
  primaryAction,
  meta,
}) {
  const navigate = useNavigate();

  // R-01 fix: useSeo() handles document.title via setSeo. The previous
  // manual useEffect was overwriting it, leaving the wrong title on every
  // error page. Single source of truth is now useSeo.
  useSeo({
    title: `${code}`,
    description: message,
    noindex: true,
  });

  const goHome = () => navigate('/');
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate('/');
  };

  return (
    <main className="err-page" role="main" aria-labelledby="err-code">
      <div className="err-stage" aria-hidden="true">
        {illustration}
        <span className="err-ground" />
      </div>

      <h1 id="err-code" className="err-code">{code}</h1>
      <p className="err-title">{title}</p>
      <p className="err-message">{message}</p>

      <div className="err-actions">
        {primaryAction || (
          <button type="button" className="err-btn" onClick={goHome}>
            홈으로 돌아가기
          </button>
        )}
        <button type="button" className="err-btn ghost" onClick={goBack}>
          이전 페이지
        </button>
      </div>

      <p className="err-meta">{meta || `Error · ${code}`}</p>
    </main>
  );
}
