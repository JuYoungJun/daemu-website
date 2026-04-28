(function() {
  'use strict';
const STORAGE_KEY = "media";
let filterKind = "all"; // all | image | video

function fmtBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}

function kindOf(d) {
  if (d.kind) return d.kind;
  // Backwards compat — older entries didn't store kind. Infer from src.
  const s = String(d.src || "");
  if (/^data:video|\.mp4|\.webm/i.test(s)) return "video";
  return "image";
}

function renderStats() {
  const data = DB.get(STORAGE_KEY);
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
  const data = DB.get(STORAGE_KEY).filter(d => filterKind === "all" || kindOf(d) === filterKind);
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
    const preview = k === "video"
      ? `<video src="${escUrl(d.src)}" controls preload="metadata" style="width:100%;height:140px;object-fit:cover;background:#000"></video>`
      : `<img src="${escUrl(d.src)}" alt="${escAttr(name)}" loading="lazy">`;
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
      const fn = (kind === "video") ? window.uploadVideo : window.uploadImage;
      const r = await fn(file);
      DB.add(STORAGE_KEY, {
        name: r.name || file.name,
        src: r.url,
        size: r.size || file.size,
        kind: r.kind || kind,
        public_id: r.publicUrl || null,
      });
      render();
    } catch (err) {
      alert('업로드 실패: ' + (err && err.message ? err.message : err));
    }
  }
}

// Legacy alias used by any caller still expecting uploadFiles(files).
async function uploadFiles(files) { return uploadFilesAs(files, 'image'); }

function setFilter(v) { filterKind = v; renderGrid(); }

function copyUrl(id) {
  const item = DB.get(STORAGE_KEY).find(d => d.id === id);
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

function del(id) {
  if (confirmDel()) {
    DB.del(STORAGE_KEY, id);
    render();
  }
}

render();

Object.assign(window, { render, uploadFiles, uploadFilesAs, setFilter, copyUrl, del });
})();
