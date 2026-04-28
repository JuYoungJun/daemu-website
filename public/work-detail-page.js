
  (function() {
    const PROJECTS = {
      'beclassy-naju': {
        brand: 'BECLASSY · COFFEE & BAKERY',
        title: 'Beclassy <em>나주점</em>',
        addr: '전라남도 나주시 노안면 건재로 524-11',
        img: 'assets/work-beclassy-1.png',
        tags: ['브랜드 런칭', '메뉴 개발', '운영 설계', '공간 설계'],
        stats: [{ label: 'SIZE', val: '170평' }, { label: 'YEAR', val: '2018' }, { label: 'FLOORS', val: '4층' }],
        overview: '비클래시 나주점은 대무의 첫 번째 프로젝트로, 브랜드 전략부터 메뉴 개발, 공간 설계, 운영 시스템까지 전 과정을 설계한 플래그십 매장입니다. 170평 4층 규모의 대형 카페로, 시그니처 몽블랑과 함께 나주 지역의 랜드마크로 자리잡았습니다.',
        process: [
          { num: '01', title: '브랜드 전략 수립', desc: '타겟 고객 분석, 경쟁 환경 조사, 브랜드 포지셔닝 전략 수립' },
          { num: '02', title: '메뉴 R&D', desc: '시그니처 몽블랑 개발, 음료/베이커리 라인업 구성, 레시피 표준화' },
          { num: '03', title: '공간 설계 & 시공', desc: '4층 동선 설계, 주방 레이아웃, 인테리어 컨셉 & 시공 감리' },
          { num: '04', title: '오픈 & 운영', desc: '운영 매뉴얼 제작, 직원 교육, 오픈 지원, 지속 운영 컨설팅' },
        ],
      },
      'beclassy-incheon': {
        brand: 'BECLASSY · COFFEE & BAKERY',
        title: 'Beclassy <em>인천점</em>',
        addr: '인천광역시 중구 을왕리',
        img: 'assets/work-beclassy-2.png',
        tags: ['지점 확장', '공간 디자인', '메뉴 현지화', '운영 이관'],
        stats: [{ label: 'SIZE', val: '350평' }, { label: 'YEAR', val: '2024' }, { label: 'CONCEPT', val: '오션뷰' }],
        overview: '비클래시 인천점은 을왕리 해변가에 위치한 350평 규모의 오션뷰 카페입니다. 나주 본점의 성공 경험을 바탕으로 인천 지역에 맞춤화된 메뉴와 공간 디자인을 적용했습니다.',
        process: [
          { num: '01', title: '입지 분석 & 전략', desc: '을왕리 상권 분석, 오션뷰 컨셉 수립, 경쟁 차별화 전략' },
          { num: '02', title: '공간 설계', desc: '350평 대형 공간 동선 설계, 오션뷰 극대화 좌석 배치' },
          { num: '03', title: '메뉴 현지화', desc: '인천 고객 취향 분석, 시즌 한정 메뉴 개발' },
          { num: '04', title: '오픈 운영', desc: '직원 채용·교육, 오픈 마케팅, 운영 안정화' },
        ],
      },
      'pumjang-naju': {
        brand: 'PUMJANG · 장어 전문',
        title: 'Pumjang <em>나주 본점</em>',
        addr: '전라남도 나주시',
        img: 'assets/work-pumjang-1.png',
        tags: ['브랜드 런칭', '메뉴 개발', '공간 설계'],
        stats: [{ label: 'TYPE', val: '본점' }, { label: 'YEAR', val: '2020' }, { label: 'SPECIALTY', val: '프리미엄 장어' }],
        overview: '품장 나주 본점은 프리미엄 장어 전문 브랜드의 첫 번째 매장으로, 전통 장어 요리를 현대적으로 재해석한 메뉴와 공간을 선보입니다.',
        process: [
          { num: '01', title: '컨셉 개발', desc: '프리미엄 장어 전문점 브랜드 포지셔닝' },
          { num: '02', title: '메뉴 설계', desc: '장어 코스 구성, 조리법 표준화' },
          { num: '03', title: '공간 & 운영', desc: '매장 설계, 주방 동선, 운영 시스템 구축' },
        ],
      },
      'pumjang-incheon': {
        brand: 'PUMJANG · 장어 전문',
        title: 'Pumjang <em>인천점</em>',
        addr: '인천광역시',
        img: 'assets/work-pumjang-2.png',
        tags: ['지점 확장', '공간 디자인', 'NEW'],
        stats: [{ label: 'STATUS', val: 'NEW' }, { label: 'YEAR', val: '2024' }],
        overview: '품장 인천점은 나주 본점의 성공을 바탕으로 확장한 두 번째 매장입니다. 인천 지역 고객을 위한 새로운 공간 디자인과 서비스를 제공합니다.',
        process: [
          { num: '01', title: '지점 확장 전략', desc: '인천 상권 분석, 타겟 고객 재설정' },
          { num: '02', title: '공간 디자인', desc: '인천점만의 인테리어 컨셉 설계' },
          { num: '03', title: '운영 이관', desc: '본점 운영 노하우 이관, 현지 팀 교육' },
        ],
      },
      'morif-sangmu': {
        brand: 'MORIF · ORIENTAL CLINIC',
        title: 'Morif <em>상무점</em>',
        addr: '광주광역시 서구 상무지구',
        img: 'assets/work-morif-1.png',
        tags: ['브랜드 런칭', '플래그십', '공간 설계', '한방 클리닉'],
        stats: [{ label: 'TYPE', val: 'Flagship' }, { label: 'YEAR', val: '2022' }, { label: 'CITY', val: '광주' }],
        overview: '모리프 상무점은 광주 상무지구에 위치한 한방 피부관리 전문 클리닉입니다. 동양 의학과 현대 피부 관리 기술을 결합한 프리미엄 공간으로, 브랜드 컨셉 개발부터 공간 설계까지 대무가 함께했습니다.',
        process: [
          { num: '01', title: '브랜드 아이덴티티', desc: '모리프 브랜드 스토리, 로고, 비주얼 시스템 개발' },
          { num: '02', title: '공간 컨셉 설계', desc: '한방 클리닉에 맞는 프리미엄 인테리어 컨셉 개발' },
          { num: '03', title: '플래그십 공간', desc: '상무지구 입지에 맞는 프리미엄 클리닉 공간 설계' },
          { num: '04', title: '운영 컨설팅', desc: '클리닉 운영 시스템 구축, 고객 동선 최적화' },
        ],
      },
      'morif-suwan': {
        brand: 'MORIF · ORIENTAL CLINIC',
        title: 'Morif <em>수완점</em>',
        addr: '광주광역시 광산구 수완지구',
        img: 'assets/work-morif-2.png',
        tags: ['지점 확장', '공간 설계'],
        stats: [{ label: 'TYPE', val: '2nd' }, { label: 'YEAR', val: '2023' }, { label: 'CITY', val: '광주' }],
        overview: '모리프 수완점은 상무 플래그십의 성공을 바탕으로 수완지구에 오픈한 두 번째 클리닉입니다. 지역 특성에 맞춘 서비스 조정과 효율적인 운영 구조를 적용했습니다.',
        process: [
          { num: '01', title: '2호점 전략', desc: '수완지구 상권 분석, 1호점 대비 차별화 포인트 설정' },
          { num: '02', title: '공간 최적화', desc: '클리닉 동선 최적화, 프라이빗 시술 공간 설계' },
          { num: '03', title: '운영 안정화', desc: '본점 운영 노하우 이관, 현지 팀 교육' },
        ],
      },
    };

    const ORDER = ['beclassy-naju','beclassy-incheon','pumjang-naju','pumjang-incheon','morif-sangmu','morif-suwan'];

    const m = window.location.pathname.match(/\/work\/([^/]+)/);
    const pid = (m && m[1]) || (new URLSearchParams(window.location.search)).get('project') || 'beclassy-naju';
    const isPreview = (new URLSearchParams(window.location.search)).get('preview') === '1';

    function adaptDb(p) {
      // Adapt admin-works DB project shape → work-detail data shape
      const heroSrc = p.hero || (p.images && p.images[0] && p.images[0].src) || (p.img || '');
      return {
        brand: p.brandLine || p.brand,
        title: p.title || ((p.brand || '') + ' <em>' + (p.name || '') + '</em>'),
        addr: p.addr || '',
        img: heroSrc,
        tags: p.tags && p.tags.length ? p.tags : [],
        stats: p.stats && p.stats.length ? p.stats : [],
        overview: p.overview || p.desc || '',
        process: p.process || [],
        gallery: (p.images || []).map(i => i.src).filter(Boolean),
        slug: p.slug
      };
    }

    let data;
    let allDbProjects = [];
    try { allDbProjects = (window.DB && window.DB.get) ? window.DB.get('projects') : (JSON.parse(localStorage.getItem('daemu_projects') || '[]')); } catch(e) {}

    if (isPreview) {
      try {
        const draft = JSON.parse(sessionStorage.getItem('daemu_work_preview_' + pid) || 'null');
        if (draft) data = adaptDb(draft);
      } catch(e) {}
    }
    if (!data) {
      const fromDb = allDbProjects.find(p => p.slug === pid);
      if (fromDb) data = adaptDb(fromDb);
    }
    if (!data && PROJECTS[pid]) {
      data = PROJECTS[pid];
    }

    if (!data) {
      document.querySelector('.wd-page').innerHTML = '<div class="wide" style="padding:200px 0;text-align:center"><h2>프로젝트를 찾을 수 없습니다</h2><a href="/work" class="wd-back" style="margin-top:40px">← 돌아가기</a></div>';
      return;
    }

    // Snyk DOMXSS fix: data.title comes from URL slug → DB lookup. The
    // title has long contained literal HTML (e.g. "Beclassy <em>나주점</em>"),
    // which is why innerHTML was used. Switch to escHtml + a single allow-
    // listed <em> tag so the visual flair survives but injection doesn't.
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"'`]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
    const escAllowEm = (s) => esc(s).replace(/&lt;em&gt;/g, '<em>').replace(/&lt;\/em&gt;/g, '</em>');

    document.title = String(data.title || '').replace(/<[^>]+>/g, '') + ' — DAEMU';
    document.getElementById('wd-brand').textContent = data.brand || '';
    document.getElementById('wd-title').innerHTML = escAllowEm(data.title || '');
    document.getElementById('wd-addr').textContent = data.addr || '';
    if (data.img) {
      document.getElementById('wd-img').src = data.img;
      document.getElementById('wd-img').alt = String(data.title || '').replace(/<[^>]+>/g, '');
    }

    const tagsEl = document.getElementById('wd-tags');
    (data.tags || []).forEach(t => { const s = document.createElement('span'); s.textContent = t; tagsEl.appendChild(s); });

    const statsEl = document.getElementById('wd-stats');
    (data.stats || []).forEach(s => {
      // Snyk DOMXSS fix: build node tree, no innerHTML.
      const wrap = document.createElement('div');
      wrap.className = 'wd-hero-stat';
      const lab = document.createElement('span'); lab.className = 'wd-hero-stat-label'; lab.textContent = s.label;
      const val = document.createElement('span'); val.className = 'wd-hero-stat-val serif'; val.textContent = s.val;
      wrap.appendChild(lab); wrap.appendChild(val);
      statsEl.appendChild(wrap);
    });

    document.getElementById('wd-overview-body').textContent = data.overview || '';

    const processEl = document.getElementById('wd-process');
    (data.process || []).forEach(p => {
      // Snyk DOMXSS fix: build node tree, no innerHTML.
      const item = document.createElement('div'); item.className = 'wd-process-item';
      const num = document.createElement('div'); num.className = 'wd-process-item-num serif'; num.textContent = p.num;
      const ttl = document.createElement('div'); ttl.className = 'wd-process-item-title'; ttl.textContent = p.title;
      const desc = document.createElement('div'); desc.className = 'wd-process-item-desc'; desc.textContent = p.desc;
      item.appendChild(num); item.appendChild(ttl); item.appendChild(desc);
      processEl.appendChild(item);
    });

    // Gallery — use real gallery images if present, else fall back to hero image
    const galleryEl = document.getElementById('wd-gallery');
    const galleryImgs = (data.gallery && data.gallery.length) ? data.gallery : [data.img, data.img, data.img];
    galleryImgs.forEach((src, i) => {
      if (!src) return;
      const img = document.createElement('img');
      img.src = src;
      img.alt = `${(data.title || '').replace(/<[^>]+>/g, '')} 사진 ${i + 1}`;
      galleryEl.appendChild(img);
    });

    // Prev/Next navigation — combine DB slugs and ORDER
    const dbSlugs = allDbProjects.map(p => p.slug).filter(Boolean);
    const navOrder = Array.from(new Set([...dbSlugs, ...ORDER]));
    const idx = navOrder.indexOf(pid);
    const slugLabel = (slug) => {
      const d = allDbProjects.find(p => p.slug === slug);
      if (d) return d.title ? d.title.replace(/<[^>]+>/g,'') : (d.brand + ' ' + d.name);
      const h = PROJECTS[slug];
      return h ? h.title.replace(/<[^>]+>/g,'') : slug;
    };
    const prevEl = document.getElementById('wd-prev');
    const nextEl = document.getElementById('wd-next');
    if (idx > 0) {
      prevEl.href = (window.DAEMU_BASE || '/') + 'work/' + navOrder[idx - 1];
      prevEl.textContent = '← ' + slugLabel(navOrder[idx - 1]);
    } else {
      prevEl.style.visibility = 'hidden';
    }
    if (idx >= 0 && idx < navOrder.length - 1) {
      nextEl.href = (window.DAEMU_BASE || '/') + 'work/' + navOrder[idx + 1];
      nextEl.textContent = slugLabel(navOrder[idx + 1]) + ' →';
    } else {
      nextEl.style.visibility = 'hidden';
    }
  })();
  