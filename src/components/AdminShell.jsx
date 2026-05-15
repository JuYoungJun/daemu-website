import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Auth } from '../lib/auth.js';

// 어드민 셸 — 페이지 단위 boilerplate.
// CSV 내보내기는 각 페이지의 PageActions 컴포넌트(src/admin/PageGuides.jsx)
// 가 담당하므로 본 셸은 body data-page 만 설정하고 children 을 그대로 렌더한다.
// 또한 어드민 페이지에 머무는 동안 60초 주기로 세션 만료를 자동 감지 —
// JWT exp 또는 60분 inactivity 도달 시 자동으로 로그인 화면으로 이동.
export default function AdminShell({ children }) {
  const navigate = useNavigate();
  useEffect(() => {
    document.body.dataset.page = 'admin';
    document.body.classList.remove('splash-pending');
    document.body.classList.add('splash-ready');
    // 60초 주기로 isLoggedIn() 호출 — 만료 시 내부적으로 logout() 실행되고
    // false 리턴. navigate('/admin') 으로 즉시 로그인 폼으로 전환.
    const id = setInterval(() => {
      if (!Auth.isLoggedIn()) navigate('/admin', { replace: true });
    }, 60 * 1000);
    return () => {
      delete document.body.dataset.page;
      clearInterval(id);
    };
  }, [navigate]);

  return <>{children}</>;
}
