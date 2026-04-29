import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import { GuideButton, ContentGuide } from './PageGuides.jsx';
import html from './raw/admin-content.html.js';

export default function AdminContent() {
  return (
    <AdminShell>
      <GuideButton GuideComponent={ContentGuide} />
      <RawPage html={html} script="/admin-content-page.js" />
    </AdminShell>
  );
}
