import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import RawPage from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/work-detail.html.js';

export default function WorkDetail() {
  const { slug } = useParams();
  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = import.meta.env.BASE_URL + 'work-detail-page.css';
    link.dataset.pageStyle = 'work-detail';
    document.head.appendChild(link);
    return () => link.remove();
  }, []);

  // Force re-mount + re-script-execution when slug changes
  return <RawPage key={slug} html={html} bodyClass={bodyClass} script="/work-detail-page.js" />;
}
