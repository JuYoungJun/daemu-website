import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-inquiries.html.js';

export default function AdminInquiries() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-inquiries-page.js" />
    </AdminShell>
  );
}
