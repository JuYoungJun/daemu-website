import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-crm.html.js';

export default function AdminCRM() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-crm-page.js" />
    </AdminShell>
  );
}
