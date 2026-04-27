import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-stats.html.js';

export default function AdminStats() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-stats-page.js" />
    </AdminShell>
  );
}
