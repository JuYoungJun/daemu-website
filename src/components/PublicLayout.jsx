import Nav from './Nav.jsx';
import Footer from './Footer.jsx';

// Splash + body class management now lives in App.jsx (single source of truth).
// PublicLayout is just the visual chrome — Nav, page content, Footer.
export default function PublicLayout({ children }) {
  return (
    <>
      <Nav />
      {children}
      <Footer />
    </>
  );
}
