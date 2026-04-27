import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-popup.html.js';

export default function AdminPopup() {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/admin-popup-page.css';
    link.dataset.pageStyle = 'admin-popup';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  return (
    <AdminShell>
      <RawPage html={html} script="/admin-popup-page.js" />
    </AdminShell>
  );
}
