import { NavLink, Link, useLocation } from 'react-router-dom';
import { useEffect, useRef } from 'react';

const items = [
  { to: '/service', label: 'SERVICE', key: 'service' },
  { to: '/about', label: 'ABOUT US', key: 'about' },
  { to: '/team', label: 'TEAM', key: 'team' },
  { to: '/process', label: 'PROCESS', key: 'process' },
  { to: '/work', label: 'WORK', key: 'work' },
  { to: '/partners', label: 'PARTNERS', key: 'partners' },
  { to: '/contact', label: 'CONTACT', key: 'contact' }
];

export default function Nav() {
  const location = useLocation();
  const navRef = useRef(null);

  useEffect(() => {
    const nav = navRef.current?.querySelector('.nav');
    if (nav) nav.classList.remove('open');
  }, [location.pathname]);

  return (
    <header className="site-header" ref={navRef}>
      <div className="logo-row">
        <Link to="/" className="logo"><img src={import.meta.env.BASE_URL + 'assets/logo.svg'} alt="DAEMU" /></Link>
      </div>
      <nav className="nav">
        {items.map((it) => (
          <NavLink key={it.key} to={it.to} data-nav={it.key}
            className={({ isActive }) => isActive ? 'active' : undefined}>
            {it.label}
          </NavLink>
        ))}
      </nav>
      <button className="menu-btn" aria-label="메뉴 열기"
        onClick={() => navRef.current?.querySelector('.nav')?.classList.toggle('open')}>☰</button>
    </header>
  );
}
