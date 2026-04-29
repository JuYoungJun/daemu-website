import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import { GuideButton, MailGuide } from './PageGuides.jsx';
import html from './raw/admin-mail.html.js';

export default function AdminMail() {
  return (
    <AdminShell>
      <GuideButton GuideComponent={MailGuide} />
      <RawPage html={html} script="/admin-mail-page.js" />
    </AdminShell>
  );
}
