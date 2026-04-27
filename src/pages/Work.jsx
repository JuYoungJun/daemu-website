import RawPage from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/work.html.js';

export default function Work() {
  return <RawPage html={html} bodyClass={bodyClass} script="/work.js" />;
}
