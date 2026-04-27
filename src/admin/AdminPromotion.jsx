import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-promotion.html.js';

export default function AdminPromotion() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-promotion-page.js" />
    </AdminShell>
  );
}
