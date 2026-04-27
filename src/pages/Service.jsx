import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/service.html.js';

export default function Service() {
  // Inject inline-extracted CSS into <head> on mount
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/service-page.css';
    link.dataset.pageStyle = 'service';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  return <RawPage html={html} bodyClass={bodyClass} script="/service-page.js" />;
}
