import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-campaign.html.js';

export default function AdminCampaign() {
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-campaign-page.js" />
    </AdminShell>
  );
}
