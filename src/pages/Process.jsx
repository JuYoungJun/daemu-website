import { useEffect } from 'react';
import RawPage from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/process.html.js';

export default function Process() {
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/process-page.css';
    link.dataset.pageStyle = 'process';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  return <RawPage html={html} bodyClass={bodyClass} script="/process-page.js" />;
}
