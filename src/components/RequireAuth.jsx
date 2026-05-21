import { Navigate, useLocation } from 'react-router-dom';
import { Auth } from '../lib/auth.js';
import { PERMISSION_MATRIX } from '../admin/apiDocsData.js';

// Per-route gate.
//   · Auth.isLoggedIn() also runs the inactivity-timeout check internally.
//   · Login page lives at /admin (not a sub-route), so any unauthenticated
//     visit to /admin/<anything> bounces back to /admin where AdminGate
//     renders the login form. The original target path is preserved in
//     Navigate state so we can offer "send me back where I was" later.
//   · Optional `roles` prop limits access to specific roles.
//   · Optional `perm` prop = { resource, action } - looks up the role's
//     entry in PERMISSION_MATRIX. backend 가 require_perm 으로 동일하게
//     보호하지만, client-side 도 강제해야 tester 가 URL 직접 입력해
//     관리자-only 페이지 UI 로 진입하는 회귀 차단 (backend 가 데이터를
//     안 줘도 UI 가 잠깐 노출되면 운영자 인식 오류).
//   The user is bounced to /admin (dashboard) on insufficient permission.
function _canAccess(role, resource, action) {
  const row = PERMISSION_MATRIX.find((r) => r.resource === resource);
  if (!row) return false;
  const level = (row[role] || '').toUpperCase();
  if (level === 'ALL') return true;
  if (level === 'READ' && (action === 'read' || !action)) return true;
  return false;
}

export default function RequireAuth({ children, roles, perm }) {
  const loc = useLocation();
  if (!Auth.isLoggedIn()) {
    return <Navigate to="/admin" replace state={{ from: loc.pathname }} />;
  }
  const me = Auth.user();
  if (roles && roles.length) {
    if (!me || !roles.includes(me.role)) {
      return <Navigate to="/admin" replace state={{ forbidden: loc.pathname }} />;
    }
  }
  if (perm && perm.resource) {
    if (!me || !_canAccess(me.role, perm.resource, perm.action || 'read')) {
      return <Navigate to="/admin" replace state={{ forbidden: loc.pathname }} />;
    }
  }
  return children;
}
