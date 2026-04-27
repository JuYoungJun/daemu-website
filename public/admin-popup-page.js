(function() {
  'use strict';
const KEY = "popups";
let editingId = null;
let pendingImage = null;

const POSITION_LABEL = { center: "중앙", "bottom-right": "우하단", top: "상단" };
const FREQ_LABEL = { always: "매번", daily: "하루 1회", once: "영구 1회" };
const PAGE_LABEL = { all:"전체", home:"메인", about:"About", service:"Service", team:"Team", process:"Process", work:"Work", contact:"Contact", partners:"Partners" };

if (!DB.get(KEY).length) {
  DB.add(KEY, {
    title: "2026 봄 시즌 안내",
    body: "비클래시 봄 시즌 한정 메뉴가 출시되었습니다.\n주요 매장에서 만나보세요.",
    image: "",
    ctaText: "메뉴 보기",
    ctaUrl: "work.html",
    position: "center",
    delay: 2,
    frequency: "daily",
    from: "",
    to: "",
    targetPages: ["home"],
    status: "paused",
    impressions: 0,
    clicks: 0
  });
}

function getCheckedPages() {
  return Array.from(document.querySelectorAll('#target-pages input:checked')).map(i => i.value);
}
function setCheckedPages(arr) {
  arr = arr || [];
  document.querySelectorAll('#target-pages input').forEach(i => { i.checked = arr.includes(i.value); });
}

async function onImage(files) {
  if (!files || !files[0]) return;
  try {
    const r = await window.uploadImage(files[0]);
    pendingImage = r.url;
    renderThumb();
  } catch (err) {
    alert('이미지 업로드 실패: ' + (err && err.message ? err.message : err));
  }
  document.getElementById("f-image-file").value = "";
}
function renderThumb() {
  const wrap = document.getElementById("f-thumb");
  if (pendingImage) {
    wrap.innerHTML = `<div class="adm-thumb"><img src="${escUrl(pendingImage)}" alt=""><button type="button" class="x" onclick="removeImage()">×</button></div>`;
  } else {
    wrap.innerHTML = "";
  }
}
function removeImage() { pendingImage = null; renderThumb(); }

function escapeHtml(s) {
  return String(s||"").replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtPeriod(d) {
  if (!d.from && !d.to) return "상시";
  return (d.from || "—") + " ~ " + (d.to || "무제한");
}

function filtered() {
  const q = (document.getElementById("q").value || "").toLowerCase();
  const fs = document.getElementById("filter-status").value;
  const fp = document.getElementById("filter-position").value;
  return DB.get(KEY).filter(d =>
    (!q || (d.title||"").toLowerCase().includes(q)) &&
    (!fs || (d.status||"active") === fs) &&
    (!fp || d.position === fp)
  );
}

function renderKPI() {
  const all = DB.get(KEY);
  const active = all.filter(d => (d.status||"active") === "active").length;
  const imps = all.reduce((a,d) => a + (d.impressions||0), 0);
  const clicks = all.reduce((a,d) => a + (d.clicks||0), 0);
  const ctr = imps ? Math.round(clicks/imps*100) : 0;
  document.getElementById("k-active").textContent = active;
  document.getElementById("k-impressions").textContent = imps.toLocaleString('ko');
  document.getElementById("k-clicks").textContent = clicks.toLocaleString('ko');
  document.getElementById("k-ctr").textContent = ctr + "%";
}

function render() {
  renderKPI();
  const data = filtered();
  document.getElementById("count").textContent = data.length + "건";
  document.getElementById("list").innerHTML = data.length ? data.map(d => {
    const targets = (d.targetPages||["all"]).map(p => PAGE_LABEL[p]||p).join(", ");
    return `<tr>
      <td data-label="제목" style="max-width:240px">
        <a href="javascript:void(0)" onclick="openEdit(${d.id})" style="color:#111;font-weight:500">${escapeHtml(d.title||"(제목 없음)")}</a>
        ${d.body ? `<div style="font-size:11px;color:#8c867d;margin-top:2px">${escapeHtml(d.body.slice(0,50))}${d.body.length>50?"…":""}</div>` : ""}
      </td>
      <td data-label="위치">${POSITION_LABEL[d.position]||d.position}</td>
      <td data-label="빈도">${FREQ_LABEL[d.frequency]||d.frequency}</td>
      <td data-label="기간" style="font-size:11px;color:#6f6b68">${fmtPeriod(d)}</td>
      <td data-label="대상" style="font-size:11px;color:#6f6b68">${targets}</td>
      <td data-label="노출/클릭">${d.impressions||0} / ${d.clicks||0}</td>
      <td data-label="상태">${badge(d.status === "paused" ? "일시중지" : "활성")}</td>
      <td data-label="관리" class="col-actions">
        <button class="adm-btn-sm" onclick="preview(${d.id})">미리보기</button>
        <button class="adm-btn-sm" onclick="toggleStatus(${d.id})">${d.status==="paused"?"활성":"중지"}</button>
        <button class="adm-btn-sm" onclick="openEdit(${d.id})">수정</button>
        <button class="adm-btn-sm danger" onclick="del(${d.id})">삭제</button>
      </td>
    </tr>`;
  }).join("") : '<tr><td colspan="8" class="adm-empty">조건에 맞는 팝업이 없습니다.</td></tr>';
}

function openAdd() {
  editingId = null;
  pendingImage = null;
  ["f-title","f-body","f-cta-text","f-cta-url","f-from","f-to"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("f-position").value = "center";
  document.getElementById("f-delay").value = "2";
  document.getElementById("f-frequency").value = "daily";
  document.getElementById("f-status").value = "active";
  setCheckedPages(["all"]);
  renderThumb();
  document.getElementById("save-btn").textContent = "저장";
  document.getElementById("form-mode").textContent = "신규 등록";
  document.getElementById("form-area").classList.add("show");
}

function openEdit(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  editingId = id;
  pendingImage = d.image || null;
  document.getElementById("f-title").value = d.title || "";
  document.getElementById("f-body").value = d.body || "";
  document.getElementById("f-cta-text").value = d.ctaText || "";
  document.getElementById("f-cta-url").value = d.ctaUrl || "";
  document.getElementById("f-position").value = d.position || "center";
  document.getElementById("f-delay").value = d.delay || 0;
  document.getElementById("f-frequency").value = d.frequency || "daily";
  document.getElementById("f-status").value = d.status || "active";
  document.getElementById("f-from").value = d.from || "";
  document.getElementById("f-to").value = d.to || "";
  setCheckedPages(d.targetPages || ["all"]);
  renderThumb();
  document.getElementById("save-btn").textContent = "수정";
  document.getElementById("form-mode").textContent = "수정 모드 · " + (d.title || "#"+String(id).slice(-6));
  document.getElementById("form-area").classList.add("show");
  scrollTo({top: document.getElementById("form-area").offsetTop - 40, behavior:"smooth"});
}

function resetForm() {
  document.getElementById("form-area").classList.remove("show");
  editingId = null;
  pendingImage = null;
}

function buildPayload() {
  const targets = getCheckedPages();
  return {
    title: document.getElementById("f-title").value.trim(),
    body: document.getElementById("f-body").value,
    image: pendingImage || "",
    ctaText: document.getElementById("f-cta-text").value,
    ctaUrl: document.getElementById("f-cta-url").value,
    position: document.getElementById("f-position").value,
    delay: document.getElementById("f-delay").value,
    frequency: document.getElementById("f-frequency").value,
    status: document.getElementById("f-status").value,
    from: document.getElementById("f-from").value,
    to: document.getElementById("f-to").value,
    targetPages: targets.length ? targets : ["all"]
  };
}

function save() {
  const p = buildPayload();
  if (!p.title) { alert("제목을 입력하세요"); return; }
  if (editingId !== null) DB.update(KEY, editingId, p);
  else DB.add(KEY, { ...p, impressions: 0, clicks: 0 });
  resetForm();
  render();
}

function toggleStatus(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  DB.update(KEY, id, { status: d.status === "paused" ? "active" : "paused" });
  render();
}

function del(id) { if (confirmDel("이 팝업을 삭제하시겠습니까?")) { DB.del(KEY, id); render(); } }

/* Preview — render the popup overlay using the same public-site CSS classes */
function previewForm() { showPreview(buildPayload()); }
function preview(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (d) showPreview(d);
}
function showPreview(popup) {
  // Remove any existing preview
  document.querySelectorAll('.site-popup-overlay').forEach(el => el.remove());
  const overlay = document.createElement('div');
  overlay.className = 'site-popup-overlay site-popup-pos-' + (popup.position || 'center');
  const imgHtml = popup.image ? `<img class="site-popup-image" src="${escUrl(popup.image)}" alt="">` : "";
  const titleHtml = popup.title ? `<h3>${escapeHtml(popup.title)}</h3>` : "";
  const bodyHtml = popup.body ? `<p>${escapeHtml(popup.body)}</p>` : "";
  const ctaHtml = (popup.ctaText && popup.ctaUrl) ? `<a class="site-popup-cta" href="${escUrl(popup.ctaUrl)}" onclick="event.preventDefault();alert('미리보기: 실제 사이트에서는 ${escapeHtml(popup.ctaUrl)} 로 이동합니다.')">${escapeHtml(popup.ctaText)}</a>` : "";
  const skipHtml = popup.frequency !== "always" ? `<label class="site-popup-skip"><input type="checkbox"> 오늘 하루 보지 않기</label>` : "";
  overlay.innerHTML = `<div class="site-popup-box">
    <button class="site-popup-close" type="button" aria-label="닫기">×</button>
    ${imgHtml}
    <div class="site-popup-body">${titleHtml}${bodyHtml}${ctaHtml}</div>
    ${skipHtml}
  </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-shown'));
  const close = () => { overlay.classList.remove('is-shown'); setTimeout(() => overlay.remove(), 320); };
  overlay.querySelector('.site-popup-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

render();


Object.assign(window, { getCheckedPages, setCheckedPages, onImage, renderThumb, removeImage, escapeHtml, fmtPeriod, filtered, renderKPI, render, openAdd, openEdit, resetForm, buildPayload, save, toggleStatus, del, previewForm, preview, showPreview });
})();
