import { useEffect } from 'react';

// 어드민 셸 — 페이지 단위 boilerplate.
// CSV 내보내기는 각 페이지의 PageActions 컴포넌트(src/admin/PageGuides.jsx)
// 가 담당하므로 본 셸은 body data-page 만 설정하고 children 을 그대로 렌더한다.
// 이전 버전의 adm-export-fab(우하단 floating 버튼)은 PageActions 와 중복되어
// 제거됨.
export default function AdminShell({ children }) {
  useEffect(() => {
    document.body.dataset.page = 'admin';
    document.body.classList.remove('splash-pending');
    document.body.classList.add('splash-ready');
    return () => { delete document.body.dataset.page; };
  }, []);

  return <>{children}</>;
}
