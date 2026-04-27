import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const ADMIN_MAP = {
  'admin.html': '/admin',
  'admin-works.html': '/admin/works',
  'admin-inquiries.html': '/admin/inquiries',
  'admin-partners.html': '/admin/partners',
  'admin-orders.html': '/admin/orders',
  'admin-content.html': '/admin/content',
  'admin-stats.html': '/admin/stats',
  'admin-media.html': '/admin/media',
  'admin-mail.html': '/admin/mail',
  'admin-crm.html': '/admin/crm',
  'admin-campaign.html': '/admin/campaign',
  'admin-promotion.html': '/admin/promotion',
  'admin-popup.html': '/admin/popup'
};

function mapLegacy(href) {
  if (href === 'index.html' || href === '/index.html') return '/';
  if (href === 'work-beclassy.html') return '/work/beclassy-naju';
  if (href.startsWith('work-detail.html')) {
    try {
      const u = new URL(href, window.location.origin);
      const slug = u.searchParams.get('project') || u.searchParams.get('slug') || '';
      return slug ? '/work/' + slug : '/work';
    } catch (e) { return '/work'; }
  }
  if (ADMIN_MAP[href]) return ADMIN_MAP[href];
  if (href.endsWith('.html')) {
    const m = href.match(/^([a-z-]+)\.html$/);
    if (m) return '/' + m[1];
  }
  return null;
}

// Global click interceptor — converts legacy .html links to SPA navigation.
export default function LinkInterceptor() {
  const navigate = useNavigate();
  useEffect(() => {
    const onClick = (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      const raw = a.getAttribute('href') || '';
      if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) return;
      if (raw.startsWith('http://') || raw.startsWith('https://')) return;
      if (a.target && a.target !== '_self') return;
      const route = mapLegacy(raw);
      if (!route) return;
      e.preventDefault();
      navigate(route);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [navigate]);
  return null;
}
