
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
      gsap.to('.dmprc-hero-word', { y: '0%', duration: 1.2, stagger: 0.15, ease: 'expo.out' });
      gsap.set('.dmprc-hero-sidebar, .dmprc-hero-stats', { opacity: 0 });
      gsap.to('.dmprc-hero-sidebar, .dmprc-hero-stats', { opacity: 1, duration: 0.8, delay: 0.2 });
      gsap.to('.dmprc-hero-caption', { opacity: 1, duration: 0.9, delay: 0.8 });

      // Steps sequential reveal
      document.querySelectorAll('[data-prc-step]').forEach((s, i) => {
        gsap.set(s, { opacity: 0 });
        const io = new IntersectionObserver(entries => {
          entries.forEach(entry => { if (entry.isIntersecting) { io.disconnect(); gsap.to(s, { opacity: 1, duration: 0.5, delay: i * 0.08, ease: 'power3.out' }); } });
        }, { threshold: 0.2 });
        io.observe(s);
      });

      // Section fades
      document.querySelectorAll('.dmprc-compare, .dmprc-summary, .dmprc-form').forEach(el => {
        const io = new IntersectionObserver(entries => {
          entries.forEach(entry => { if (entry.isIntersecting) { io.disconnect(); gsap.set(el, { opacity: 0 }); gsap.to(el, { opacity: 1, duration: 1, ease: 'power3.out' }); } });
        }, { threshold: 0.08 });
        io.observe(el);
      });
    });
  })();
  