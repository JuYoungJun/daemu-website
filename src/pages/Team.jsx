import RawPage, { } from '../components/RawPage.jsx';
import html, { bodyClass } from './raw/team.html.js';

export default function Team() {
  return (
    <>
      <RawPage html={html} bodyClass={bodyClass} script="/team.js" />
    </>
  );
}
