import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import { GuideButton, RawPageCsvButton, PartnersGuide } from './PageGuides.jsx';
import html from './raw/admin-partners.html.js';

const PARTNERS_CSV_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'name', label: '회사명' },
  { key: 'person', label: '담당자' },
  { key: 'phone', label: '연락처' },
  { key: 'email', label: '이메일' },
  { key: 'type', label: '업종' },
  { key: 'role', label: '권한' },
  { key: (r) => (r.active === 'inactive' ? '비활성' : '활성'), label: '상태' },
  { key: 'note', label: '메모' },
  { key: 'date', label: '등록일' },
];

export default function AdminPartners() {
  return (
    <AdminShell>
      <GuideButton GuideComponent={PartnersGuide} />
      <RawPageCsvButton storageKey="partners" filename="daemu-partners" columns={PARTNERS_CSV_COLUMNS} />
      <RawPage html={html} script="/admin-partners-page.js" />
    </AdminShell>
  );
}
