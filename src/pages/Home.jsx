import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useExternalScript } from '../hooks/useExternalScript.js';
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd, faqLd } from '../lib/seo.js';
import PromotionBanner from '../components/PromotionBanner.jsx';
import { PartnerBrandLogoImg, PartnerBrandLink } from '../components/PartnerBrandLogo.jsx';
import { safeMediaUrl, validateOutboundUrl } from '../lib/safe.js';

const PARTNER_STORAGE_KEY = 'daemu_partner_brands';

function loadPartnerBrands() {
  try {
    const raw = JSON.parse(localStorage.getItem(PARTNER_STORAGE_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((b) => b && b.active !== false && b.name)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  } catch {
    return [];
  }
}
// R-02: Organization/LocalBusiness/WebSite live in index.html as the static
// @graph — single source of truth. Don't re-inject them on Home.

const HOME_FAQS = [
  { q: '대무는 어떤 회사인가요?', a: '전라남도 나주 기반 베이커리·카페 전문 컨설팅 회사. 2019년 설립, 40+ 프로젝트. 전략·메뉴·브랜드·공간·운영 5단계 통합 설계.' },
  { q: '카페 창업 컨설팅 비용은 얼마인가요?', a: '프로젝트 범위에 따라 결정됩니다. 전략 단독·풀 컨설팅(전략→운영)·부분 위탁 등 옵션을 상담을 통해 견적 산정합니다.' },
  { q: '나주에서 카페 컨설팅을 받을 수 있나요?', a: '가능합니다. 본사가 전라남도 나주시이며 인천·광주·전남권 다수 진행. 화상·방문 상담 모두 지원합니다.' },
  { q: '베이커리 메뉴 개발도 하나요?', a: '네. 빵·디저트·음료를 브랜드 방향에 맞춰 R&D부터 SOP 정리까지 진행합니다.' },
  { q: '브랜드만 의뢰할 수도 있나요?', a: 'Strategy·Brand·Space·Operation 중 일부 단계만 부분 위탁 가능합니다.' },
  { q: '상담 신청은 어떻게 하나요?', a: '/contact 페이지에서 24시간 접수. 1–2 영업일 내 담당 매니저가 회신합니다.' },
];

export default function Home() {
  useExternalScript('/home.js', []);
  const [partnerBrands, setPartnerBrands] = useState(() => loadPartnerBrands());
  useEffect(() => {
    const refresh = () => setPartnerBrands(loadPartnerBrands());
    window.addEventListener('storage', refresh);
    window.addEventListener('daemu-db-change', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('daemu-db-change', refresh);
    };
  }, []);

  // Hero LCP 이미지 preload — Home 진입 시점에만 활성화. index.html 에 두면
  // 모든 SPA 라우트에서 preload 후 미사용 경고가 뜨므로 동적으로 처리.
  useEffect(() => {
    const base = (import.meta.env.BASE_URL || '/');
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = base + 'assets/home-hero-flower.png';
    link.fetchPriority = 'high';
    document.head.appendChild(link);
    return () => { try { link.remove(); } catch { /* ignore */ } };
  }, []);
  useSeo({
    title: '베이커리 · 카페 비즈니스 파트너',
    description: '대무는 전라남도 나주 기반 베이커리·카페 전문 컨설팅 회사입니다. 브랜드 전략부터 메뉴 개발, 공간 설계, 운영까지 카페 비즈니스의 구조를 함께 설계합니다.',
    path: '/',
    keywords: '대무, DAEMU, 베이커리 컨설팅, 카페 창업, 카페 컨설팅, 메뉴 개발, 브랜드 전략, 공간 설계, 매장 운영, 나주 카페, 전남 카페 컨설팅',
    jsonLd: [
      breadcrumbLd([{ name: '홈', path: '/' }]),
      faqLd(HOME_FAQS),
    ],
  });

  return (
    <main className="page home-page">
      <PromotionBanner />
      {/* AEO answer-first block — visually hidden, indexed by search/AI engines.
          Provides factual, quotable definition of the company at the top of
          the document so generative engines surface it as a direct answer. */}
      <section className="visually-hidden" aria-label="대무 회사 안내">
        {/* h2 (not h1) since the hero already declares an h1 — single-h1 rule. */}
        <h2>대무 (DAEMU) — 베이커리 · 카페 비즈니스 파트너</h2>
        <p>
          대무는 전라남도 나주시 황동에 본사를 둔 베이커리·카페 전문 컨설팅 회사입니다. 2019년 설립 이후 40여 개 프로젝트를 진행했으며,
          브랜드 전략, 메뉴 개발, 공간 설계, 매장 운영까지 다섯 단계로 연결되는 카페 비즈니스 구조를 설계합니다.
          연락처는 061-335-1239 / daemu_office@naver.com 이며 월–금 09:00–18:00 운영합니다.
        </p>
        <h3>대무가 제공하는 5단계 서비스</h3>
        <ul>
          <li><strong>Strategy (전략)</strong>: 시장 분석·포지셔닝 기반 브랜드 방향 설계</li>
          <li><strong>Product (제품)</strong>: 베이커리·음료 메뉴 R&amp;D부터 SOP 정리까지</li>
          <li><strong>Brand (브랜드)</strong>: 로고·톤 앤 보이스·비주얼 시스템 일관 구축</li>
          <li><strong>Space (공간)</strong>: 동선·운영 효율 고려한 매장 공간 기획</li>
          <li><strong>Operation (운영)</strong>: 오픈 후 운영 구조와 매뉴얼 정비</li>
        </ul>
        <h3>자주 묻는 질문</h3>
        <dl>
          {HOME_FAQS.map((faq) => (
            <div key={faq.q}>
              <dt>{faq.q}</dt>
              <dd>{faq.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* HERO */}
      <section className="home-hero-v2">
        <div className="wide home-hero-inner">
          <div className="hero-eyebrow">
            <span className="hero-eyebrow-line"></span>
            <span className="hero-eyebrow-text">SINCE 2019 · NAJU</span>
          </div>

          <h1 className="hero-title-v2" aria-label="Made By Daemu">
            <span className="hero-line">
              <span className="hero-word" data-word="">Made</span>
            </span>
            <span className="hero-line hero-line--offset">
              <span className="hero-word" data-word="">By</span>
              <span className="hero-word hero-word--italic" data-word="">Daemu</span>
            </span>
          </h1>

          <div className="hero-meta-row">
            <div className="hero-tagline serif">Bakery<span className="amp">&amp;</span>Cafe<br /><em>Business Partner</em></div>
            <div className="hero-scroll-cue">
              <span className="hero-scroll-label">SCROLL</span>
              <span className="hero-scroll-line"></span>
            </div>
          </div>

          <div className="hero-visual-wrap">
            <div className="hero-visual-frame">
              <img src={import.meta.env.BASE_URL + 'assets/home-hero-flower.png'}
                alt="흰 장미 정물 — 대무 브랜드 비주얼"
                className="hero-visual-img"
                width="800" height="600"
                fetchPriority="high"
                decoding="async" />
              <div className="hero-visual-grain"></div>
            </div>
            <div className="hero-caption">
              <span className="hero-caption-num">01 / 05</span>
              <span className="hero-caption-text">A studio for bakery &amp; cafe brands that are built to last.</span>
            </div>
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      <section className="home-marquee" aria-hidden="true">
        <div className="marquee-track">
          <div className="marquee-row">
            <span>Strategy</span><i>✦</i>
            <span>Product</span><i>✦</i>
            <span>Brand</span><i>✦</i>
            <span>Space</span><i>✦</i>
            <span>Operation</span><i>✦</i>
            <span>Strategy</span><i>✦</i>
            <span>Product</span><i>✦</i>
            <span>Brand</span><i>✦</i>
            <span>Space</span><i>✦</i>
            <span>Operation</span><i>✦</i>
          </div>
        </div>
      </section>

      {/* PROMISE */}
      <section className="home-promise">
        <div className="narrow home-promise-inner">
          <div className="promise-label">
            <span className="promise-label-dot"></span>
            <span>OUR PROMISE</span>
          </div>

          <h2 className="promise-title" data-split="">
            기획은 많습니다.<br />
            그러나 <em data-highlight-underline="">실행까지 책임지는 팀</em>은<br />
            많지 않습니다.
          </h2>

          <div className="promise-body">
            <p>
              카페 창업의 핵심은 보이는 것이 아니라 <strong>구조</strong>입니다.<br />
              대무는 브랜드 전략부터 운영까지 연결되는<br />
              카페 비즈니스 구조를 설계합니다.
            </p>
          </div>

          <Link to="/about" className="promise-link">
            <span>About Daemu</span>
            <svg viewBox="0 0 30 10" width="30" height="10" aria-hidden="true">
              <path d="M0 5 L28 5 M23 1 L28 5 L23 9" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
          </Link>
        </div>
      </section>

      {/* STAGES */}
      <section className="home-stages">
        <div className="wide">
          <div className="stages-head">
            <div className="stages-eyebrow">01 — SERVICE FLOW</div>
            <h2 className="stages-title">전략부터 운영까지,<br />다섯 단계로 연결됩니다.</h2>
          </div>

          <ol className="stages-list" data-stages="">
            {[
              ['01','Strategy','시장 분석과 포지셔닝을 기반으로 브랜드의 방향을 설계합니다.','전략 · 분석'],
              ['02','Product','베이커리 · 음료 · 메뉴 구성을 브랜드 방향에 맞게 개발합니다.','메뉴 개발'],
              ['03','Brand','로고, 톤 앤 보이스, 비주얼 시스템까지 일관된 브랜드를 구축합니다.','브랜딩'],
              ['04','Space','고객 동선과 운영 효율을 고려한 매장 공간을 기획합니다.','공간 기획'],
              ['05','Operation','오픈 이후의 운영 구조와 매뉴얼을 정비하여 지속 가능한 매장을 만듭니다.','운영 설계']
            ].map(([n, name, desc, meta]) => (
              <li key={n} className="home-stage-row" data-stage="">
                <span className="home-stage-num">{n}</span>
                <div className="home-stage-main">
                  <h3 className="home-stage-name">{name}</h3>
                  <p className="home-stage-desc">{desc}</p>
                </div>
                <span className="home-stage-meta">{meta}</span>
              </li>
            ))}
          </ol>

          <Link to="/service" className="stages-link">
            <span>See full service</span>
            <svg viewBox="0 0 30 10" width="30" height="10" aria-hidden="true">
              <path d="M0 5 L28 5 M23 1 L28 5 L23 9" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
          </Link>
        </div>
      </section>

      {/* WORK */}
      <section className="home-work">
        <div className="wide">
          <div className="work-head">
            <div className="work-eyebrow">02 — SELECTED WORK</div>
            <h2 className="work-title">구조가 있는 브랜드는<br />오래 머뭅니다.</h2>
          </div>

          <div className="work-showcase" data-work-showcase="">
            <Link to="/work/beclassy-naju" className="work-card work-card--lg" data-work-card="">
              <div className="work-card-media">
                <img src={import.meta.env.BASE_URL + 'assets/work-beclassy-1.png'} alt="Be Classy project" loading="lazy" decoding="async" />
                <div className="work-card-overlay"></div>
              </div>
              <div className="work-card-info">
                <span className="work-card-num">W01</span>
                <h3 className="work-card-name">Be Classy</h3>
                <p className="work-card-cat">Brand Identity · Space · Menu</p>
              </div>
              <div className="work-card-arrow" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="24" height="24">
                  <path d="M7 17 L17 7 M9 7 L17 7 L17 15" stroke="currentColor" strokeWidth="1.3" fill="none" />
                </svg>
              </div>
            </Link>

            <Link to="/work" className="work-card" data-work-card="">
              <div className="work-card-media">
                <img src={import.meta.env.BASE_URL + 'assets/work-croissants.png'} alt="bakery project" loading="lazy" decoding="async" />
                <div className="work-card-overlay"></div>
              </div>
              <div className="work-card-info">
                <span className="work-card-num">W02</span>
                <h3 className="work-card-name">Bakery Project</h3>
                <p className="work-card-cat">Menu · Operation</p>
              </div>
            </Link>

            <Link to="/work" className="work-card" data-work-card="">
              <div className="work-card-media">
                <img src={import.meta.env.BASE_URL + 'assets/work-desserts.png'} alt="dessert project" loading="lazy" decoding="async" />
                <div className="work-card-overlay"></div>
              </div>
              <div className="work-card-info">
                <span className="work-card-num">W03</span>
                <h3 className="work-card-name">Dessert Studio</h3>
                <p className="work-card-cat">Product · Brand</p>
              </div>
            </Link>

            <Link to="/work" className="work-card" data-work-card="">
              <div className="work-card-media">
                <img src={import.meta.env.BASE_URL + 'assets/work-morif.png'} alt="morif project" loading="lazy" decoding="async" />
                <div className="work-card-overlay"></div>
              </div>
              <div className="work-card-info">
                <span className="work-card-num">W04</span>
                <h3 className="work-card-name">Morif</h3>
                <p className="work-card-cat">Consulting · Space</p>
              </div>
            </Link>
          </div>

          <Link to="/work" className="work-more-link">
            <span>All projects</span>
            <svg viewBox="0 0 30 10" width="30" height="10" aria-hidden="true">
              <path d="M0 5 L28 5 M23 1 L28 5 L23 9" stroke="currentColor" strokeWidth="1" fill="none" />
            </svg>
          </Link>
        </div>
      </section>

      {/* NUMBERS */}
      <section className="home-numbers">
        <div className="wide home-numbers-inner">
          <div className="numbers-head">
            <span className="numbers-eyebrow">03 — BY THE NUMBERS</span>
            <h2 className="numbers-title">숫자로 보는 대무</h2>
          </div>

          <div className="numbers-grid" data-counters="">
            <div className="num-item">
              <div className="num-value serif" data-count-to="6">0</div>
              <div className="num-label">YEARS · 6년간의 현장 경험</div>
            </div>
            <div className="num-item">
              <div className="num-value serif" data-count-to="40" data-suffix="+">0</div>
              <div className="num-label">PROJECTS · 완성된 브랜드</div>
            </div>
            <div className="num-item">
              <div className="num-value serif" data-count-to="5">0</div>
              <div className="num-label">STAGES · 전략부터 운영까지</div>
            </div>
            <div className="num-item">
              <div className="num-value serif" data-count-to="100" data-suffix="%">0</div>
              <div className="num-label">CUSTOM · 모든 프로젝트는 맞춤형</div>
            </div>
          </div>
        </div>
      </section>

      {/* PARTNERS */}
      <section className="home-partners">
        <div className="wide home-partners-inner">
          <div className="home-partners-head">
            <span className="home-partners-eyebrow">PARTNERS</span>
            <h2 className="home-partners-title serif">함께하는 <em>파트너사</em></h2>
            <p className="home-partners-desc">대무와 함께 브랜드를 만들어가는 협업 파트너입니다.</p>
          </div>
          <div className="home-partners-grid" id="home-partners-grid">
            {partnerBrands.map((b) => {
              // Snyk Open Redirect/XSS taint break — validate up front in
              // the parent so the value passed across the JSX boundary is
              // already a verified primitive (not a useState reference).
              const verifiedLogo = b.logo ? String(safeMediaUrl(b.logo) || '') : '';
              const verifiedHref = String(validateOutboundUrl(b.url) || '');
              const safeName = String(b.name == null ? '' : b.name).slice(0, 80);
              return (
                <PartnerBrandLink key={b.id} verifiedHref={verifiedHref} trackId={b.id}
                  className="home-partner-card-wrapper"
                  style={{ textDecoration: 'none' }}>
                  <div className="home-partner-card">
                    <PartnerBrandLogoImg
                      verifiedLogoSrc={verifiedLogo}
                      name={safeName}
                      style={{ maxWidth: '78%', maxHeight: 64, objectFit: 'contain' }}
                    />
                    {!verifiedLogo && (
                      <p className="home-partner-card-text"
                        style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 22 }}>
                        {safeName}
                      </p>
                    )}
                  </div>
                </PartnerBrandLink>
              );
            })}
            <div className="home-partner-card home-partner-card--coming">
              <div className="home-partner-card-icon">
                <svg viewBox="0 0 40 40" width="40" height="40">
                  <line x1="20" y1="8" x2="20" y2="32" stroke="#6f6b68" strokeWidth="1.5" />
                  <line x1="8" y1="20" x2="32" y2="20" stroke="#6f6b68" strokeWidth="1.5" />
                </svg>
              </div>
              <p className="home-partner-card-text">협업 파트너를<br />모집하고 있습니다</p>
              <Link to="/contact" className="home-partner-card-link"
                data-track="cta_click" data-track-label="home-partner-card">문의하기 →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="home-cta">
        <div className="narrow home-cta-inner">
          <div className="cta-divider"></div>
          <div className="cta-eyebrow">LET'S TALK</div>
          <h2 className="cta-title serif">
            Your next<br />
            <em>cafe starts here.</em>
          </h2>
          <p className="cta-body">
            새로운 카페 창업, 리브랜딩, 메뉴 개발,<br />
            공간 기획이 필요하시다면 편하게 문의해주세요.<br />
            첫 미팅부터 운영까지, 대무가 함께합니다.
          </p>
          <div className="cta-actions">
            <Link to="/contact" className="cta-btn cta-btn--primary"
              data-track="cta_click" data-track-label="home-cta-primary">
              <span>프로젝트 문의하기</span>
              <svg viewBox="0 0 30 10" width="30" height="10" aria-hidden="true">
                <path d="M0 5 L28 5 M23 1 L28 5 L23 9" stroke="currentColor" strokeWidth="1" fill="none" />
              </svg>
            </Link>
            <Link to="/process" className="cta-btn cta-btn--ghost">
              <span>프로세스 보기</span>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
