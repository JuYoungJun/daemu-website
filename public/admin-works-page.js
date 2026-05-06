(function() {
  'use strict';
  const STORAGE_KEY = "projects";
  let editingId = null;
  let pendingImages = [];
  let pendingHero = null;
  let mode = 'structured'; // 'structured' | 'free'

  // ── backend ↔ admin shape 매핑 ──────────────────────────────
  function _mapBackendWork(it) {
    return {
      id: it.id,
      slug: it.slug || '',
      brand: it.category || '',
      name: it.title || '',
      title: it.title || '',
      brandLine: it.summary || '',
      overview: it.content_md || '',
      hero: it.hero_image_url || '',
      images: Array.isArray(it.gallery) ? it.gallery.map((g) => typeof g === 'string' ? { name: '', src: g } : g) : [],
      tags: Array.isArray(it.tags) ? it.tags : [],
      addr: it.location || '',
      year: it.year || '',
      size: it.size_label || '',
      floor: it.floor_label || '',
      status: it.published === false ? '비공개' : '운영중',
      sort_order: it.sort_order || 0,
    };
  }
  function _toBackendWork(p) {
    return {
      slug: p.slug,
      title: p.name || p.title || '',
      category: p.brand || '',
      summary: p.brandLine || '',
      content_md: p.overview || '',
      hero_image_url: p.hero || '',
      gallery: (p.images || []).map((g) => g && g.src ? g.src : g),
      tags: p.tags || [],
      location: p.addr || '',
      year: p.year || '',
      size_label: p.size || '',
      floor_label: p.floor || '',
      published: p.status !== '비공개',
    };
  }
  async function hydrateFromBackend() {
    if (!window.daemuHydrate) return;
    await window.daemuHydrate({
      storageKey: STORAGE_KEY,
      endpoint: '/api/works?page=1&page_size=500',
      mapItem: _mapBackendWork,
      // 정책 (2026-05): backend Aiven MySQL 이 single source of truth.
      // backend 가 비었으면 화면도 비어야 함 — 옛 하드코딩 시드(6건) 가
      // "백엔드는 비어 있습니다" 토스트 + CSV-vs-display 불일치를 만들었음.
    });
  }
  // 옛 하드코딩 시드 6건 (Beclassy / Pumjang / Morif) 제거 — 같은 사유.
  // 어드민에서 등록한 작업사례만 표시되도록 변경.

  function setMode(m) {
    mode = m;
    document.getElementById('mode-structured-btn').style.borderBottomColor = m === 'structured' ? '#111' : 'transparent';
    document.getElementById('mode-structured-btn').style.color = m === 'structured' ? '#111' : '#8c867d';
    document.getElementById('mode-structured-btn').style.fontWeight = m === 'structured' ? 500 : 'normal';
    document.getElementById('mode-free-btn').style.borderBottomColor = m === 'free' ? '#111' : 'transparent';
    document.getElementById('mode-free-btn').style.color = m === 'free' ? '#111' : '#8c867d';
    document.getElementById('mode-free-btn').style.fontWeight = m === 'free' ? 500 : 'normal';
    const sf = document.getElementById('structured-fields');
    if (sf) sf.style.display = m === 'structured' ? '' : 'none';
    const heroWrap = document.getElementById('hero-slot-wrap');
    if (heroWrap) heroWrap.style.display = m === 'structured' ? '' : 'none';
  }

  function renderProcessRows() {
    const wrap = document.getElementById('process-rows');
    if (!wrap) return;
    let rowsHtml = '';
    for (let i = 0; i < 4; i++) {
      rowsHtml += `<div class="adm-form" style="border:1px solid #e6e3dd;padding:14px;margin-bottom:10px;border-radius:0">
        <div><label>단계 ${i+1} 번호</label><input id="f-proc${i}-num" type="text" placeholder="${String(i+1).padStart(2,'0')}"></div>
        <div><label>단계 ${i+1} 제목</label><input id="f-proc${i}-title" type="text" placeholder="브랜드 전략 수립"></div>
        <div class="full"><label>단계 ${i+1} 설명</label><textarea id="f-proc${i}-desc" rows="2"></textarea></div>
      </div>`;
    }
    wrap.innerHTML = rowsHtml;
  }

  function autoSlug(name, brand) {
    const base = (brand ? brand.toLowerCase() + '-' : '') + (name || '').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'');
    return base || 'project-' + Date.now().toString(36);
  }

  function filtered() {
    const q = (document.getElementById("q").value || "").toLowerCase();
    const fb = document.getElementById("filter-brand").value;
    const fs = document.getElementById("filter-status").value;
    return (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).filter(d =>
      (!q || (d.brand+" "+d.name+" "+(d.addr||"")).toLowerCase().includes(q)) &&
      (!fb || d.brand === fb) &&
      (!fs || d.status === fs)
    );
  }

  function render() {
    const data = filtered();
    document.getElementById("count").textContent = data.length + "건";
    document.getElementById("list").innerHTML = data.length ? data.map(d => {
      const heroSrc = d.hero || (d.images && d.images[0] && d.images[0].src) || '';
      const thumb = heroSrc
        ? `<span class="adm-thumb-cell"><img src="${escUrl(heroSrc)}" alt=""></span>`
        : `<span class="adm-thumb-cell"></span>`;
      const galleryCount = d.images ? d.images.length : 0;
      const slug = d.slug || '#'+String(d.id).slice(-6);
      return `<tr>
        <td data-label="이미지">${thumb}<small style="color:#8c867d">${galleryCount}장</small></td>
        <td data-label="브랜드">${escHtml(d.brand)}</td>
        <td data-label="지점">${escHtml(d.name)}</td>
        <td data-label="슬러그"><a href="/work/${escUrl(d.slug || '')}" target="_blank" style="color:#111;font-size:12px">${escHtml(slug)}</a></td>
        <td data-label="연도">${escHtml(d.year || '-')}</td>
        <td data-label="상태">${badge(d.status)}</td>
        <td data-label="관리" class="col-actions">
          <button class="adm-btn-sm" onclick="openEdit(${escAttr(d.id)})">수정</button>
          <button class="adm-btn-sm danger" onclick="del(${escAttr(d.id)})">삭제</button>
        </td>
      </tr>`;
    }).join("") : '<tr><td colspan="7" class="adm-empty">조건에 맞는 프로젝트가 없습니다.</td></tr>';
  }

  function renderThumbs() {
    document.getElementById("f-thumbs").innerHTML = pendingImages.map((img, i) =>
      `<div class="adm-thumb"><img src="${escUrl(img.src)}" alt=""><button type="button" class="x" onclick="removeImage(${i})">×</button></div>`
    ).join("");
  }

  function renderHeroThumb() {
    const wrap = document.getElementById("f-hero-thumb");
    if (!wrap) return;
    if (pendingHero) {
      wrap.innerHTML = `<div class="adm-thumb"><img src="${escUrl(pendingHero)}" alt=""><button type="button" class="x" onclick="removeHero()">×</button></div>`;
    } else {
      wrap.innerHTML = '';
    }
  }

  async function addImages(files) {
    for (const file of Array.from(files)) {
      try {
        const r = await window.uploadImage(file);
        pendingImages.push({ name: r.name || file.name, src: r.url, public_id: r.public_id || null });
        renderThumbs();
      } catch (err) {
        alert('이미지 업로드 실패: ' + (err && err.message ? err.message : err));
      }
    }
    document.getElementById("f-files").value = "";
  }

  async function addHeroImage(files) {
    if (!files || !files[0]) return;
    try {
      const r = await window.uploadImage(files[0]);
      pendingHero = r.url;
      renderHeroThumb();
    } catch (err) {
      alert('히어로 이미지 업로드 실패: ' + (err && err.message ? err.message : err));
    }
    document.getElementById("f-hero-file").value = "";
  }

  function removeImage(i) { pendingImages.splice(i, 1); renderThumbs(); }
  function removeHero() { pendingHero = null; renderHeroThumb(); }

  async function pickHeroFromLibrary() {
    if (!window.openMediaPicker) { alert('미디어 라이브러리를 사용할 수 없습니다.'); return; }
    const url = await window.openMediaPicker({ kind: 'image', allowUpload: true });
    if (url) { pendingHero = url; renderHeroThumb(); }
  }
  async function pickGalleryFromLibrary() {
    if (!window.openMediaPicker) { alert('미디어 라이브러리를 사용할 수 없습니다.'); return; }
    const url = await window.openMediaPicker({ kind: 'image', allowUpload: true });
    if (url) { pendingImages.push({ name: '미디어 라이브러리', src: url }); renderThumbs(); }
  }
  window.pickHeroFromLibrary = pickHeroFromLibrary;
  window.pickGalleryFromLibrary = pickGalleryFromLibrary;

  function openAdd() {
    editingId = null;
    pendingImages = [];
    pendingHero = null;
    ["f-name","f-slug","f-size","f-year","f-addr","f-desc","f-title","f-brand-line","f-overview","f-tags",
     "f-stat1-label","f-stat1-val","f-stat2-label","f-stat2-val","f-stat3-label","f-stat3-val"
    ].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    document.getElementById("f-brand").value = "Beclassy";
    document.getElementById("f-status").value = "운영중";
    renderProcessRows();
    renderThumbs();
    renderHeroThumb();
    document.getElementById("save-btn").textContent = "저장";
    document.getElementById("form-mode").textContent = "신규 등록";
    document.getElementById("form-area").classList.add("show");
    setMode('structured');
    scrollTo({top: document.getElementById("form-area").offsetTop - 40, behavior:"smooth"});
  }

  function openEdit(id) {
    const d = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === id);
    if (!d) return;
    editingId = id;
    pendingImages = (d.images || []).map(i => ({...i}));
    pendingHero = d.hero || null;
    document.getElementById("f-brand").value = d.brand || "Beclassy";
    document.getElementById("f-name").value = d.name || "";
    document.getElementById("f-slug").value = d.slug || "";
    document.getElementById("f-size").value = d.size || "";
    document.getElementById("f-year").value = d.year || "";
    document.getElementById("f-addr").value = d.addr || "";
    document.getElementById("f-status").value = d.status || "운영중";
    document.getElementById("f-desc").value = d.desc || "";
    const setIf = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
    setIf("f-title", d.title);
    setIf("f-brand-line", d.brandLine);
    setIf("f-overview", d.overview);
    setIf("f-tags", (d.tags || []).join(", "));
    const stats = d.stats || [];
    for (let i = 0; i < 3; i++) {
      setIf(`f-stat${i+1}-label`, stats[i] && stats[i].label);
      setIf(`f-stat${i+1}-val`, stats[i] && stats[i].val);
    }
    renderProcessRows();
    const proc = d.process || [];
    for (let i = 0; i < 4; i++) {
      setIf(`f-proc${i}-num`, proc[i] && proc[i].num);
      setIf(`f-proc${i}-title`, proc[i] && proc[i].title);
      setIf(`f-proc${i}-desc`, proc[i] && proc[i].desc);
    }
    renderThumbs();
    renderHeroThumb();
    document.getElementById("save-btn").textContent = "수정";
    document.getElementById("form-mode").textContent = "수정 모드 · " + (d.slug || ('#' + String(id).slice(-6)));
    document.getElementById("form-area").classList.add("show");
    setMode(d.mode || 'structured');
    scrollTo({top: document.getElementById("form-area").offsetTop - 40, behavior:"smooth"});
  }

  function resetForm() {
    document.getElementById("form-area").classList.remove("show");
    editingId = null;
    pendingImages = [];
    pendingHero = null;
  }

  function collectPayload() {
    const name = document.getElementById("f-name").value.trim();
    let slug = document.getElementById("f-slug").value.trim().toLowerCase().replace(/[^a-z0-9-]/g,'');
    if (!slug) slug = autoSlug(name, document.getElementById("f-brand").value);

    const get = (id) => { const el = document.getElementById(id); return el ? el.value : ""; };
    const tags = get("f-tags").split(",").map(t => t.trim()).filter(Boolean);
    const stats = [];
    for (let i = 1; i <= 3; i++) {
      const label = get(`f-stat${i}-label`).trim();
      const val = get(`f-stat${i}-val`).trim();
      if (label && val) stats.push({ label, val });
    }
    const process = [];
    for (let i = 0; i < 4; i++) {
      const num = get(`f-proc${i}-num`).trim();
      const title = get(`f-proc${i}-title`).trim();
      const desc = get(`f-proc${i}-desc`).trim();
      if (num || title || desc) process.push({ num: num || String(i+1).padStart(2,'0'), title, desc });
    }
    return {
      mode,
      brand: document.getElementById("f-brand").value,
      name, slug,
      size: get("f-size"), year: get("f-year"), addr: get("f-addr"),
      status: document.getElementById("f-status").value,
      desc: get("f-desc"),
      title: get("f-title") || (name + ' · ' + document.getElementById("f-brand").value),
      brandLine: get("f-brand-line"),
      overview: get("f-overview"),
      tags, stats, process,
      hero: pendingHero || (pendingImages[0] && pendingImages[0].src) || '',
      images: pendingImages
    };
  }

  async function save() {
    const p = collectPayload();
    if (!p.name) { alert("지점명을 입력하세요"); return; }
    // slug uniqueness check
    const dup = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(d => d.slug === p.slug && d.id !== editingId);
    if (dup) { alert("이미 사용 중인 슬러그입니다: " + p.slug); return; }
    // 정책: backend (Aiven MySQL) 가 source of truth. backend 가 OK 일 때만
    // localStorage 미러 갱신. 실패 시 fake-success / 캐시 잔재 만들지 않음.
    if (editingId !== null) {
      const existing = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === editingId);
      if (!window.daemuMirror) {
        alert('백엔드 미연결 — 저장할 수 없습니다.');
        return;
      }
      const r = await window.daemuMirror({
        method: 'PATCH', endpoint: '/api/works/' + editingId,
        body: _toBackendWork({ ...(existing || {}), ...p }),
        refetchKey: STORAGE_KEY,
      });
      if (!r.ok) {
        alert('서버 저장에 실패했습니다. 잠시 후 다시 시도해 주세요. (' + (r.error || ('HTTP ' + (r.status || 0))) + ')');
        return;
      }
    } else {
      if (!window.daemuMirror) {
        alert('백엔드 미연결 — 저장할 수 없습니다.');
        return;
      }
      const r = await window.daemuMirror({
        method: 'POST', endpoint: '/api/works', body: _toBackendWork(p),
        refetchKey: STORAGE_KEY,
      });
      if (!r.ok || !r.item || r.item.id == null) {
        alert('서버 저장에 실패했습니다. 잠시 후 다시 시도해 주세요. (' + (r.error || ('HTTP ' + (r.status || 0))) + ')');
        return;
      }
    }
    try { window.dispatchEvent(new Event('daemu-db-change')); } catch (_) { /* ignore */ }
    resetForm();
    render();
    if (window.siteToast) window.siteToast('저장 완료', { tone: 'success' });
  }

  function previewProject() {
    const p = collectPayload();
    if (!p.name) { alert("미리보기 전 지점명을 입력하세요"); return; }
    if (!p.slug) { alert("슬러그를 입력하세요"); return; }
    // Save as draft so /work/<slug> can render it
    sessionStorage.setItem('daemu_work_preview_' + p.slug, JSON.stringify(p));
    const base = (window.DAEMU_BASE || '/');
    window.open(base + 'work/' + p.slug + '?preview=1', '_blank');
  }

  async function del(id) {
    if (!confirm('이 프로젝트를 삭제하시겠습니까?')) return;
    const existing = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === id);
    if (existing && existing._backend && window.daemuMirror) {
      const r = await window.daemuMirror({ method: 'DELETE', endpoint: '/api/works/' + id, refetchKey: STORAGE_KEY });
      if (!r.ok) { alert('백엔드 삭제 실패 — 다시 시도해 주세요.'); return; }
    }
    try { window.dispatchEvent(new Event('daemu-db-change')); } catch (_) { /* ignore */ }
    render();
  }

  render();
  hydrateFromBackend().then(render);

  Object.assign(window, { setMode, filtered, render, renderThumbs, renderHeroThumb, addImages, addHeroImage, removeImage, removeHero, openAdd, openEdit, resetForm, save, del, previewProject, hydrateFromBackend });
})();
