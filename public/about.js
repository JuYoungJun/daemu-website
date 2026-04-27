(function() {
  'use strict';
  const body = document.body;
  if (!body || body.dataset.page !== 'about') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('.dmabout-hero-word').forEach(w => w.style.transform = 'none');
    return;
  }
  function afterSplash(cb) {
    let called = false;
    const run = () => { if (called) return; called = true; cb(); };
    if (body.classList.contains('splash-ready') || !body.classList.contains('splash-pending')) { run(); return; }
    const mo = new MutationObserver(() => { if (body.classList.contains('splash-ready')) { mo.disconnect(); setTimeout(run, 120); } });
    mo.observe(body, { attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { mo.disconnect(); run(); }, 5000);
  }
  if (typeof window.gsap === 'undefined') return;
  const { gsap } = window;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);

  afterSplash(() => {
    gsap.to('.dmabout-hero-word', { y: '0%', duration: 1.2, stagger: 0.15, ease: 'expo.out' });
    gsap.set('.dmabout-hero-sidebar, .dmabout-hero-stats', { opacity: 0 });
    gsap.to('.dmabout-hero-sidebar, .dmabout-hero-stats', { opacity: 1, duration: 0.8, delay: 0.2 });
    gsap.to('.dmabout-hero-caption', { opacity: 1, duration: 0.9, delay: 0.8 });

    document.querySelectorAll('.dmabout-meaning, .dmabout-philosophy, .dmabout-visual, .dmabout-supply, .dmabout-beclassy, .dmabout-cta').forEach(el => {
      const io = new IntersectionObserver(entries => {
        entries.forEach(entry => { if (entry.isIntersecting) { io.disconnect(); gsap.set(el, { opacity: 0 }); gsap.to(el, { opacity: 1, duration: 1.0, ease: 'power3.out' }); } });
      }, { threshold: 0.08 });
      io.observe(el);
    });

    const blocks = document.querySelectorAll('[data-convo-block]');
    let chatStarted = false;

    async function playChat() {
      if (chatStarted) return;
      chatStarted = true;
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const q = block.querySelector('.dmabout-convo-q');
        const a = block.querySelector('[data-convo-a]');
        block.style.display = '';
        if (q) {
          q.classList.add('is-typing');
          await wait(400);
          q.classList.remove('is-typing');
          q.classList.add('is-shown');
          await wait(600);
        }
        if (a) {
          block.classList.add('is-open');
          await wait(300);
          block.scrollIntoView({ block: 'center', behavior: 'smooth' });
          await wait(i < blocks.length - 1 ? 800 : 400);
        }
      }
    }
    function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

    blocks.forEach(b => { b.style.display = 'none'; });

    const histSec = document.querySelector('[data-convo]');
    if (histSec) {
      const hio = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) { hio.disconnect(); playChat(); }
        });
      }, { threshold: 0.1 });
      hio.observe(histSec);
    }

    blocks.forEach(block => {
      const q = block.querySelector('.dmabout-convo-q');
      if (q) q.addEventListener('click', () => {
        if (chatStarted) block.classList.toggle('is-open');
      });
    });

    document.querySelectorAll('.dmabout-visual-item img').forEach(img => {
      if (!window.ScrollTrigger) return;
      gsap.set(img, { scale: 1.15 });
      gsap.to(img, { yPercent: 10, ease: 'none', scrollTrigger: { trigger: img.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
    });

    if (window.ScrollTrigger) { const r = () => window.ScrollTrigger.refresh(); if (document.readyState === 'complete') r(); else window.addEventListener('load', r); }
  });
})();
