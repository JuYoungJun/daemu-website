import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-orders.html.js';

export default function AdminOrders() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-orders-page.js" />
    </AdminShell>
  );
}
