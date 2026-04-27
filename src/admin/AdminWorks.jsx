import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-works.html.js';

export default function AdminWorks() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-works-page.js" />
    </AdminShell>
  );
}
