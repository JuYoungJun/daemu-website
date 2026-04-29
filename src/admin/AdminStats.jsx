import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import { PageActions, GuideButton, StatsGuide } from './PageGuides.jsx';
import html from './raw/admin-stats.html.js';

export default function AdminStats() {
  return (
    <AdminShell>
      <PageActions>
        <GuideButton GuideComponent={StatsGuide} />
      </PageActions>
      <RawPage html={html} script="/admin-stats-page.js" />
    </AdminShell>
  );
}
