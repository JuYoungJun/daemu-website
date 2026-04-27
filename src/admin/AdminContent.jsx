import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-content.html.js';

export default function AdminContent() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-content-page.js" />
    </AdminShell>
  );
}
