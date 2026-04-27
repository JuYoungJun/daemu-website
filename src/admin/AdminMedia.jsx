import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-media.html.js';

export default function AdminMedia() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-media-page.js" />
    </AdminShell>
  );
}
