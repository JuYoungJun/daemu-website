import { Navigate } from 'react-router-dom';
import { Auth } from '../lib/auth.js';

export default function RequireAuth({ children }) {
  if (!Auth.isLoggedIn()) return <Navigate to="/admin" replace />;
  return children;
}
