// Lightweight SEO head manager — no extra dependency.
// Sets <title>, <meta name="description">, OG/Twitter cards, canonical URL,
// and a per-page JSON-LD block at the `<script id="seo-jsonld">` slot.
//
// SITE_BASE_URL is read from the VITE_SITE_BASE_URL build-time env var
// (set in .env.production / GitHub Actions / Cafe24 build) and falls back
// to the GitHub Pages URL. Static crawler files (robots.txt, sitemap.xml,
// llms.txt, .well-known/security.txt, plus the JSON-LD inside index.html)
// remain hard-coded — when the domain changes, run the migration script
// noted in SEO_REPORT.md to update those.

export const SITE_BASE_URL = (
  import.meta.env.VITE_SITE_BASE_URL
  || 'https://juyoungjun.github.io/daemu-website'
).replace(/\/$/, '');
export const BRAND = '대무 (DAEMU)';
export const DEFAULT_OG_IMAGE = SITE_BASE_URL + '/assets/logo.svg';

const ATTRS = {
  description: ['name', 'description'],
  keywords: ['name', 'keywords'],
  robots: ['name', 'robots'],
  canonical: ['rel', 'canonical'], // <link>
  'og:title': ['property', 'og:title'],
  'og:description': ['property', 'og:description'],
  'og:type': ['property', 'og:type'],
  'og:image': ['property', 'og:image'],
  'og:url': ['property', 'og:url'],
  'og:site_name': ['property', 'og:site_name'],
  'og:locale': ['property', 'og:locale'],
  'twitter:card': ['name', 'twitter:card'],
  'twitter:title': ['name', 'twitter:title'],
  'twitter:description': ['name', 'twitter:description'],
  'twitter:image': ['name', 'twitter:image'],
};

function upsertMeta(key, content) {
  if (typeof document === 'undefined') return;
  const [attr, value] = ATTRS[key] || [];
  if (!attr) return;
  const tag = key === 'canonical' ? 'link' : 'meta';
  let el = document.head.querySelector(`${tag}[${attr}="${value}"]`);
  if (!el) {
    el = document.createElement(tag);
    el.setAttribute(attr, value);
    document.head.appendChild(el);
  }
  if (tag === 'link') el.setAttribute('href', content);
  else el.setAttribute('content', content);
}

function setJsonLd(id, data) {
  if (typeof document === 'undefined') return;
  let el = document.head.querySelector(`script[data-seo-id="${id}"]`);
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.setAttribute('data-seo-id', id);
    document.head.appendChild(el);
  }
  // S-05 defense in depth: textContent already prevents script execution,
  // but escape `<` and `-->` so that if a future maintainer flips this to
  // innerHTML / SSR-as-string we don't immediately become a stored-XSS sink.
  // OWASP JSON-in-script guidance.
  el.textContent = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/-->/g, '--\\u003e');
}

function removeJsonLd(id) {
  if (typeof document === 'undefined') return;
  const el = document.head.querySelector(`script[data-seo-id="${id}"]`);
  if (el) el.remove();
}

/**
 * Apply page metadata. Returns a cleanup function suitable for useEffect.
 *
 * @param {Object} cfg
 * @param {string} cfg.title
 * @param {string} cfg.description
 * @param {string} [cfg.path]   — route path, used for canonical/og:url
 * @param {string} [cfg.image]  — OG/Twitter image URL
 * @param {boolean} [cfg.noindex]
 * @param {string} [cfg.keywords]
 * @param {Array<Object>} [cfg.jsonLd] — optional JSON-LD blocks
 */
export function setSeo(cfg = {}) {
  if (typeof document === 'undefined') return () => {};
  const path = cfg.path || (typeof window !== 'undefined' ? window.location.pathname : '/');
  const url = SITE_BASE_URL + (path.startsWith('/') ? path : '/' + path);
  const title = cfg.title ? `${cfg.title} · ${BRAND}` : BRAND;
  const description = cfg.description || '';
  const image = cfg.image || DEFAULT_OG_IMAGE;

  document.title = title;
  upsertMeta('description', description);
  upsertMeta('robots', cfg.noindex ? 'noindex,follow' : 'index,follow');
  if (cfg.keywords) upsertMeta('keywords', cfg.keywords);
  upsertMeta('canonical', url);

  upsertMeta('og:title', title);
  upsertMeta('og:description', description);
  upsertMeta('og:type', 'website');
  upsertMeta('og:image', image);
  upsertMeta('og:url', url);
  upsertMeta('og:site_name', BRAND);
  upsertMeta('og:locale', 'ko_KR');

  upsertMeta('twitter:card', 'summary_large_image');
  upsertMeta('twitter:title', title);
  upsertMeta('twitter:description', description);
  upsertMeta('twitter:image', image);

  const ldList = Array.isArray(cfg.jsonLd) ? cfg.jsonLd : [];
  ldList.forEach((block, i) => setJsonLd(`page-${i}`, block));

  // Cleanup: remove page-scoped JSON-LD on unmount so the next page starts clean.
  return () => {
    ldList.forEach((_, i) => removeJsonLd(`page-${i}`));
  };
}

/* --------------------------------------------------------------- */
/* Reusable JSON-LD building blocks                                 */

export const ORGANIZATION_LD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': SITE_BASE_URL + '/#organization',
  name: BRAND,
  alternateName: 'DAEMU',
  url: SITE_BASE_URL + '/',
  logo: SITE_BASE_URL + '/assets/logo.svg',
  description:
    '전라남도 나주 기반 베이커리·카페 전문 컨설팅 회사. 브랜드 전략부터 메뉴 개발, 공간 설계, 운영까지 카페 비즈니스의 구조를 설계합니다.',
  foundingDate: '2019',
  contactPoint: [
    {
      '@type': 'ContactPoint',
      telephone: '+82-61-335-1239',
      email: 'daemu_office@naver.com',
      contactType: 'customer service',
      areaServed: 'KR',
      availableLanguage: ['ko', 'en'],
    },
  ],
  address: {
    '@type': 'PostalAddress',
    streetAddress: '황동 3길 8',
    addressLocality: '나주시',
    addressRegion: '전라남도',
    addressCountry: 'KR',
  },
};

export const LOCAL_BUSINESS_LD = {
  '@context': 'https://schema.org',
  '@type': 'ProfessionalService',
  '@id': SITE_BASE_URL + '/#localbusiness',
  name: BRAND,
  image: SITE_BASE_URL + '/assets/logo.svg',
  url: SITE_BASE_URL + '/',
  telephone: '+82-61-335-1239',
  email: 'daemu_office@naver.com',
  priceRange: '$$',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '황동 3길 8',
    addressLocality: '나주시',
    addressRegion: '전라남도',
    addressCountry: 'KR',
  },
  areaServed: { '@type': 'Country', name: 'South Korea' },
  openingHoursSpecification: [
    {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: '09:00',
      closes: '18:00',
    },
  ],
};

export const WEBSITE_LD = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': SITE_BASE_URL + '/#website',
  url: SITE_BASE_URL + '/',
  name: BRAND,
  inLanguage: 'ko-KR',
  publisher: { '@id': SITE_BASE_URL + '/#organization' },
};

export function breadcrumbLd(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: SITE_BASE_URL + it.path,
    })),
  };
}

export function faqLd(faqs) {
  // V3-06 null-safety
  const items = Array.isArray(faqs) ? faqs : [];
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((q) => ({
      '@type': 'Question',
      name: (q && q.q) || '',
      acceptedAnswer: { '@type': 'Answer', text: (q && q.a) || '' },
    })),
  };
}

/**
 * HowTo schema for the Process page — generative engines surface this
 * as step-by-step answers to "how do I open a cafe?" type queries.
 *
 * @param {string} name
 * @param {string} description
 * @param {Array<{name: string, text: string}>} steps
 */
export function howToLd(name, description, steps) {
  // V3-06 null-safety
  const safeSteps = Array.isArray(steps) ? steps : [];
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: name || '',
    description: description || '',
    totalTime: 'P3M',
    step: safeSteps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: (s && s.name) || `Step ${i + 1}`,
      text: (s && s.text) || '',
    })),
  };
}

/**
 * Service schema — one per consulting offering. AI search engines
 * (Perplexity, ChatGPT search) treat each as a distinct answer for
 * "what does X provide" queries.
 */
export function serviceLd(name, description, serviceType) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name,
    description,
    serviceType,
    provider: { '@id': SITE_BASE_URL + '/#organization' },
    areaServed: { '@type': 'Country', name: 'South Korea' },
  };
}

/**
 * Article / CreativeWork schema for individual case studies (work detail).
 */
export function articleLd(opts = {}) {
  // V3-06 null-safety
  const { title, description, image, slug, datePublished } = opts || {};
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title || '',
    description: description || '',
    image: image || (SITE_BASE_URL + '/assets/logo.svg'),
    author: { '@id': SITE_BASE_URL + '/#organization' },
    publisher: { '@id': SITE_BASE_URL + '/#organization' },
    mainEntityOfPage: SITE_BASE_URL + '/work/' + (slug || ''),
    datePublished: datePublished || '2024-01-01',
    inLanguage: 'ko-KR',
  };
}
