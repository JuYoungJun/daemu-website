(function() {
  'use strict';
// 어드민 미디어 라이브러리 — backend Aiven `media_assets` (`/api/media`) 가
// source of truth. 업로드 자체는 /api/upload, 메타는 /api/media POST 로 등록.
// localStorage 직접 read/write 없음 (2026-05).

const STORAGE_KEY = "media";  // window.daemuStore[STORAGE_KEY] 메모리 캐시 키
let filterKind = "all"; // all | image | video

function _mapBackendMedia(it) {
  // backend → admin shape. backend 의 url / name / content_type / size / id
  // 를 옛 admin UI 가 기대하는 src / kind / size 로 변환.
  const src = it.url || '';
  const kindFromCt = (it.content_type || '').toLowerCase().startsWith('video/') ? 'video' : 'image';
  const kindFromUrl = /\.(mp4|webm|mov)(\?|$)/i.test(src) ? 'video' : 'image';
  return {
    id: it.id,
    name: it.name || it.original_name || '',
    src,
    size: Number(it.size || 0),
    kind: kindFromCt || kindFromUrl,
    public_id: src,
    content_type: it.content_type || '',
    alt: it.alt || '',
    tags: Array.isArray(it.tags) ? it.tags : [],
    created_at: it.created_at || '',
  };
}

async function hydrateFromBackend() {
  if (!window.daemuHydrate) return;
  await window.daemuHydrate({
    storageKey: STORAGE_KEY,
    endpoint: '/api/media?page=1&page_size=500',
    mapItem: _mapBackendMedia,
  });
}

function _rows() { return window.daemuRows ? window.daemuRows(STORAGE_KEY) : []; }

function fmtBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

function kindOf(d) {
  if (d.kind) return d.kind;
  const s = String(d.src || "");
  if (/^data:video|\.mp4|\.webm/i.test(s)) return "video";
  return "image";
}

function renderStats() {
  const data = _rows();
  let imgN = 0, vidN = 0, imgBytes = 0, vidBytes = 0;
  data.forEach(d => {
    const k = kindOf(d);
    if (k === "video") { vidN++; vidBytes += d.size || 0; }
    else { imgN++; imgBytes += d.size || 0; }
  });
  const total = imgBytes + vidBytes;
  const el = document.getElementById("media-stats");
  if (!el) return;
  el.innerHTML = [
    `<span><strong>이미지</strong> ${imgN}개 · ${fmtBytes(imgBytes)}</span>`,
    `<span><strong>영상</strong> ${vidN}개 · ${fmtBytes(vidBytes)}</span>`,
    `<span><strong>합계</strong> ${imgN + vidN}개 · ${fmtBytes(total)}</span>`,
  ].join("");
}

function renderGrid() {
  const data = _rows().filter(d => filterKind === "all" || kindOf(d) === filterKind);
  const grid = document.getElementById("media-grid");
  if (!grid) return;
  if (!data.length) {
    grid.innerHTML = '<p class="adm-empty" style="grid-column:1/-1">업로드된 미디어가 없습니다.</p>';
    return;
  }
  grid.innerHTML = data.map(d => {
    const k = kindOf(d);
    const name = d.name || "";
    const display = name.length > 22 ? name.substring(0, 22) + "…" : name;
    // 빈 src 일 때 <img src=""> / <video src=""> 만들면 브라우저가 현재
    // 페이지를 src 로 해석해서 자기 자신을 GET (404). placeholder 표시.
    const srcStr = (d.src || '').trim();
    const preview = !srcStr
      ? `<div class="adm-thumb-empty" style="display:flex;align-items:center;justify-content:center;height:140px;background:#f6f4f0;color:#8c867d;font-size:11px;flex-direction:column;gap:4px"><span style="font-size:24px">📦</span><span>파일 정보 누락</span></div>`
      : k === "video"
        ? `<video src="${escUrl(srcStr)}" controls preload="metadata" style="width:100%;height:140px;object-fit:cover;background:#000"></video>`
        : `<img src="${escUrl(srcStr)}" alt="${escAttr(name)}" loading="lazy">`;
    return `<div class="adm-media-item" data-kind="${escAttr(k)}">
      ${preview}
      <div class="adm-media-meta">
        <span title="${escAttr(name)}">${escHtml(display)}</span>
        <button onclick="copyUrl(${escAttr(d.id)})" type="button" title="URL 복사">URL</button>
        <button onclick="del(${escAttr(d.id)})" type="button">삭제</button>
      </div>
      <div style="font-size:10px;color:#8c867d;padding:2px 8px 8px;letter-spacing:.04em">
        ${escHtml(k.toUpperCase())} · ${escHtml(fmtBytes(d.size))}
      </div>
    </div>`;
  }).join("");
}

function render() { renderStats(); renderGrid(); }

async function uploadFilesAs(files, kind) {
  for (const file of Array.from(files)) {
    try {
      // 1) 파일 업로드 — 기존 backend `/api/upload` 또는 client-side helper.
      const fn = (kind === "video") ? window.uploadVideo : window.uploadImage;
      const r = await fn(file);
      // 2) backend 메타 등록 — Aiven `media_assets` 행 1건 추가.
      if (window.api && window.api.isConfigured && window.api.isConfigured()) {
        const m = await window.api.post('/api/media', {
          url: r.url,
          name: r.name || file.name,
          original_name: file.name,
          content_type: r.kind === 'video' ? 'video/mp4' : (file.type || ''),
          size: r.size || file.size || 0,
          alt: '',
          tags: [],
        });
        if (!m || !m.ok) {
          alert('미디어 메타 저장 실패: ' + (m && (m.error || ('HTTP ' + m.status))));
          continue;
        }
      } else {
        alert('백엔드 미연결 — 미디어 메타가 저장되지 않습니다.');
        continue;
      }
      // 3) refetch — store 갱신 → render.
      if (window.daemuRefetch) await window.daemuRefetch(STORAGE_KEY);
      render();
    } catch (err) {
      alert('업로드 실패: ' + (err && err.message ? err.message : err));
    }
  }
}

async function uploadFiles(files) { return uploadFilesAs(files, 'image'); }

function setFilter(v) { filterKind = v; renderGrid(); }

function copyUrl(id) {
  const item = _rows().find(d => d.id === id);
  if (!item) return;
  const url = item.public_id || item.src;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(
      () => { alert('URL이 클립보드에 복사되었습니다.'); },
      () => { alert('URL 복사 실패: ' + url); }
    );
  } else {
    alert(url);
  }
}

async function del(id) {
  if (!confirmDel()) return;
  if (!window.api || !window.api.isConfigured || !window.api.isConfigured()) {
    alert('백엔드 미연결 — 삭제할 수 없습니다.');
    return;
  }
  const r = await window.api.del('/api/media/' + id);
  if (!r || (!r.ok && r.status !== 204)) {
    alert('백엔드 삭제 실패: ' + (r && (r.error || ('HTTP ' + r.status))));
    return;
  }
  if (window.daemuRefetch) await window.daemuRefetch(STORAGE_KEY);
  render();
}

// 초기 마운트 — render 후 backend hydrate, 완료되면 render 재실행.
render();
hydrateFromBackend().then(render);

Object.assign(window, { render, uploadFiles, uploadFilesAs, setFilter, copyUrl, del, hydrateFromBackend });
})();
