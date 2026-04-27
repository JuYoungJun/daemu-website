import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect } from 'react';
import { initAnalytics, trackPageview } from './lib/analytics.js';

import PublicLayout from './components/PublicLayout.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import LinkInterceptor from './components/LinkInterceptor.jsx';
import Splash from './components/Splash.jsx';
import DialogHost from './components/DialogHost.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { useSplash } from './hooks/useSplash.js';
import { useSitePopups } from './hooks/useSitePopups.js';

// Error pages
import NotFound from './pages/errors/NotFound.jsx';
import Forbidden from './pages/errors/Forbidden.jsx';
import Maintenance from './pages/errors/Maintenance.jsx';
import BadRequest from './pages/errors/BadRequest.jsx';
import ServerError from './pages/errors/ServerError.jsx';

// Public pages
import Home from './pages/Home.jsx';
import About from './pages/About.jsx';
import Service from './pages/Service.jsx';
import Team from './pages/Team.jsx';
import Process from './pages/Process.jsx';
import Work from './pages/Work.jsx';
import WorkDetail from './pages/WorkDetail.jsx';
import Contact from './pages/Contact.jsx';
import Partners from './pages/Partners.jsx';
import Privacy from './pages/Privacy.jsx';

// Admin pages
import AdminGate from './admin/AdminGate.jsx';
import AdminWorks from './admin/AdminWorks.jsx';
import AdminInquiries from './admin/AdminInquiries.jsx';
import AdminPartners from './admin/AdminPartners.jsx';
import AdminOrders from './admin/AdminOrders.jsx';
import AdminContent from './admin/AdminContent.jsx';
import AdminStats from './admin/AdminStats.jsx';
import AdminMedia from './admin/AdminMedia.jsx';
import AdminMail from './admin/AdminMail.jsx';
import AdminCRM from './admin/AdminCRM.jsx';
import AdminCampaign from './admin/AdminCampaign.jsx';
import AdminPromotion from './admin/AdminPromotion.jsx';
import AdminPopup from './admin/AdminPopup.jsx';
import AdminOutbox from './admin/AdminOutbox.jsx';
import AdminUsers from './admin/AdminUsers.jsx';

const PUBLIC_PAGE_KEYS = {
  '/': 'home', '/about': 'about', '/service': 'service',
  '/team': 'team', '/process': 'process', '/work': 'work',
  '/contact': 'contact', '/partners': 'partners', '/privacy': 'privacy'
};

function isAdminPath(pathname) {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function isKnownPath(pathname) {
  if (PUBLIC_PAGE_KEYS[pathname]) return true;
  if (pathname.startsWith('/work/')) return true;
  if (isAdminPath(pathname)) return true;
  return false;
}

function isErrorPath(pathname) {
  return pathname.startsWith('/error/') || !isKnownPath(pathname);
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function AnalyticsBoot() {
  const { pathname } = useLocation();
  useEffect(() => { initAnalytics(); }, []);
  useEffect(() => { trackPageview(); }, [pathname]);
  return null;
}

function PublicRoute({ children, pageKey }) {
  return <PublicLayout pageKey={pageKey}>{children}</PublicLayout>;
}

export default function App() {
  const location = useLocation();
  const isAdmin = isAdminPath(location.pathname);
  const isError = isErrorPath(location.pathname);
  const showSplash = useSplash(location.pathname, isAdmin || isError);

  // Body class management — useLayoutEffect runs synchronously before paint
  // so admin/error pages never flash with splash-pending visibility:hidden hiding
  // their content.
  useLayoutEffect(() => {
    if (isAdmin || isError) {
      document.body.dataset.page = isAdmin ? 'admin' : 'error';
      document.documentElement.classList.remove('splash-lock');
      document.body.classList.remove('splash-pending');
      document.body.classList.add('splash-ready');
      return;
    }
    const key = PUBLIC_PAGE_KEYS[location.pathname]
      || (location.pathname.startsWith('/work/') ? 'work' : 'home');
    document.body.dataset.page = key;

    if (showSplash) {
      document.documentElement.classList.add('splash-lock');
      document.body.classList.add('splash-pending');
      document.body.classList.remove('splash-ready');
    } else {
      document.documentElement.classList.remove('splash-lock');
      document.body.classList.remove('splash-pending');
      document.body.classList.add('splash-ready');
    }
  }, [showSplash, isAdmin, location.pathname]);

  // Popups — only run on public pages, after splash
  const popupKey = (!isAdmin && !isError && !showSplash)
    ? (PUBLIC_PAGE_KEYS[location.pathname] || (location.pathname.startsWith('/work/') ? 'work' : 'home'))
    : null;
  useSitePopups(popupKey);

  return (
    <ErrorBoundary>
      <ScrollToTop />
      <AnalyticsBoot />
      <LinkInterceptor />
      <DialogHost />
      <Splash key={(isAdmin || isError) ? 'no-splash-zone' : 'public-zone'} show={showSplash && !isAdmin && !isError} />
      <Routes>
        <Route path="/" element={<PublicRoute pageKey="home"><Home /></PublicRoute>} />
        <Route path="/about" element={<PublicRoute pageKey="about"><About /></PublicRoute>} />
        <Route path="/service" element={<PublicRoute pageKey="service"><Service /></PublicRoute>} />
        <Route path="/team" element={<PublicRoute pageKey="team"><Team /></PublicRoute>} />
        <Route path="/process" element={<PublicRoute pageKey="process"><Process /></PublicRoute>} />
        <Route path="/work" element={<PublicRoute pageKey="work"><Work /></PublicRoute>} />
        <Route path="/work/:slug" element={<PublicRoute pageKey="work"><WorkDetail /></PublicRoute>} />
        <Route path="/contact" element={<PublicRoute pageKey="contact"><Contact /></PublicRoute>} />
        <Route path="/partners" element={<PublicRoute pageKey="partners"><Partners /></PublicRoute>} />
        <Route path="/privacy" element={<PublicRoute pageKey="privacy"><Privacy /></PublicRoute>} />

        <Route path="/admin" element={<AdminGate />} />
        <Route path="/admin/works" element={<RequireAuth><AdminWorks /></RequireAuth>} />
        <Route path="/admin/inquiries" element={<RequireAuth><AdminInquiries /></RequireAuth>} />
        <Route path="/admin/partners" element={<RequireAuth><AdminPartners /></RequireAuth>} />
        <Route path="/admin/orders" element={<RequireAuth><AdminOrders /></RequireAuth>} />
        <Route path="/admin/content" element={<RequireAuth><AdminContent /></RequireAuth>} />
        <Route path="/admin/stats" element={<RequireAuth><AdminStats /></RequireAuth>} />
        <Route path="/admin/media" element={<RequireAuth><AdminMedia /></RequireAuth>} />
        <Route path="/admin/mail" element={<RequireAuth><AdminMail /></RequireAuth>} />
        <Route path="/admin/crm" element={<RequireAuth><AdminCRM /></RequireAuth>} />
        <Route path="/admin/campaign" element={<RequireAuth><AdminCampaign /></RequireAuth>} />
        <Route path="/admin/promotion" element={<RequireAuth><AdminPromotion /></RequireAuth>} />
        <Route path="/admin/popup" element={<RequireAuth><AdminPopup /></RequireAuth>} />
        <Route path="/admin/outbox" element={<RequireAuth><AdminOutbox /></RequireAuth>} />
        <Route path="/admin/users" element={<RequireAuth><AdminUsers /></RequireAuth>} />

        {/* Error showcase routes — accessible directly for QA + linkable from CTA */}
        <Route path="/error/400" element={<BadRequest />} />
        <Route path="/error/403" element={<Forbidden />} />
        <Route path="/error/500" element={<ServerError />} />
        <Route path="/error/503" element={<Maintenance />} />

        {/* Catch-all 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  );
}
