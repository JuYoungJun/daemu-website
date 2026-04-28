import { Navigate, useLocation } from 'react-router-dom';
import { Auth } from '../lib/auth.js';

// Per-route gate.
//   · Auth.isLoggedIn() also runs the inactivity-timeout check internally.
//   · Login page lives at /admin (not a sub-route), so any unauthenticated
//     visit to /admin/<anything> bounces back to /admin where AdminGate
//     renders the login form. The original target path is preserved in
//     Navigate state so we can offer "send me back where I was" later.
//   · Optional `roles` prop limits access to specific roles. If the user is
//     authenticated but lacks the role, we route them to the dashboard
//     rather than the login form (clearer feedback).
export default function RequireAuth({ children, roles }) {
  const loc = useLocation();
  if (!Auth.isLoggedIn()) {
    return <Navigate to="/admin" replace state={{ from: loc.pathname }} />;
  }
  if (roles && roles.length) {
    const me = Auth.user();
    if (!me || !roles.includes(me.role)) {
      return <Navigate to="/admin" replace state={{ forbidden: loc.pathname }} />;
    }
  }
  return children;
}
