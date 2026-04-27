import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-partners.html.js';

export default function AdminPartners() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-partners-page.js" />
    </AdminShell>
  );
}
