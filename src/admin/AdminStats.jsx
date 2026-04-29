import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import { GuideButton, StatsGuide } from './PageGuides.jsx';
import html from './raw/admin-stats.html.js';

export default function AdminStats() {
  return (
    <AdminShell>
      <GuideButton GuideComponent={StatsGuide} />
      <RawPage html={html} script="/admin-stats-page.js" />
    </AdminShell>
  );
}
