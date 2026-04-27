(function() {
  'use strict';
const KEY = "media";
function render() {
  const data = DB.get(KEY);
  const grid = document.getElementById("media-grid");
  grid.innerHTML = data.length ? data.map(d =>
    `<div class="adm-media-item">
      <img src="${escUrl(d.src)}" alt="${escAttr(d.name)}">
      <div class="adm-media-meta">
        <span>${escHtml(d.name.length > 18 ? d.name.substring(0,18)+"…" : d.name)}</span>
        <button onclick="del(${escAttr(d.id)})">삭제</button>
      </div>
    </div>`
  ).join("") : '<p class="adm-empty" style="grid-column:1/-1">업로드된 미디어가 없습니다.</p>';
}
async function uploadFiles(files) {
  for (const file of Array.from(files)) {
    try {
      const r = await window.uploadImage(file);
      DB.add(KEY, { name: r.name || file.name, src: r.url, size: r.size || file.size, public_id: r.public_id || null });
      render();
    } catch (err) {
      alert('업로드 실패: ' + (err && err.message ? err.message : err));
    }
  }
}
function del(id) { if (confirmDel()) { DB.del(KEY, id); render(); } }
render();


Object.assign(window, { render, uploadFiles, del });
})();
