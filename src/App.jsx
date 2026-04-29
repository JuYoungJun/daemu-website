import { Routes, Route, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect, useRef, lazy, Suspense } from 'react';
import { initAnalytics, trackPageview } from './lib/analytics.js';
import { installMarketingAnalytics } from './lib/marketingAnalytics.js';
import { Auth } from './lib/auth.js';

import PublicLayout from './components/PublicLayout.jsx';
import RequireAuth from './components/RequireAuth.jsx';
import LinkInterceptor from './components/LinkInterceptor.jsx';
import Splash from './components/Splash.jsx';
import DialogHost from './components/DialogHost.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import CookieConsent from './components/CookieConsent.jsx';
import SitePopupOverlay from './components/SitePopupOverlay.jsx';
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
import Unsubscribe from './pages/Unsubscribe.jsx';

// 어드민 페이지 — React.lazy 로 code-split. 일반 방문자는 이 chunk 들을
// 다운받지 않고, /admin/* 진입 시 처음으로 요청한다.
//
// lazyWithReload: 새 빌드가 deploy 되면 옛 chunk URL 의 hash 가 바뀌어
// 이미 로드돼 있던 메인 번들이 옛 chunk 를 fetch 하다 404 가 난다. 그
// 결과 ErrorBoundary 가 ServerError(500) 를 띄우게 되는데, 사용자 입장
// 에서는 "어드민 페이지가 500 만 뜬다" 로 보인다. dynamic import 가 실패
// 하면 sessionStorage one-shot marker 로 한 번만 자동 reload 해서 새
// chunk hash 를 받아오도록 한다(무한 루프 방지).
const lazyWithReload = (importer) => lazy(() =>
  importer().catch((err) => {
    const msg = String(err?.message || err || '');
    const isChunkFail = /chunk|Failed to fetch dynamically|Loading.*chunk|Importing a module script failed/i.test(msg);
    if (isChunkFail && typeof window !== 'undefined') {
      try {
        const KEY = 'daemu_chunk_reload_ts';
        const last = Number(sessionStorage.getItem(KEY) || 0);
        // 1분 안에 한 번만 reload — 같은 세션에서 무한 루프 방지.
        if (!last || Date.now() - last > 60_000) {
          sessionStorage.setItem(KEY, String(Date.now()));
          window.location.reload();
          return new Promise(() => {}); // hang until reload
        }
      } catch { /* ignore */ }
    }
    throw err;
  })
);
const AdminGate = lazyWithReload(() => import('./admin/AdminGate.jsx'));
const AdminWorks = lazyWithReload(() => import('./admin/AdminWorks.jsx'));
const AdminInquiries = lazyWithReload(() => import('./admin/AdminInquiries.jsx'));
const AdminPartners = lazyWithReload(() => import('./admin/AdminPartners.jsx'));
const AdminOrders = lazyWithReload(() => import('./admin/AdminOrders.jsx'));
const AdminContent = lazyWithReload(() => import('./admin/AdminContent.jsx'));
const AdminStats = lazyWithReload(() => import('./admin/AdminStats.jsx'));
const AdminMedia = lazyWithReload(() => import('./admin/AdminMedia.jsx'));
const AdminMail = lazyWithReload(() => import('./admin/AdminMail.jsx'));
const AdminCRM = lazyWithReload(() => import('./admin/AdminCRM.jsx'));
const AdminCampaign = lazyWithReload(() => import('./admin/AdminCampaign.jsx'));
const AdminPromotion = lazyWithReload(() => import('./admin/AdminPromotion.jsx'));
const AdminPopup = lazyWithReload(() => import('./admin/AdminPopup.jsx'));
const AdminOutbox = lazyWithReload(() => import('./admin/AdminOutbox.jsx'));
const AdminMonitoring = lazyWithReload(() => import('./admin/AdminMonitoring.jsx'));
const AdminContracts = lazyWithReload(() => import('./admin/AdminContracts.jsx'));
const AdminProducts = lazyWithReload(() => import('./admin/AdminProducts.jsx'));
const AdminAnalytics = lazyWithReload(() => import('./admin/AdminAnalytics.jsx'));
const AdminUsers = lazyWithReload(() => import('./admin/AdminUsers.jsx'));
const AdminPartnerBrands = lazyWithReload(() => import('./admin/AdminPartnerBrands.jsx'));
const AdminMailTemplates = lazyWithReload(() => import('./admin/AdminMailTemplates.jsx'));
const AdminUtmBuilder = lazyWithReload(() => import('./admin/AdminUtmBuilder.jsx'));
const AdminApiDocs = lazyWithReload(() => import('./admin/AdminApiDocs.jsx'));
const SignDocument = lazyWithReload(() => import('./pages/SignDocument.jsx'));

const AdminFallback = () => (
  <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5f5b57', fontSize: 13 }}>
    어드민 페이지 로딩 중…
  </div>
);
const wrap = (el) => <Suspense fallback={<AdminFallback />}>{el}</Suspense>;

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
  if (pathname.startsWith('/sign/')) return true;
  if (pathname === '/unsubscribe') return true;
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
  useEffect(() => {
    initAnalytics();
    // admin 영역에서는 자체 마케팅 분석 비활성화 (관리 행동 노이즈 방지)
    if (!pathname.startsWith('/admin') && !pathname.startsWith('/sign')) {
      installMarketingAnalytics();
    }
  }, []);
  useEffect(() => { trackPageview(); }, [pathname]);
  return null;
}

// Admin session policy:
//   · Logged-in admin stays logged in across reloads, tab restores,
//     and admin↔admin navigation (covers the "back button" case the
//     owner reported).
//   · Leaving the admin tree to a public page (/, /work, /contact,
//     /sign/...) wipes the session — opening /admin again requires
//     re-login.
//   · 60-minute inactivity timeout (lib/auth.js) covers the "stepped
//     away from desk" case.
//
// Implementation notes:
//   · Only one location-watcher at the App root; per-route RequireAuth
//     no longer mutates Auth state on unmount, so admin-page navigation
//     never accidentally clears the token.
//   · We deliberately do NOT install a `beforeunload` handler — that
//     was the bug that was wiping the session on F5 / hard reload.
function AdminSessionGuard() {
  const { pathname } = useLocation();
  const prevAdmin = useRef(pathname.startsWith('/admin'));
  useEffect(() => {
    const nowAdmin = pathname.startsWith('/admin');
    if (prevAdmin.current && !nowAdmin) {
      Auth.logout();
    }
    prevAdmin.current = nowAdmin;
  }, [pathname]);
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
  const popup = useSitePopups(popupKey);

  return (
    <ErrorBoundary>
      <ScrollToTop />
      <AnalyticsBoot />
      <AdminSessionGuard />
      <LinkInterceptor />
      <DialogHost />
      <CookieConsent />
      {popup && <SitePopupOverlay popup={popup} />}
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
        <Route path="/unsubscribe" element={<Unsubscribe />} />

        <Route path="/admin" element={wrap(<AdminGate />)} />
        <Route path="/admin/works" element={wrap(<RequireAuth><AdminWorks /></RequireAuth>)} />
        <Route path="/admin/inquiries" element={wrap(<RequireAuth><AdminInquiries /></RequireAuth>)} />
        <Route path="/admin/partners" element={wrap(<RequireAuth><AdminPartners /></RequireAuth>)} />
        <Route path="/admin/orders" element={wrap(<RequireAuth><AdminOrders /></RequireAuth>)} />
        <Route path="/admin/content" element={wrap(<RequireAuth><AdminContent /></RequireAuth>)} />
        <Route path="/admin/stats" element={wrap(<RequireAuth><AdminStats /></RequireAuth>)} />
        <Route path="/admin/media" element={wrap(<RequireAuth><AdminMedia /></RequireAuth>)} />
        <Route path="/admin/mail" element={wrap(<RequireAuth><AdminMail /></RequireAuth>)} />
        <Route path="/admin/crm" element={wrap(<RequireAuth><AdminCRM /></RequireAuth>)} />
        <Route path="/admin/campaign" element={wrap(<RequireAuth><AdminCampaign /></RequireAuth>)} />
        <Route path="/admin/promotion" element={wrap(<RequireAuth><AdminPromotion /></RequireAuth>)} />
        <Route path="/admin/popup" element={wrap(<RequireAuth><AdminPopup /></RequireAuth>)} />
        <Route path="/admin/outbox" element={wrap(<RequireAuth><AdminOutbox /></RequireAuth>)} />
        <Route path="/admin/monitoring" element={wrap(<RequireAuth><AdminMonitoring /></RequireAuth>)} />
        <Route path="/admin/contracts" element={wrap(<RequireAuth><AdminContracts /></RequireAuth>)} />
        <Route path="/admin/products" element={wrap(<RequireAuth><AdminProducts /></RequireAuth>)} />
        <Route path="/admin/analytics" element={wrap(<RequireAuth><AdminAnalytics /></RequireAuth>)} />
        <Route path="/admin/users" element={wrap(<RequireAuth><AdminUsers /></RequireAuth>)} />
        <Route path="/admin/partner-brands" element={wrap(<RequireAuth><AdminPartnerBrands /></RequireAuth>)} />
        <Route path="/admin/mail-templates" element={wrap(<RequireAuth><AdminMailTemplates /></RequireAuth>)} />
        <Route path="/admin/utm-builder" element={wrap(<RequireAuth><AdminUtmBuilder /></RequireAuth>)} />
        <Route path="/admin/api-docs" element={wrap(<RequireAuth><AdminApiDocs /></RequireAuth>)} />

        {/* Public e-sign page — no auth, sign_token in path. */}
        <Route path="/sign/:token" element={wrap(<SignDocument />)} />

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
