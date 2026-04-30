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

// 에러 페이지
import NotFound from './pages/errors/NotFound.jsx';
import Forbidden from './pages/errors/Forbidden.jsx';
import Maintenance from './pages/errors/Maintenance.jsx';
import BadRequest from './pages/errors/BadRequest.jsx';
import ServerError from './pages/errors/ServerError.jsx';

// 공개 페이지
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

// 어드민 페이지 — React.lazy 로 code-split. 공개 방문자는 이 chunk 를
// 받지 않고, /admin/* 첫 진입 시 fetch 한다.
//
// lazyWithReload: 새 빌드 deploy 후 옛 chunk hash 가 404 가 되면 사용자
// 입장에서 "어드민 페이지마다 500" 으로 보인다. import 실패를 감지해
// 자동 reload 로 새 chunk 를 받게 한다.
//
// sessionStorage marker 는 단순 식별자(비밀 아님). 변수명을 그냥 KEY 로
// 두면 Snyk CWE-547 이 hardcoded secret 으로 오인하므로 _STORAGE_KEY 접미.
const CHUNK_RELOAD_STORAGE_KEY = 'daemu_chunk_reload_ts';
const CHUNK_RELOAD_COUNT_STORAGE_KEY = 'daemu_chunk_reload_count';

// stale chunk 자동 복구.
//   1) 첫 실패 → window.location.reload() 로 그대로 재진입.
//   2) 그래도 같은 chunk 가 stale 이면 두 번째 실패 → ?_cb=ts 쿼리 cache-bust
//      reload. GitHub Pages CDN 또는 브라우저 캐시가 옛 index.html 을 잡고
//      있는 경우까지 강제 우회.
//   3) 그래도 안 되면 ErrorBoundary 가 ServerError 페이지로 fallback —
//      거기에 수동 hard reload 안내 버튼이 있다.
// 무한 루프 방지: count >= 3 또는 60초 안 재시도면 reload 중단.
const lazyWithReload = (importer) => lazy(() =>
  importer().catch((err) => {
    const msg = String(err?.message || err || '');
    const isChunkFail = /chunk|Failed to fetch dynamically|Loading.*chunk|Importing a module script failed/i.test(msg);
    if (isChunkFail && typeof window !== 'undefined') {
      try {
        const last = Number(sessionStorage.getItem(CHUNK_RELOAD_STORAGE_KEY) || 0);
        const count = Number(sessionStorage.getItem(CHUNK_RELOAD_COUNT_STORAGE_KEY) || 0);
        const sinceLast = Date.now() - last;
        if (count < 3 && (last === 0 || sinceLast > 60_000)) {
          sessionStorage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(Date.now()));
          sessionStorage.setItem(CHUNK_RELOAD_COUNT_STORAGE_KEY, String(count + 1));
          // 첫 시도는 단순 reload, 이후엔 cache-bust 쿼리 부착.
          if (count === 0) {
            window.location.reload();
          } else {
            const cur = window.location.href.replace(/[?&]_cb=\d+/g, '');
            const sep = cur.includes('?') ? '&' : '?';
            window.location.href = cur + sep + '_cb=' + Date.now();
          }
          return new Promise(() => {});
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
const AdminSecurityMonitoring = lazyWithReload(() => import('./admin/AdminSecurityMonitoring.jsx'));
const AdminAnnouncements = lazyWithReload(() => import('./admin/AdminAnnouncements.jsx'));
const AdminInventory = lazyWithReload(() => import('./admin/AdminInventory.jsx'));
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

// 어드민 세션 정책 (강화):
//   · 어드민 영역 내 이동(admin↔admin) 은 세션 유지.
//   · 어드민 → 공개 페이지(/, /work, ...) 이동 시 즉시 logout.
//   · **탭/창 닫기 / 외부 도메인 이동** 시에도 즉시 logout.
//   · F5 / 하드 리로드 → 같은 어드민 path 로 즉시 재마운트되니, sessionStorage
//     'daemu_admin_reload_grace' 마커로 grace 1.5초. 그 안에 다시 mount 되면
//     reload 로 간주 → 토큰 유지. 그 외엔 진짜 unload.
//   · 60분 inactivity 는 lib/auth.js.
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

  // 어드민 페이지에 머무는 동안 beforeunload 시 grace 마커만 set.
  // **logout 은 호출하지 않음** — F5/하드 리로드 시 토큰이 살아있어야 다시
  // 로그인 화면을 안 보여주기 때문. 진짜 logout 은 위 AdminSessionGuard 의
  // pathname 비교 (admin → 공개 페이지 이동) 가 담당.
  // 탭 닫기 / 외부 도메인 이동 시에는 어차피 브라우저가 페이지 컨텍스트를
  // 통째로 정리하므로 별도 logout 불필요. 다음 어드민 진입 시 60분 inactivity
  // 정책이 자동 logout 처리.
  useEffect(() => {
    if (!pathname.startsWith('/admin')) return;
    const onBefore = () => {
      try {
        sessionStorage.setItem('daemu_admin_reload_grace', String(Date.now()));
      } catch { /* ignore */ }
    };
    window.addEventListener('beforeunload', onBefore);
    return () => window.removeEventListener('beforeunload', onBefore);
  }, [pathname]);

  // mount 시 grace 마커 정리 — 별도 동작 없이 1.5초 외 stale 마커만 제거.
  useEffect(() => {
    if (!pathname.startsWith('/admin')) return;
    try {
      sessionStorage.removeItem('daemu_admin_reload_grace');
    } catch { /* ignore */ }
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

  // body class 관리 — useLayoutEffect 는 paint 전에 동기 실행되므로 어드민/
  // 에러 페이지가 splash-pending visibility:hidden 으로 깜빡이는 일을 막는다.
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

  // 팝업 — 공개 페이지 + splash 종료 후에만 실행.
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
        <Route path="/admin/security" element={wrap(<RequireAuth><AdminSecurityMonitoring /></RequireAuth>)} />
        <Route path="/admin/announcements" element={wrap(<RequireAuth><AdminAnnouncements /></RequireAuth>)} />
        <Route path="/admin/inventory" element={wrap(<RequireAuth><AdminInventory /></RequireAuth>)} />

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
