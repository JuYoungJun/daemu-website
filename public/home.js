/**
 * DAEMU Home Page — GSAP Animations
 * Runs in addition to script.js
 *
 * Waits for the site splash to finish (body.splash-ready) before
 * triggering the hero animation, so the choreography feels intentional.
 */
(function () {
  'use strict';

  const body = document.body;
  if (!body || body.dataset.page !== 'home') return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // If GSAP isn't available for any reason, fall back gracefully:
  if (typeof window.gsap === 'undefined') {
    body.classList.add('no-gsap');
    // make sure hero words are visible
    document.querySelectorAll('.hero-word').forEach((el) => {
      el.style.transform = 'none';
    });
    // set counters to their target values
    document.querySelectorAll('[data-count-to]').forEach((el) => {
      const target = el.getAttribute('data-count-to') || '';
      const suffix = el.getAttribute('data-suffix') || '';
      el.textContent = target + suffix;
    });
    return;
  }

  const { gsap } = window;
  if (window.ScrollTrigger) {
    gsap.registerPlugin(window.ScrollTrigger);
  }

  /* ------------------------------------------------------------------
     1. Wait for splash
     ------------------------------------------------------------------ */
  function afterSplash(cb) {
    let called = false;
    const runOnce = () => {
      if (called) return;
      called = true;
      cb();
    };

    if (body.classList.contains('splash-ready') || !body.classList.contains('splash-pending')) {
      runOnce();
      return;
    }
    // Observe class changes on <body> to detect when splash finishes.
    const observer = new MutationObserver(() => {
      if (body.classList.contains('splash-ready')) {
        observer.disconnect();
        // Small delay so splash fade is finishing as hero animates in
        setTimeout(runOnce, 120);
      }
    });
    observer.observe(body, { attributes: true, attributeFilter: ['class'] });

    // Safety fallback — if class never flips, run anyway
    setTimeout(() => {
      observer.disconnect();
      runOnce();
    }, 5000);
  }

  /* ------------------------------------------------------------------
     2. Hero intro
     ------------------------------------------------------------------ */
  function initHeroIntro() {
    const heroWords = gsap.utils.toArray('.hero-word');
    const heroEyebrow = document.querySelector('.hero-eyebrow');
    const heroMeta = document.querySelector('.hero-meta-row');
    const heroVisual = document.querySelector('.hero-visual-wrap');

    if (prefersReducedMotion) {
      gsap.set(heroWords, { y: '0%' });
      return;
    }

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    if (heroEyebrow) {
      gsap.set(heroEyebrow, { opacity: 0, y: 12 });
      tl.to(heroEyebrow, { opacity: 1, y: 0, duration: .7 }, 0);
    }

    tl.to(
      heroWords,
      {
        y: '0%',
        duration: 1.15,
        stagger: 0.12,
        ease: 'expo.out',
      },
      .1
    );

    if (heroMeta) {
      gsap.set(heroMeta, { opacity: 0, y: 20 });
      tl.to(heroMeta, { opacity: 1, y: 0, duration: .9 }, .55);
    }

    if (heroVisual) {
      const img = heroVisual.querySelector('.hero-visual-img');
      const caption = heroVisual.querySelector('.hero-caption');
      gsap.set(heroVisual, { clipPath: 'inset(100% 0% 0% 0%)' });
      gsap.set(caption, { opacity: 0, y: 10 });
      tl.to(
        heroVisual,
        { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'expo.out' },
        .4
      );
      if (img) {
        gsap.to(img, { scale: 1.15, duration: 2.2, ease: 'power2.out' });
      }
      if (caption) tl.to(caption, { opacity: 1, y: 0, duration: .7 }, 1.1);
    }
  }

  /* ------------------------------------------------------------------
     3. Hero image parallax on scroll
     ------------------------------------------------------------------ */
  function initHeroParallax() {
    if (prefersReducedMotion || !window.ScrollTrigger) return;
    const img = document.querySelector('.hero-visual-img');
    const frame = document.querySelector('.hero-visual-frame');
    if (!img || !frame) return;

    gsap.to(img, {
      yPercent: 18,
      ease: 'none',
      scrollTrigger: {
        trigger: frame,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  }

  /* ------------------------------------------------------------------
     4. Section reveals — robust fade/rise that never leaves content hidden
     ------------------------------------------------------------------ */
  function isAlreadyInViewport(el) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    // consider "already in view" if any part above 85% line of viewport
    return r.top < vh * 0.85 && r.bottom > 0;
  }

  function revealElement(el, opts) {
    if (!el) return;
    // If element is already in viewport at init time, show it immediately
    // with a gentle animation but no ScrollTrigger dependency.
    if (isAlreadyInViewport(el)) {
      gsap.fromTo(el,
        { opacity: 0, ...opts.from },
        { opacity: 1, ...opts.to, duration: opts.duration || 0.9, ease: 'power3.out', delay: opts.delay || 0 }
      );
      return;
    }
    // Otherwise, use ScrollTrigger but with safeguards
    gsap.fromTo(el,
      { opacity: 0, ...opts.from },
      {
        opacity: 1,
        ...opts.to,
        duration: opts.duration || 0.9,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: el,
          start: 'top 90%',
          once: true,
          // Fallback: if the trigger is never reached for any reason,
          // onRefresh will check position and snap to final state
          onRefresh: (self) => {
            if (self.progress === 1) {
              gsap.set(el, { opacity: 1, ...opts.to });
            }
          },
        },
      }
    );
  }

  function initSectionReveals() {
    if (prefersReducedMotion) return;

    const revealTargets = [
      ['.home-promise .promise-label', { from: { y: 18 }, to: { y: 0 }, duration: 0.7 }],
      ['.home-promise .promise-title', { from: { y: 36 }, to: { y: 0 }, duration: 1.1 }],
      ['.home-promise .promise-body',  { from: { y: 22 }, to: { y: 0 }, duration: 0.9 }],
      ['.home-promise .promise-link',  { from: { y: 18 }, to: { y: 0 }, duration: 0.7 }],

      ['.stages-eyebrow',              { from: { y: 18 }, to: { y: 0 }, duration: 0.7 }],
      ['.stages-title',                { from: { y: 28 }, to: { y: 0 }, duration: 1.0 }],
      ['.stages-link',                 { from: { y: 18 }, to: { y: 0 }, duration: 0.7 }],

      ['.work-eyebrow',                { from: { y: 18 }, to: { y: 0 }, duration: 0.7 }],
      ['.work-title',                  { from: { y: 28 }, to: { y: 0 }, duration: 1.0 }],
      ['.work-more-link',              { from: { y: 18 }, to: { y: 0 }, duration: 0.7 }],

      ['.numbers-eyebrow',             { from: { y: 16 }, to: { y: 0 }, duration: 0.7 }],
      ['.numbers-title',               { from: { y: 24 }, to: { y: 0 }, duration: 1.0 }],

      ['.cta-divider',                 { from: { scaleY: 0, transformOrigin: 'top' }, to: { scaleY: 1 }, duration: 0.9 }],
      ['.cta-eyebrow',                 { from: { y: 14 }, to: { y: 0 }, duration: 0.6 }],
      ['.cta-title',                   { from: { y: 36 }, to: { y: 0 }, duration: 1.1 }],
      ['.cta-body',                    { from: { y: 18 }, to: { y: 0 }, duration: 0.8 }],
      ['.cta-actions',                 { from: { y: 20 }, to: { y: 0 }, duration: 0.8 }],
    ];

    revealTargets.forEach(([selector, opts]) => {
      const el = document.querySelector(selector);
      revealElement(el, opts);
    });
  }

  /* ------------------------------------------------------------------
     5. Stage rows — staggered entrance
     ------------------------------------------------------------------ */
  function initStages() {
    if (prefersReducedMotion || !window.ScrollTrigger) return;
    const rows = gsap.utils.toArray('[data-stage]');
    if (!rows.length) return;

    const container = document.querySelector('.stages-list');
    if (!container) return;

    // If already in viewport, animate immediately without ScrollTrigger
    if (isAlreadyInViewport(container)) {
      gsap.fromTo(rows,
        { y: 40, opacity: 0 },
        { y: 0, opacity: 1, duration: 1, stagger: 0.12, ease: 'power3.out' }
      );
    } else {
      gsap.fromTo(rows,
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          stagger: 0.12,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: container,
            start: 'top 90%',
            once: true,
            onRefresh: (self) => {
              if (self.progress === 1) gsap.set(rows, { y: 0, opacity: 1 });
            },
          },
        }
      );
    }

    // decorative: number colors slightly shift on scroll
    rows.forEach((row) => {
      const numEl = row.querySelector('.home-stage-num');
      if (!numEl) return;
      gsap.to(numEl, {
        color: '#1a1a1a',
        scrollTrigger: {
          trigger: row,
          start: 'top 70%',
          end: 'bottom 50%',
          scrub: true,
        },
      });
    });
  }

  /* ------------------------------------------------------------------
     6. Work cards — staggered entrance
     ------------------------------------------------------------------ */
  function initWorkCards() {
    if (prefersReducedMotion || !window.ScrollTrigger) return;
    const cards = gsap.utils.toArray('[data-work-card]');
    if (!cards.length) return;

    const showcase = document.querySelector('.work-showcase');
    if (!showcase) return;

    // If already in viewport, animate immediately without ScrollTrigger
    if (isAlreadyInViewport(showcase)) {
      gsap.fromTo(cards,
        { y: 60, opacity: 0 },
        { y: 0, opacity: 1, duration: 1.1, stagger: 0.12, ease: 'power3.out' }
      );
    } else {
      gsap.fromTo(cards,
        { y: 60, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1.1,
          stagger: 0.12,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: showcase,
            start: 'top 90%',
            once: true,
            onRefresh: (self) => {
              if (self.progress === 1) gsap.set(cards, { y: 0, opacity: 1 });
            },
          },
        }
      );
    }

    // subtle image parallax for the large card
    const bigCard = document.querySelector('.work-card--lg .work-card-media img');
    if (bigCard) {
      gsap.to(bigCard, {
        yPercent: 8,
        ease: 'none',
        scrollTrigger: {
          trigger: '.work-card--lg',
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
        },
      });
    }
  }

  /* ------------------------------------------------------------------
     7. Number counters
     ------------------------------------------------------------------ */
  function initCounters() {
    const items = document.querySelectorAll('[data-count-to]');
    if (!items.length) return;

    items.forEach((el) => {
      const target = parseFloat(el.getAttribute('data-count-to')) || 0;
      const suffix = el.getAttribute('data-suffix') || '';

      // Always set the final text immediately as a safety baseline.
      // This guarantees the number is visible even if animation never fires.
      el.textContent = target + suffix;

      if (prefersReducedMotion) return;

      // Counter animation
      const runCounter = () => {
        const state = { n: 0 };
        gsap.to(state, {
          n: target,
          duration: 2.2,
          ease: 'power3.out',
          onUpdate: () => {
            const v = state.n;
            const rounded = target >= 10 ? Math.round(v) : v.toFixed(0);
            el.textContent = rounded + suffix;
          },
          onComplete: () => {
            el.textContent = target + suffix;
          },
        });
      };

      if (isAlreadyInViewport(el)) {
        runCounter();
      } else if (window.ScrollTrigger) {
        window.ScrollTrigger.create({
          trigger: el,
          start: 'top 90%',
          once: true,
          onEnter: runCounter,
        });
      }

      // parent item rise - use robust pattern
      const parent = el.closest('.num-item');
      if (parent) {
        revealElement(parent, { from: { y: 24 }, to: { y: 0 }, duration: 0.9 });
      }
    });
  }

  /* ------------------------------------------------------------------
     8. Marquee — subtle scroll-linked speed
     ------------------------------------------------------------------ */
  function initMarqueeScrollTilt() {
    if (prefersReducedMotion || !window.ScrollTrigger) return;
    const track = document.querySelector('.marquee-track');
    if (!track) return;

    // pause the CSS animation for briefly and boost when scrolling
    let lastScroll = 0;
    let direction = 1;
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      direction = y > lastScroll ? 1 : -1;
      lastScroll = y;
      track.style.animationPlayState = 'running';
    }, { passive: true });
  }

  /* ------------------------------------------------------------------
     Highlight underline animation (scroll-triggered)
     ------------------------------------------------------------------ */
  function initHighlightUnderline() {
    const el = document.querySelector('[data-highlight-underline]');
    if (!el) return;

    let triggered = false;
    function check() {
      if (triggered) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // Trigger only when element is in upper 70% of viewport (user has scrolled to it)
      if (rect.top < vh * 0.7 && rect.bottom > 0) {
        triggered = true;
        window.removeEventListener('scroll', check);
        // Delay so user sees the text first, then underline draws
        setTimeout(() => {
          el.style.backgroundSize = '100% 38%';
        }, 500);
      }
    }
    // Don't check immediately — wait for first scroll
    window.addEventListener('scroll', check, { passive: true });
  }

  /* ------------------------------------------------------------------
     Run
     ------------------------------------------------------------------ */
  afterSplash(() => {
    initHeroIntro();
    initHeroParallax();
    initSectionReveals();
    initStages();
    initWorkCards();
    initCounters();
    initMarqueeScrollTilt();
    initHighlightUnderline();

    // Re-calc ScrollTrigger after images load — this is critical because
    // images resize the page and shift trigger positions.
    if (window.ScrollTrigger) {
      const refresh = () => window.ScrollTrigger.refresh();
      // Refresh on window load (all images loaded)
      if (document.readyState === 'complete') {
        refresh();
      } else {
        window.addEventListener('load', refresh);
      }
      // Also refresh when each image in the main content loads
      document.querySelectorAll('main img').forEach((img) => {
        if (!img.complete) {
          img.addEventListener('load', refresh, { once: true });
        }
      });
    }
  });
})();
