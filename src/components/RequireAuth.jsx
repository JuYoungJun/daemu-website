import { Navigate, useLocation } from 'react-router-dom';
import { Auth } from '../lib/auth.js';

// Per-route gate. Inactivity timeout is enforced inside Auth.isLoggedIn
// (see lib/auth.js). The "logout when leaving the admin tree" rule lives
// one level up in App.jsx so navigating between admin pages does not log
// the admin out.
export default function RequireAuth({ children }) {
  const loc = useLocation();
  if (!Auth.isLoggedIn()) return <Navigate to="/admin" replace state={{ from: loc.pathname }} />;
  return children;
}
