/**
 * DAEMU Work Page — Interactivity + GSAP
 * - Brand filter (ALL / BECLASSY / PUMJANG / MORIF)
 * - Smooth scroll to brand on filter click
 * - Scroll reveal for brand sections and branches
 *
 * Uses the same robust pattern as home/team:
 *  - Baseline content is always visible in CSS
 *  - GSAP only runs enter animations (gsap.from) via ScrollTrigger.onEnter
 */
(function () {
  'use strict';

  const body = document.body;
  if (!body || body.dataset.page !== 'work') return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     Filter (runs regardless of GSAP presence)
     ------------------------------------------------------------------ */
  function initFilter() {
    const buttons = Array.from(document.querySelectorAll('.dmwork-filter-btn'));
    const brands = Array.from(document.querySelectorAll('[data-brand]'));
    if (!buttons.length || !brands.length) return;

    function applyFilter(filter, animate) {
      buttons.forEach((b) => {
        const isActive = b.dataset.filter === filter;
        b.classList.toggle('is-active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });

      brands.forEach((brand) => {
        const match = filter === 'all' || brand.dataset.brand === filter;
        brand.classList.toggle('is-dimmed', !match);
      });

      // Scroll to first matching brand (except when 'all')
      if (animate && filter !== 'all') {
        const target = brands.find((b) => b.dataset.brand === filter);
        if (target) {
          const header = document.querySelector('.dmwork-filter');
          const headerH = header ? header.offsetHeight : 0;
          const y = target.getBoundingClientRect().top + window.pageYOffset - headerH - 20;
          window.scrollTo({ top: y, behavior: 'smooth' });
        }
      }
    }

    buttons.forEach((b) => {
      b.addEventListener('click', () => applyFilter(b.dataset.filter, true));
    });
  }

  /* ------------------------------------------------------------------
     GSAP animations (only if GSAP loaded)
     ------------------------------------------------------------------ */
  if (typeof window.gsap === 'undefined') {
    body.classList.add('no-gsap');
    document.querySelectorAll('.dmwork-hero-word').forEach((el) => {
      el.style.transform = 'none';
    });
    initFilter();
    // partner 카드 fetch + branch link 도 GSAP 와 무관. 누락 시 admin → /work
    // 노출 불가 회귀.
    initPartnerBrands();
    initBranchLinks();
    return;
  }

  const { gsap } = window;
  if (window.ScrollTrigger) {
    gsap.registerPlugin(window.ScrollTrigger);
  }

  function afterSplash(cb) {
    let called = false;
    const runOnce = () => { if (called) return; called = true; cb(); };

    if (body.classList.contains('splash-ready') || !body.classList.contains('splash-pending')) {
      runOnce();
      return;
    }
    const observer = new MutationObserver(() => {
      if (body.classList.contains('splash-ready')) {
        observer.disconnect();
        setTimeout(runOnce, 120);
      }
    });
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { observer.disconnect(); runOnce(); }, 5000);
  }

  function isAlreadyInViewport(el) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return r.top < vh * 0.9 && r.bottom > 0;
  }

  /* Hero intro */
  function initHero() {
    const words = gsap.utils.toArray('.dmwork-hero-word');
    const eyebrow = document.querySelector('.dmwork-hero-eyebrow');
    const meta = document.querySelector('.dmwork-hero-meta');

    if (prefersReducedMotion) {
      gsap.set(words, { y: '0%' });
      return;
    }

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    if (eyebrow) {
      gsap.set(eyebrow, { opacity: 0, y: 12 });
      tl.to(eyebrow, { opacity: 1, y: 0, duration: .7 }, 0);
    }
    tl.to(words, { y: '0%', duration: 1.15, stagger: 0.14, ease: 'expo.out' }, .1);
    if (meta) {
      gsap.set(meta, { opacity: 0, y: 20 });
      tl.to(meta, { opacity: 1, y: 0, duration: .9 }, .55);
    }
  }

  /* Brand heads reveal as you scroll */
  function initBrandHeads() {
    if (prefersReducedMotion || !window.ScrollTrigger) return;
    const heads = gsap.utils.toArray('.dmwork-brand-head');
    heads.forEach((head) => {
      const children = head.querySelectorAll(':scope > *');
      const play = () => gsap.from(children, {
        y: 28,
        opacity: 0,
        duration: 0.9,
        stagger: 0.1,
        ease: 'power3.out',
      });
      if (isAlreadyInViewport(head)) {
        play();
      } else {
        window.ScrollTrigger.create({
          trigger: head,
          start: 'top 85%',
          once: true,
          onEnter: play,
        });
      }
    });
  }

  /* Branches reveal with stagger */
  function initBranches() {
    if (prefersReducedMotion || !window.ScrollTrigger) return;
    const groups = gsap.utils.toArray('[data-branches]');
    groups.forEach((group) => {
      const branches = group.querySelectorAll('[data-branch]');
      if (!branches.length) return;
      const play = () => gsap.from(branches, {
        y: 44,
        opacity: 0,
        duration: 1.0,
        stagger: 0.14,
        ease: 'power3.out',
      });
      if (isAlreadyInViewport(group)) {
        play();
      } else {
        window.ScrollTrigger.create({
          trigger: group,
          start: 'top 88%',
          once: true,
          onEnter: play,
        });
      }
    });
  }

  /* Extras counters (rise + simple number bump) */
  function initExtras() {
    if (prefersReducedMotion || !window.ScrollTrigger) return;
    const items = gsap.utils.toArray('.dmwork-extras-item');
    const title = document.querySelector('.dmwork-extras-title');
    const desc = document.querySelector('.dmwork-extras-desc');

    if (items.length) {
      const play = () => gsap.from(items, {
        y: 30,
        opacity: 0,
        duration: 0.9,
        stagger: 0.1,
        ease: 'power3.out',
      });
      const grid = document.querySelector('.dmwork-extras-grid');
      if (grid) {
        if (isAlreadyInViewport(grid)) play();
        else window.ScrollTrigger.create({ trigger: grid, start: 'top 88%', once: true, onEnter: play });
      }
    }

    [title, desc].forEach((el, i) => {
      if (!el) return;
      const play = () => gsap.from(el, { y: 20, opacity: 0, duration: 0.9, delay: i * 0.1, ease: 'power3.out' });
      if (isAlreadyInViewport(el)) play();
      else window.ScrollTrigger.create({ trigger: el, start: 'top 88%', once: true, onEnter: play });
    });
  }

  /* CTA reveal */
  function initCTA() {
    if (prefersReducedMotion || !window.ScrollTrigger) return;
    const targets = [
      ['.dmwork-cta-divider', { scaleY: 0, transformOrigin: 'top' }, 0.9],
      ['.dmwork-cta-eyebrow', { y: 14 }, 0.6],
      ['.dmwork-cta-title',   { y: 34 }, 1.1],
      ['.dmwork-cta-body',    { y: 18 }, 0.8],
      ['.dmwork-cta-actions', { y: 20 }, 0.8],
    ];
    targets.forEach(([sel, from, dur]) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const play = () => gsap.from(el, { opacity: 0, ...from, duration: dur, ease: 'power3.out' });
      if (isAlreadyInViewport(el)) play();
      else window.ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: play });
    });
  }

  /* ------------------------------------------------------------------
     Partner brands — backend `partner_brands` 동기화.
     공개 사이트(Home)와 동일한 source(`/api/partner-brands/visible`).
     work.html.js 의 `[data-partners-grid]` 안의 마지막 "협업 파트너 모집중"
     카드는 정적으로 남기고, backend 가 active=True 로 가진 브랜드 카드를
     그 앞에 동적 삽입. window.safeMediaUrl / validateOutboundUrl 로 XSS +
     Open Redirect 가드 (globals.js 에서 노출).
     ------------------------------------------------------------------ */
  function _loadPartnerBrands() {
    // window.api 는 /admin/* 경로에서만 globals.js 가 로드되므로 공개 /work
    // 에서는 직접 fetch. main.jsx 가 window.DAEMU_API_BASE 에 빌드 시점의
    // VITE_API_BASE_URL 을 노출. 미설정 시 backend 미연결 → 빈 배열.
    const base = (typeof window !== 'undefined' && window.DAEMU_API_BASE) || '';
    if (!base) return Promise.resolve([]);
    return fetch(base + '/api/partner-brands/visible', { credentials: 'omit' })
      .then((res) => (res.ok ? res.json() : null))
      .then((r) => {
        if (r && r.ok && Array.isArray(r.items)) {
          return r.items
            .map((it) => ({
              id: it.id,
              name: it.name || '',
              logo: it.logo || '',
              url: it.url || '',
              order: Number(it.sort_order) || 0,
            }))
            .sort((a, b) => a.order - b.order);
        }
        return [];
      })
      .catch(() => []);
  }

  function _renderPartnerBrands(grid, brands) {
    // 이전에 동적으로 삽입한 카드만 제거. 정적 "모집중" 카드는 보존.
    Array.from(grid.querySelectorAll('[data-dynamic="true"]')).forEach((n) => n.remove());
    // 마지막 정적 카드(=tail = "모집중") 기준으로 그 앞에 삽입해야 layout 순서 유지.
    const tail = grid.querySelector('.home-partner-card--coming, .dmwork-partner-card:not([data-dynamic="true"])');
    brands.forEach((b) => {
      const safeLogo = window.safeMediaUrl ? String(window.safeMediaUrl(b.logo) || '') : '';
      const safeHref = window.validateOutboundUrl ? String(window.validateOutboundUrl(b.url) || '') : '';
      const safeName = String(b.name == null ? '' : b.name).slice(0, 200);
      // Home (Home.jsx PartnerBrandLink) 과 동일 DOM 구조 — wrapper(a/div) 안에
      // home-partner-card div, 그 안에 img/텍스트. home.css 의 스타일 직접 사용.
      const wrapper = document.createElement(safeHref ? 'a' : 'div');
      wrapper.className = 'home-partner-card-wrapper';
      wrapper.setAttribute('data-dynamic', 'true');
      wrapper.style.textDecoration = 'none';
      if (safeHref) {
        wrapper.setAttribute('href', safeHref);
        wrapper.setAttribute('target', '_blank');
        wrapper.setAttribute('rel', 'noopener noreferrer');
        wrapper.setAttribute('data-track', 'cta_click');
        wrapper.setAttribute('data-track-label', 'work-partner-' + (b.id != null ? String(b.id).slice(0, 64) : ''));
      }
      const card = document.createElement('div');
      card.className = 'home-partner-card';
      if (safeLogo) {
        const img = document.createElement('img');
        img.src = safeLogo;
        img.alt = safeName;
        img.loading = 'lazy';
        img.style.maxWidth = '78%';
        img.style.maxHeight = '64px';
        img.style.objectFit = 'contain';
        card.appendChild(img);
      } else if (safeName) {
        const p = document.createElement('p');
        p.className = 'home-partner-card-text';
        p.style.fontFamily = "'Cormorant Garamond', Georgia, serif";
        p.style.fontSize = '22px';
        p.textContent = safeName; // textContent — XSS 안전.
        card.appendChild(p);
      }
      wrapper.appendChild(card);
      if (tail) {
        grid.insertBefore(wrapper, tail);
      } else {
        grid.appendChild(wrapper);
      }
    });
  }

  function initPartnerBrands() {
    const grid = document.querySelector('[data-partners-grid]');
    if (!grid) return;
    let inFlight = false;
    const refresh = () => {
      if (inFlight) return;
      inFlight = true;
      _loadPartnerBrands()
        .then((list) => _renderPartnerBrands(grid, list))
        .finally(() => { inFlight = false; });
    };
    refresh();
    // 어드민에서 파트너 브랜드 변경 시 즉시 반영 (같은 탭에서 어드민 → /work
    // 이동 케이스). cross-tab 은 polling 대신 새로고침 의존.
    window.addEventListener('daemu-db-change', refresh);
  }

  /* ------------------------------------------------------------------
     Branch card click → project detail page
     ------------------------------------------------------------------ */
  function initBranchLinks() {
    document.querySelectorAll('.dmwork-branch[data-project-id]').forEach((branch) => {
      branch.addEventListener('click', () => {
        const pid = branch.dataset.projectId;
        if (pid) {
          const base = (window.DAEMU_BASE || '/');
          window.location.href = base + 'work/' + pid;
        }
      });
    });
  }

  /* ------------------------------------------------------------------
     Run
     ------------------------------------------------------------------ */
  initFilter();
  initPartnerBrands();

  afterSplash(() => {
    initHero();
    initBrandHeads();
    initBranches();
    initExtras();
    initCTA();
    initBranchLinks();

    if (window.ScrollTrigger) {
      const refresh = () => window.ScrollTrigger.refresh();
      if (document.readyState === 'complete') refresh();
      else window.addEventListener('load', refresh);
      document.querySelectorAll('main img').forEach((img) => {
        if (!img.complete) img.addEventListener('load', refresh, { once: true });
      });
    }
  });
})();
