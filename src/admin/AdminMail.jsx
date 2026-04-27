import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-mail.html.js';

export default function AdminMail() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-mail-page.js" />
    </AdminShell>
  );
}
