import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import AdminShell from '../components/AdminShell.jsx';
import html from './raw/admin-inquiries.html.js';
import { api } from '../lib/api.js';

// Pulls server-side inquiries (when backend configured) and merges them into
// the localStorage 'daemu_inquiries' bucket so the existing inquiries-page.js
// script renders both server + local entries seamlessly.
async function syncFromBackend() {
  if (!api.isConfigured()) return;
  const r = await api.get('/api/inquiries?page=1&page_size=200');
  if (!r.ok || !Array.isArray(r.items)) return;
  const remote = r.items.map((it) => ({
    id: `srv-${it.id}`,
    serverId: it.id,
    name: it.name,
    email: it.email,
    phone: it.phone || '',
    brand: it.brand_name || '',
    region: it.location || '',
    open: it.expected_open || '',
    type: it.category || '상담 문의',
    msg: it.message || '',
    status: it.status || '신규',
    createdAt: it.created_at,
    note: it.note || '',
    source: 'server',
  }));
  let local = [];
  try { local = JSON.parse(localStorage.getItem('daemu_inquiries') || '[]'); } catch {}
  const localOnly = local.filter((x) => !x.serverId);
  const merged = [...remote, ...localOnly]
    .sort((a, b) => String(b.createdAt || b.id).localeCompare(String(a.createdAt || a.id)));
  localStorage.setItem('daemu_inquiries', JSON.stringify(merged));
  window.dispatchEvent(new Event('daemu-db-change'));
}

export default function AdminInquiries() {
  useEffect(() => {
    syncFromBackend().catch(() => { /* silent */ });
  }, []);
  return (
    <AdminShell>
      <RawPage html={html} script="/admin-inquiries-page.js" />
    </AdminShell>
  );
}
