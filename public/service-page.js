
  (function() {
    const body = document.body;
    if (!body || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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
      // Hero word reveal (like team/about)
      gsap.to('.dmsvc-hero-word', { y: '0%', duration: 1.2, stagger: 0.15, ease: 'expo.out' });
      gsap.set('.dmsvc-hero-sidebar, .dmsvc-hero-stats', { opacity: 0 });
      gsap.to('.dmsvc-hero-sidebar, .dmsvc-hero-stats', { opacity: 1, duration: 0.8, delay: 0.2 });
      gsap.to('.dmsvc-hero-caption', { opacity: 1, duration: 0.9, delay: 0.8 });

      // Consulting highlight fade
      const hl = document.querySelector('.dmsvc-highlight');
      if (hl) {
        const hio = new IntersectionObserver(entries => {
          entries.forEach(entry => { if (entry.isIntersecting) { hio.disconnect(); gsap.set(hl, { opacity: 0 }); gsap.to(hl, { opacity: 1, duration: 1, ease: 'power3.out' }); } });
        }, { threshold: 0.1 });
        hio.observe(hl);
      }

      // Numbers fade
      const nums = document.querySelector('.dmsvc-numbers');
      if (nums) {
        const nio = new IntersectionObserver(entries => {
          entries.forEach(entry => { if (entry.isIntersecting) { nio.disconnect(); gsap.set(nums, { opacity: 0 }); gsap.to(nums, { opacity: 1, duration: 1, ease: 'power3.out' }); } });
        }, { threshold: 0.1 });
        nio.observe(nums);
      }

      // Flow steps — sequential reveal
      const steps = document.querySelectorAll('[data-svc-step]');
      steps.forEach((s, i) => {
        gsap.set(s, { opacity: 0, scale: 0.8 });
        const io = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              io.disconnect();
              gsap.to(s, { opacity: 1, scale: 1, duration: 0.6, delay: i * 0.12, ease: 'back.out(1.4)' });
            }
          });
        }, { threshold: 0.3 });
        io.observe(s);
      });

      // Service cards — stagger fade
      const cards = document.querySelectorAll('[data-svc-card]');
      cards.forEach((card, i) => {
        gsap.set(card, { opacity: 0 });
        const io = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              io.disconnect();
              gsap.to(card, { opacity: 1, duration: 0.7, delay: (i % 2) * 0.15, ease: 'power3.out' });
            }
          });
        }, { threshold: 0.1 });
        io.observe(card);
      });

      // Promise section — dramatic entrance
      const promise = document.querySelector('.dmsvc-promise');
      if (promise) {
        const q = promise.querySelector('.dmsvc-promise-quote');
        const b = promise.querySelector('.dmsvc-promise-body');
        if (q) gsap.set(q, { opacity: 0 });
        if (b) gsap.set(b, { opacity: 0 });
        const io = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              io.disconnect();
              if (q) gsap.to(q, { opacity: 1, duration: 1.2, ease: 'power3.out' });
              if (b) gsap.to(b, { opacity: 1, duration: 0.9, delay: 0.6, ease: 'power3.out' });
            }
          });
        }, { threshold: 0.2 });
        io.observe(promise);
      }

      // Sections fade
      document.querySelectorAll('.dmsvc-intro, .dmsvc-options, .dmsvc-cta').forEach(el => {
        const io = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) { io.disconnect(); gsap.set(el, { opacity: 0 }); gsap.to(el, { opacity: 1, duration: 1, ease: 'power3.out' }); }
          });
        }, { threshold: 0.08 });
        io.observe(el);
      });
    });
  })();
  