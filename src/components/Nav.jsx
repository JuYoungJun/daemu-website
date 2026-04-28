import { NavLink, Link, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';

const items = [
  { to: '/service', label: 'SERVICE', sub: '서비스', key: 'service' },
  { to: '/about', label: 'ABOUT US', sub: '소개', key: 'about' },
  { to: '/team', label: 'TEAM', sub: '팀', key: 'team' },
  { to: '/process', label: 'PROCESS', sub: '프로세스', key: 'process' },
  { to: '/work', label: 'WORK', sub: '작업사례', key: 'work' },
  { to: '/partners', label: 'PARTNERS', sub: '파트너', key: 'partners' },
  { to: '/contact', label: 'CONTACT', sub: '문의', key: 'contact' },
];

export default function Nav() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const drawerRef = useRef(null);
  const lastFocusRef = useRef(null);

  // Close drawer on route change
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // Lock body scroll while drawer is open + ESC closes
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      lastFocusRef.current = document.activeElement;
      const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
      window.addEventListener('keydown', onKey);
      // Focus first link in drawer for accessibility
      requestAnimationFrame(() => {
        drawerRef.current?.querySelector('a, button')?.focus();
      });
      return () => {
        document.body.style.overflow = prev;
        window.removeEventListener('keydown', onKey);
        if (lastFocusRef.current && lastFocusRef.current.focus) lastFocusRef.current.focus();
      };
    }
  }, [open]);

  return (
    <>
      <header className="site-header">
        <div className="logo-row">
          <Link to="/" className="logo" aria-label="DAEMU 홈">
            <img src={import.meta.env.BASE_URL + 'assets/logo.svg'} alt="DAEMU" />
          </Link>
        </div>

        {/* Desktop nav */}
        <nav className="nav" aria-label="주 메뉴">
          {items.map((it) => (
            <NavLink key={it.key} to={it.to} data-nav={it.key}
              className={({ isActive }) => isActive ? 'active' : undefined}>
              {it.label}
            </NavLink>
          ))}
        </nav>

        {/* Mobile hamburger */}
        <button
          className="menu-btn"
          type="button"
          aria-label={open ? '메뉴 닫기' : '메뉴 열기'}
          aria-expanded={open}
          aria-controls="mobile-drawer"
          onClick={() => setOpen((v) => !v)}>
          <span className={'menu-icon' + (open ? ' is-open' : '')} aria-hidden="true">
            <span /><span /><span />
          </span>
        </button>
      </header>

      {/* Slide-in drawer */}
      <div
        className={'site-drawer-backdrop' + (open ? ' is-open' : '')}
        onClick={() => setOpen(false)}
        aria-hidden={!open}
      />
      <aside
        id="mobile-drawer"
        ref={drawerRef}
        className={'site-drawer' + (open ? ' is-open' : '')}
        aria-label="모바일 메뉴"
        // `inert` removes focusable descendants from the tab order AND
        // hides them from accessibility tree when the drawer is closed.
        // Replaces aria-hidden which Lighthouse flags when it contains
        // focusable children. Modern equivalent: WCAG 4.1.2 compliant.
        {...(open ? {} : { inert: '' })}>
        <div className="site-drawer-head">
          <span className="site-drawer-title">MENU</span>
          <button className="site-drawer-close" type="button" aria-label="메뉴 닫기" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M5 5 L19 19 M19 5 L5 19" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <nav className="site-drawer-nav" aria-label="모바일 메뉴 항목">
          {items.map((it, i) => (
            <NavLink
              key={it.key}
              to={it.to}
              className={({ isActive }) => 'site-drawer-link' + (isActive ? ' is-active' : '')}
              style={{ transitionDelay: `${0.04 * i + 0.05}s` }}
              onClick={() => setOpen(false)}>
              <span className="site-drawer-link-num">{String(i + 1).padStart(2, '0')}</span>
              <span className="site-drawer-link-en">{it.label}</span>
              <span className="site-drawer-link-ko">{it.sub}</span>
            </NavLink>
          ))}
        </nav>
        <div className="site-drawer-foot">
          <p>061-335-1239</p>
          <p>daemu_office@naver.com</p>
        </div>
      </aside>
    </>
  );
}
