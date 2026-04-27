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
