import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import { PageActions, GuideButton, ContentGuide } from './PageGuides.jsx';
import html from './raw/admin-content.html.js';

export default function AdminContent() {
  return (
    <AdminShell>
      <PageActions>
        <GuideButton GuideComponent={ContentGuide} />
      </PageActions>
      <RawPage html={html} script="/admin-content-page.js" />
    </AdminShell>
  );
}
