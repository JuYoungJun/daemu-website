import { useEffect } from 'react';
import { Link } from 'react-router-dom';

export default function AdminLayout({ title, subtitle, children }) {
  useEffect(() => {
    document.body.dataset.page = 'admin';
    document.title = (title ? title + ' — ' : '') + 'DAEMU Admin';
    return () => { delete document.body.dataset.page; };
  }, [title]);

  return (
    <main className="page fade-up">
      <section className="wide">
        <Link to="/admin" className="adm-back">← Dashboard</Link>
        {title && <h1 className="page-title">{title}</h1>}
        {subtitle && (
          <p className="adm-section-desc"
             dangerouslySetInnerHTML={{ __html: subtitle }} />
        )}
        {children}
      </section>
    </main>
  );
}
