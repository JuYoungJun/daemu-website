/**
 * DAEMU Team Page — Premium editorial interactions
 * v3 — Cursor removed, autoplay via IntersectionObserver, SVG hover fixed
 */
(function () {
  'use strict';

  const body = document.body;
  if (!body || body.dataset.page !== 'team') return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     GSAP check
     ------------------------------------------------------------------ */
  if (typeof window.gsap === 'undefined') {
    body.classList.add('no-gsap');
    document.querySelectorAll('.dmteam-hero-word').forEach((el) => { el.style.transform = 'none'; });
    initFallbackInteractions();
    return;
  }

  const { gsap } = window;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);

  /* ------------------------------------------------------------------
     afterSplash — runs cb exactly once
     ------------------------------------------------------------------ */
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

  function isInView(el) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return r.top < vh * 0.9 && r.bottom > 0;
  }

  /* ------------------------------------------------------------------
     Hero intro animation
     ------------------------------------------------------------------ */
  function initHero() {
    const words = gsap.utils.toArray('.dmteam-hero-word');
    const sidebar = document.querySelector('.dmteam-hero-sidebar');
    const stats = document.querySelector('.dmteam-hero-stats');
    const caption = document.querySelector('.dmteam-hero-caption');
    const ghost = document.querySelector('.dmteam-hero-ghost');
    const visualFrame = document.querySelector('.dmteam-hero-visual-frame');
    const visualImg = document.querySelector('.dmteam-hero-visual-img');
    const visualTag = document.querySelector('.dmteam-hero-visual-tag');
    const scrollCue = document.querySelector('.dmteam-hero-scroll');

    if (prefersReducedMotion) {
      gsap.set(words, { y: '0%' });
      if (caption) gsap.set(caption, { opacity: 1, y: 0 });
      if (visualFrame) gsap.set(visualFrame, { clipPath: 'inset(0 0 0 0)' });
      if (visualImg) gsap.set(visualImg, { scale: 1.15 });
      if (visualTag) gsap.set(visualTag, { opacity: 1, y: 0 });
      return;
    }

    // Initial states
    if (sidebar) gsap.set(sidebar, { opacity: 0 });
    if (stats) gsap.set(stats, { opacity: 0 });
    if (ghost) gsap.set(ghost, { opacity: 0, scale: .95 });
    if (scrollCue) gsap.set(scrollCue, { opacity: 0 });

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    if (ghost) tl.to(ghost, { opacity: 1, scale: 1, duration: 1.8, ease: 'power2.out' }, 0);
    if (sidebar) tl.to(sidebar, { opacity: 1, duration: .8 }, .15);
    if (stats) tl.to(stats, { opacity: 1, duration: .8 }, .15);

    tl.to(words, {
      y: '0%',
      duration: 1.2,
      stagger: 0.15,
      ease: 'expo.out',
    }, .3);

    if (caption) tl.to(caption, { opacity: 1, y: 0, duration: .9 }, .9);

    if (visualFrame) {
      tl.to(visualFrame, { clipPath: 'inset(0 0 0 0)', duration: 1.4, ease: 'expo.out' }, .7);
    }
    if (visualImg) {
      gsap.to(visualImg, { scale: 1.15, duration: 2.4, ease: 'power2.out', delay: .7 });
    }
    if (visualTag) tl.to(visualTag, { opacity: 1, y: 0, duration: .7 }, 1.6);
    if (scrollCue) tl.to(scrollCue, { opacity: 1, duration: .8 }, 1.4);

    // Ghost number subtle parallax on scroll
    if (window.ScrollTrigger && ghost) {
      gsap.to(ghost, {
        yPercent: 15,
        ease: 'none',
        scrollTrigger: {
          trigger: '.dmteam-hero',
          start: 'top top',
          end: 'bottom top',
          scrub: true,
        },
      });
    }
    // Visual image parallax — noticeable movement
    if (window.ScrollTrigger && visualImg) {
      gsap.to(visualImg, {
        yPercent: 15,
        ease: 'none',
        scrollTrigger: {
          trigger: visualFrame,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
        },
      });
    }
  }

  /* ------------------------------------------------------------------
     Section reveals — always-visible baseline, entrance tween only
     ------------------------------------------------------------------ */
  function playReveal(el, opts) {
    if (!el || el._revealed) return;
    el._revealed = true;
    gsap.set(el, { opacity: 0 });
    gsap.to(el, {
      opacity: 1,
      duration: opts.duration || 0.9,
      ease: 'power3.out',
      delay: opts.delay || 0,
    });
  }

  function scheduleReveal(el, opts) {
    if (!el) return;
    if (isInView(el)) {
      playReveal(el, opts);
    } else {
      // Use IntersectionObserver for reliable triggering
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            io.disconnect();
            playReveal(el, opts);
          }
        });
      }, { threshold: 0.05 });
      io.observe(el);
    }
  }

  function initSectionReveals() {
    if (prefersReducedMotion) return;

    const targets = [
      ['.dmteam-philo-label',   { duration: 0.7 }],
      ['.dmteam-philo-title',   { duration: 1.0 }],
      ['.dmteam-philo-body',    { duration: 0.9 }],

      ['.dmteam-grid-eyebrow',  { duration: 0.7 }],
      ['.dmteam-grid-title',    { duration: 1.0 }],
      ['.dmteam-grid-hint',     { duration: 0.7, delay: .1 }],

      ['.dmteam-flow-eyebrow',  { duration: 0.7 }],
      ['.dmteam-flow-title',    { duration: 1.0 }],
      ['.dmteam-flow-desc',     { duration: 0.9 }],

      ['.dmteam-cta-divider',   { scaleY: 0, transformOrigin: 'top', duration: 0.9 }],
      ['.dmteam-cta-eyebrow',   { duration: 0.6 }],
      ['.dmteam-cta-title',     { duration: 1.0 }],
      ['.dmteam-cta-body',      { duration: 0.8 }],
      ['.dmteam-cta-actions',   { duration: 0.8 }],
    ];

    targets.forEach(([sel, opts]) => {
      scheduleReveal(document.querySelector(sel), { from: opts, duration: opts.duration, delay: opts.delay });
    });
  }

  function initCardReveals() {
    if (prefersReducedMotion) return;
    const cards = gsap.utils.toArray('[data-dmteam-card]');
    if (!cards.length) return;
    const container = document.querySelector('.dmteam-cards');
    if (!container) return;

    let played = false;
    const play = () => {
      if (played) return;
      played = true;
      // Set initial state, then animate to visible
      gsap.set(cards, { opacity: 0 });
      gsap.to(cards, {
        opacity: 1, duration: 0.9, stagger: 0.08, ease: 'power3.out',
      });
    };

    if (isInView(container)) {
      play();
    } else {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) { io.disconnect(); play(); }
        });
      }, { threshold: 0.1 });
      io.observe(container);
    }
  }

  function initFlowReveals() {
    if (prefersReducedMotion) return;
    const nodes = gsap.utils.toArray('.dmteam-flow-node');
    const svg = document.querySelector('.dmteam-flow-svg');
    if (nodes.length && svg) {
      let nodesPlayed = false;
      const playNodes = () => {
        if (nodesPlayed) return;
        nodesPlayed = true;
        gsap.set(nodes, { scale: 0, opacity: 0, transformOrigin: '50% 50%' });
        gsap.to(nodes, {
          scale: 1, opacity: 1, duration: 0.8, stagger: 0.12, ease: 'power3.out',
        });
      };
      if (isInView(svg)) playNodes();
      else {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) { io.disconnect(); playNodes(); }
          });
        }, { threshold: 0.1 });
        io.observe(svg);
      }
    }

    const principles = gsap.utils.toArray('.dmteam-flow-principle');
    const container = document.querySelector('[data-principles]');
    if (principles.length && container) {
      let principlesPlayed = false;
      const playPrinciples = () => {
        if (principlesPlayed) return;
        principlesPlayed = true;
        gsap.set(principles, { opacity: 0 });
        gsap.to(principles, {
          opacity: 1, duration: 0.9, stagger: 0.1, ease: 'power3.out',
        });
      };
      if (isInView(container)) playPrinciples();
      else {
        const io = new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) { io.disconnect(); playPrinciples(); }
          });
        }, { threshold: 0.1 });
        io.observe(container);
      }
    }
  }

  /* ------------------------------------------------------------------
     TEAM DATA for flow interaction
     ------------------------------------------------------------------ */
  const TEAM_DATA = {
    strategy:     { node: 1, cx: 100, num: '01', cat: 'STRATEGY',     name: 'Strategy Team',     hint: 'Opens the project', desc: '브랜드 전략과 포지셔닝부터 비즈니스 모델 설계까지, 고객의 목표에 도달하는 방향을 설계합니다.' },
    rnd:          { node: 2, cx: 300, num: '02', cat: 'R&D',          name: 'R&D Team',          hint: 'Product core',      desc: '메뉴와 제품을 개발하고 지속 가능한 운영 레시피를 구축해 브랜드의 경쟁력을 만듭니다.' },
    architecture: { node: 3, cx: 500, num: '03', cat: 'ARCHITECTURE', name: 'Architecture Team', hint: 'Physical form',     desc: '매장 동선, 주방 설계, 인테리어 시공까지 브랜드 컨셉에 맞는 공간을 구현합니다.' },
    design:       { node: 4, cx: 700, num: '04', cat: 'DESIGN',       name: 'Design Team',       hint: 'Visual voice',      desc: '로고, 패키지, 공간까지 브랜드의 톤을 시각 언어로 정리해 일관된 경험을 설계합니다.' },
    operations:   { node: 5, cx: 900, num: '05', cat: 'OPERATIONS',   name: 'Operations Team',   hint: 'Delivers daily',    desc: '운영 매뉴얼과 교육 시스템을 통해 매장이 안정적으로 운영될 수 있도록 지원합니다.' },
  };
  const TEAM_ORDER = ['strategy', 'rnd', 'architecture', 'design', 'operations'];

  /* ------------------------------------------------------------------
     Flow interaction — fully robust click/hover/autoplay
     ------------------------------------------------------------------ */
  function initFlowInteraction() {
    const diagram = document.querySelector('[data-flow-diagram]');
    if (!diagram) return;

    const nodes = Array.from(diagram.querySelectorAll('.dmteam-flow-node'));
    const cardEls = Array.from(document.querySelectorAll('.dmteam-card[data-team-id]'));
    const cardsMap = {};
    cardEls.forEach((c) => { cardsMap[c.dataset.teamId] = c; });

    const progressLine = diagram.querySelector('.dmteam-flow-progress-line');
    const progressFill = diagram.querySelector('[data-flow-progress]');
    const detailNum = diagram.querySelector('[data-flow-detail-num]');
    const detailCat = diagram.querySelector('[data-flow-detail-cat]');
    const detailName = diagram.querySelector('[data-flow-detail-name]');
    const detailHint = diagram.querySelector('[data-flow-detail-hint]');
    const detailDesc = diagram.querySelector('[data-flow-detail-desc]');
    const detailPanel = diagram.querySelector('[data-flow-detail]');
    const stepEl = diagram.querySelector('[data-flow-step]');
    const playBtn = diagram.querySelector('[data-flow-play]');
    const playLabel = playBtn && playBtn.querySelector('[data-flow-label]');

    // State machine
    let lockedTeam = null;     // set on click (persists)
    let previewTeam = null;    // set on hover (ephemeral)
    let autoplayTimer = null;
    let autoplayIndex = 0;

    function currentTeam() {
      return previewTeam || lockedTeam;
    }

    function updateView() {
      const team = currentTeam();
      const data = team ? TEAM_DATA[team] : null;

      // Nodes
      nodes.forEach((n) => {
        const id = n.dataset.teamId;
        n.classList.toggle('is-preview', previewTeam === id && lockedTeam !== id);
        n.classList.toggle('is-locked', lockedTeam === id);
      });

      // Cards — dim only when LOCKED (not preview)
      cardEls.forEach((c) => {
        const id = c.dataset.teamId;
        c.classList.toggle('is-focused', team === id);
        c.classList.toggle('is-dimmed', !!lockedTeam && id !== lockedTeam);
      });

      // Progress
      if (progressLine && data) {
        progressLine.setAttribute('x2', String(data.cx));
      } else if (progressLine) {
        progressLine.setAttribute('x2', '100');
      }
      if (progressFill) {
        if (data) {
          const idx = TEAM_ORDER.indexOf(team);
          const pct = ((idx + 1) / TEAM_ORDER.length) * 100;
          progressFill.style.width = pct + '%';
        } else {
          progressFill.style.width = '0%';
        }
      }

      // Step indicator
      if (stepEl) {
        if (team) {
          const idx = TEAM_ORDER.indexOf(team);
          stepEl.textContent = String(idx + 1).padStart(2, '0') + ' / 05';
        } else {
          stepEl.textContent = '— / 05';
        }
      }

      // Detail panel
      if (data) {
        if (detailNum)  detailNum.textContent  = data.num;
        if (detailCat)  detailCat.textContent  = data.cat;
        if (detailName) detailName.textContent = data.name;
        if (detailHint) detailHint.textContent = data.hint;
        if (detailDesc) detailDesc.textContent = data.desc;
        if (detailPanel) {
          detailPanel.classList.remove('is-changed');
          void detailPanel.offsetWidth;
          detailPanel.classList.add('is-changed');
        }
      }
    }

    function pulseNode(nodeEl) {
      // Pulse removed — wobble effect not desired
    }

    /* ----- Node events — use hit-area circles to avoid SVG mouseleave bubbling ----- */
    let hoverDebounce = null;

    nodes.forEach((n) => {
      const hit = n.querySelector('.dmteam-flow-node-hit');
      const eventTarget = hit || n;

      eventTarget.addEventListener('mouseenter', () => {
        if (autoplayTimer) return;
        clearTimeout(hoverDebounce);
        hoverDebounce = null;
        previewTeam = n.dataset.teamId;
        updateView();
      });
      eventTarget.addEventListener('mouseleave', (e) => {
        if (autoplayTimer) return;
        // Debounce: only clear preview if the mouse actually left all nodes
        // (SVG events can fire spuriously when transitioning between child elements)
        clearTimeout(hoverDebounce);
        hoverDebounce = setTimeout(() => {
          // Double-check: if previewTeam is still this node and mouse isn't over any node
          if (previewTeam === n.dataset.teamId) {
            previewTeam = null;
            updateView();
          }
        }, 80);
      });

      // Click on the whole node group
      n.addEventListener('click', (e) => {
        e.stopPropagation();
        clearTimeout(hoverDebounce);
        hoverDebounce = null;
        stopAutoplay();
        const id = n.dataset.teamId;
        if (lockedTeam === id) {
          lockedTeam = null;
          previewTeam = null;
        } else {
          lockedTeam = id;
          previewTeam = null;
        }
        updateView();
        pulseNode(n);
      });
      n.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          n.click();
        }
      });
    });

    /* ----- Card click: lock + smooth scroll to flow diagram ----- */
    cardEls.forEach((c) => {
      c.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        stopAutoplay();
        const id = c.dataset.teamId;
        if (lockedTeam === id) {
          lockedTeam = null;
        } else {
          lockedTeam = id;
        }
        previewTeam = null;
        updateView();

        // Scroll to flow diagram so user sees the detail panel
        if (lockedTeam && diagram) {
          const diagramRect = diagram.getBoundingClientRect();
          const targetY = window.pageYOffset + diagramRect.top - 100;
          window.scrollTo({ top: targetY, behavior: 'smooth' });
        }
      });
    });

    /* ----- Autoplay ----- */
    function stepAutoplay() {
      nodes.forEach((n) => {
        const idx = TEAM_ORDER.indexOf(n.dataset.teamId);
        n.classList.toggle('is-visited', idx < autoplayIndex);
      });
      const id = TEAM_ORDER[autoplayIndex];
      previewTeam = id;
      updateView();
      const node = nodes.find((nn) => nn.dataset.teamId === id);
      if (node) pulseNode(node);

      autoplayIndex++;
      if (autoplayIndex < TEAM_ORDER.length) {
        autoplayTimer = setTimeout(stepAutoplay, 1400);
      } else {
        // finish
        autoplayTimer = setTimeout(() => {
          nodes.forEach((n) => n.classList.remove('is-visited'));
          if (playBtn) playBtn.classList.remove('is-playing');
          if (playLabel) playLabel.textContent = 'Play again';
          autoplayTimer = null;
          // Clear final preview after breath
          setTimeout(() => {
            if (!autoplayTimer && !lockedTeam) {
              previewTeam = null;
              updateView();
            }
          }, 2000);
        }, 1600);
      }
    }

    function startAutoplay() {
      stopAutoplay();
      lockedTeam = null;
      autoplayIndex = 0;
      if (playBtn) playBtn.classList.add('is-playing');
      if (playLabel) playLabel.textContent = 'Playing…';
      stepAutoplay();
    }

    function stopAutoplay() {
      if (autoplayTimer) {
        clearTimeout(autoplayTimer);
        autoplayTimer = null;
      }
      nodes.forEach((n) => n.classList.remove('is-visited'));
      if (playBtn) playBtn.classList.remove('is-playing');
      if (playLabel && playLabel.textContent === 'Playing…') {
        playLabel.textContent = 'Play again';
      }
    }

    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (autoplayTimer) {
          stopAutoplay();
          if (playLabel) playLabel.textContent = 'Play the flow';
        } else {
          startAutoplay();
        }
      });
    }

    // Auto-start once on scroll into view — use IntersectionObserver (more reliable than ScrollTrigger)
    if (!prefersReducedMotion) {
      let autoplayFired = false;
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !autoplayFired) {
            autoplayFired = true;
            io.disconnect();
            setTimeout(startAutoplay, 600);
          }
        });
      }, { threshold: 0.25 });
      io.observe(diagram);
    }

    // Click outside clears lock
    document.addEventListener('click', (e) => {
      if (!e.target.closest('[data-flow-diagram]') && !e.target.closest('.dmteam-card')) {
        if (lockedTeam) {
          lockedTeam = null;
          previewTeam = null;
          updateView();
        }
      }
    });
  }

  /* ------------------------------------------------------------------
     Card tilt — REMOVED per user feedback (causes screen wobble)
     ------------------------------------------------------------------ */
  function initCardTilt() {
    // Intentionally empty — tilt removed per user request
  }

  /* ------------------------------------------------------------------
     Number flip — removed (movement distraction)
     ------------------------------------------------------------------ */
  function initNumberFlip() {
    // Intentionally empty
  }

  /* ------------------------------------------------------------------
     Principles hover
     ------------------------------------------------------------------ */
  function initPrinciples() {
    if (prefersReducedMotion) return;
    const items = document.querySelectorAll('[data-principle]');
    items.forEach((item) => {
      item.addEventListener('mouseenter', () => {
        items.forEach((o) => {
          o.classList.toggle('is-dimmed', o !== item);
          o.classList.toggle('is-focused', o === item);
        });
      });
      item.addEventListener('mouseleave', () => {
        items.forEach((o) => {
          o.classList.remove('is-dimmed', 'is-focused');
        });
      });
    });
  }

  /* ------------------------------------------------------------------
     Philosophy highlight — underline scroll-triggered
     ------------------------------------------------------------------ */
  function initPhilosophyHighlight() {
    if (prefersReducedMotion || !window.ScrollTrigger) return;
    const strong = document.querySelector('[data-philo-strong]');
    if (!strong) return;
    gsap.to(strong, {
      backgroundSize: '100% 38%',
      duration: 1.2,
      ease: 'power3.out',
      scrollTrigger: {
        trigger: strong,
        start: 'top 80%',
        once: true,
      },
    });
  }

  /* ------------------------------------------------------------------
     Card stat counters — count up when expand shows
     ------------------------------------------------------------------ */
  function initStatCounters() {
    document.querySelectorAll('[data-count]').forEach((el) => {
      const target = parseInt(el.dataset.count, 10);
      const suffix = el.dataset.suffix || '';
      // Baseline visible
      el.textContent = target + suffix;
      if (prefersReducedMotion) return;

      const card = el.closest('.dmteam-card');
      if (!card) return;
      let played = false;
      const play = () => {
        if (played) return;
        played = true;
        const state = { n: 0 };
        gsap.to(state, {
          n: target, duration: 1.4, ease: 'power3.out',
          onUpdate: () => { el.textContent = Math.round(state.n) + suffix; },
          onComplete: () => { el.textContent = target + suffix; },
        });
      };
      card.addEventListener('mouseenter', play, { once: false });
    });
  }

  /* ------------------------------------------------------------------
     Hero title — mouse parallax REMOVED (user found wobble distracting)
     ------------------------------------------------------------------ */
  function initHeroMouseParallax() {
    // Intentionally empty — removed per user feedback
  }

  /* ------------------------------------------------------------------
     Magnetic CTA buttons — REMOVED (wobble feedback)
     ------------------------------------------------------------------ */
  function initMagneticButtons() {
    // Intentionally empty — removed per user feedback
  }

  /* ------------------------------------------------------------------
     Scroll progress indicator (top edge thin bar)
     ------------------------------------------------------------------ */
  function initScrollProgress() {
    // Create bar if it doesn't exist
    let bar = document.querySelector('.dmteam-scroll-progress');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'dmteam-scroll-progress';
      bar.innerHTML = '<div class="dmteam-scroll-progress-fill"></div>';
      document.body.appendChild(bar);
    }
    const fill = bar.querySelector('.dmteam-scroll-progress-fill');
    if (!fill) return;

    function update() {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const pct = h > 0 ? (window.pageYOffset / h) * 100 : 0;
      fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
  }

  /* ------------------------------------------------------------------
     Card big watermark — opacity reacts to scroll proximity
     ------------------------------------------------------------------ */
  function initBigNumReveal() {
    // BigNum watermarks are always visible via CSS opacity — no animation needed
  }

  /* ------------------------------------------------------------------
     Fallback (no GSAP)
     ------------------------------------------------------------------ */
  function initFallbackInteractions() {
    // Even without GSAP, flow click/hover and cards work via CSS.
    // We wire up only the state toggles.
    const nodes = document.querySelectorAll('.dmteam-flow-node');
    const cards = document.querySelectorAll('.dmteam-card[data-team-id]');
    const step = document.querySelector('[data-flow-step]');

    let locked = null;
    const setLocked = (id) => {
      locked = (locked === id) ? null : id;
      nodes.forEach((n) => n.classList.toggle('is-locked', n.dataset.teamId === locked));
      cards.forEach((c) => {
        c.classList.toggle('is-focused', c.dataset.teamId === locked);
        c.classList.toggle('is-dimmed', !!locked && c.dataset.teamId !== locked);
      });
      if (step && locked) {
        const idx = TEAM_ORDER.indexOf(locked);
        step.textContent = String(idx + 1).padStart(2, '0') + ' / 05';
      } else if (step) {
        step.textContent = '— / 05';
      }
    };
    nodes.forEach((n) => n.addEventListener('click', () => setLocked(n.dataset.teamId)));
    cards.forEach((c) => c.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      setLocked(c.dataset.teamId);
    }));
  }

  /* ------------------------------------------------------------------
     Run
     ------------------------------------------------------------------ */
  // cursor removed — no-op placeholder

  afterSplash(() => {
    initHero();
    initSectionReveals();
    initCardReveals();
    initFlowReveals();
    initFlowInteraction();
    initCardTilt();
    initNumberFlip();
    initPrinciples();
    initPhilosophyHighlight();
    initStatCounters();
    initHeroMouseParallax();
    initMagneticButtons();
    initScrollProgress();
    initBigNumReveal();

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
