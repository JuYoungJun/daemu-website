(function() {
  'use strict';
const STORAGE_KEY = "crm";

// ── backend ↔ admin shape 매핑 ──────────────────────────────
function _mapBackendCrm(it) {
  return {
    id: it.id,
    name: it.name || '',
    company: '',  // backend 모델에 회사명 분리 컬럼 없음 — notes 에 같이 들어감
    email: it.email || '',
    phone: it.phone || '',
    source: it.source || '',
    status: it.status || 'lead',
    value: it.estimated_amount || 0,
    tags: Array.isArray(it.tags) ? it.tags : [],
    summary: it.notes || '',
    notes: [],
    date: it.created_at ? new Date(it.created_at).toLocaleDateString('ko') : '',
  };
}
function _toBackendCrm(p) {
  return {
    name: p.name || '',
    email: p.email || '',
    phone: p.phone || '',
    source: p.source || '',
    status: p.status || 'lead',
    estimated_amount: Number(p.value || 0),
    tags: p.tags || [],
    notes: p.summary || '',
  };
}
async function hydrateFromBackend() {
  if (!window.daemuHydrate) return;
  await window.daemuHydrate({
    storageKey: STORAGE_KEY,
    endpoint: '/api/crm?page=1&page_size=500',
    mapItem: _mapBackendCrm,
  });
}

const STAGES = [
  {key:"lead",       label:"리드",     en:"Lead"},
  {key:"qualified",  label:"검토중",   en:"Qualified"},
  {key:"customer",   label:"전환",     en:"Customer"},
  {key:"lost",       label:"이탈",     en:"Lost"}
];
let editingId = null;
let drawerId = null;

// 데모 시드 제거 — 실제 리드는 Contact 폼/Partners 신청을 통해 자동 생성됩니다.

function getAllTags() {
  const set = new Set();
  DB.get(STORAGE_KEY).forEach(d => (d.tags||[]).forEach(t => set.add(t)));
  return Array.from(set).sort();
}

function refreshTagFilter() {
  const sel = document.getElementById("filter-tag");
  const cur = sel.value;
  sel.innerHTML = '<option value="">전체 태그</option>' +
    getAllTags().map(t => `<option ${t===cur?"selected":""}>${t}</option>`).join("");
}

function fmtMoney(n){ return n ? Number(n).toLocaleString('ko')+'원' : '-'; }

function filtered() {
  const q = (document.getElementById("q").value || "").toLowerCase();
  const fs = document.getElementById("filter-status").value;
  const ft = document.getElementById("filter-tag").value;
  return DB.get(STORAGE_KEY).filter(d =>
    (!q || (d.name+" "+(d.company||"")+" "+(d.email||"")).toLowerCase().includes(q)) &&
    (!fs || d.status === fs) &&
    (!ft || (d.tags||[]).includes(ft))
  );
}

function stageMeta(key){ return STAGES.find(s => s.key === key) || STAGES[0]; }

function renderPipeline() {
  const all = DB.get(STORAGE_KEY);
  document.getElementById("pipeline").innerHTML = STAGES.map(s => {
    const items = all.filter(d => d.status === s.key);
    return `<div class="adm-pipe-col">
      <h4>${escHtml(s.label)} <b>${items.length}</b></h4>
      ${items.length ? items.map(d => `
        <div class="adm-pipe-card" onclick="openDrawer(${escAttr(d.id)})">
          <div class="nm">${escHtml(d.name)}</div>
          <div class="meta">${escHtml(d.company||"개인")} · ${fmtMoney(d.value)}</div>
        </div>
      `).join("") : '<div style="font-size:11px;color:#b9b5ae;letter-spacing:.04em">비어있음</div>'}
    </div>`;
  }).join("");
}

function render() {
  refreshTagFilter();
  renderPipeline();
  const data = filtered();
  document.getElementById("count").textContent = data.length + "건";
  document.getElementById("list").innerHTML = data.length ? data.map(d => {
    const tags = (d.tags||[]).slice(0,3).map(t => `<span class="adm-chip">${escHtml(t)}</span>`).join("");
    return `<tr>
      <td data-label="이름"><a href="javascript:void(0)" onclick="openDrawer(${escAttr(d.id)})" style="color:#111;font-weight:500">${escHtml(d.name)}</a></td>
      <td data-label="회사">${escHtml(d.company||"-")}</td>
      <td data-label="연락처">${escHtml(d.phone||"-")}</td>
      <td data-label="태그">${tags||"-"}</td>
      <td data-label="금액">${fmtMoney(d.value)}</td>
      <td data-label="단계">${badge(stageMeta(d.status).label)}</td>
      <td data-label="등록일">${escHtml(d.date)}</td>
      <td data-label="관리" class="col-actions">
        <button class="adm-btn-sm" onclick="openEdit(${escAttr(d.id)})">수정</button>
        <button class="adm-btn-sm danger" onclick="del(${escAttr(d.id)})">삭제</button>
      </td>
    </tr>`;
  }).join("") : '<tr><td colspan="8" class="adm-empty">조건에 맞는 항목이 없습니다.</td></tr>';
}

function openAdd() {
  editingId = null;
  ["f-name","f-company","f-email","f-phone","f-tags","f-summary"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("f-source").value = "웹사이트";
  document.getElementById("f-status").value = "lead";
  document.getElementById("f-value").value = "";
  document.getElementById("save-btn").textContent = "저장";
  document.getElementById("form-mode").textContent = "신규 등록";
  document.getElementById("form-area").classList.add("show");
}

function openEdit(id) {
  const d = DB.get(STORAGE_KEY).find(x => x.id === id);
  if (!d) return;
  editingId = id;
  document.getElementById("f-name").value = d.name || "";
  document.getElementById("f-company").value = d.company || "";
  document.getElementById("f-email").value = d.email || "";
  document.getElementById("f-phone").value = d.phone || "";
  document.getElementById("f-source").value = d.source || "웹사이트";
  document.getElementById("f-status").value = d.status || "lead";
  document.getElementById("f-value").value = d.value || "";
  document.getElementById("f-tags").value = (d.tags||[]).join(", ");
  document.getElementById("f-summary").value = d.summary || "";
  document.getElementById("save-btn").textContent = "수정";
  document.getElementById("form-mode").textContent = "수정 모드 · "+d.name;
  document.getElementById("form-area").classList.add("show");
  scrollTo({top: document.getElementById("form-area").offsetTop - 40, behavior:"smooth"});
}

function resetForm() {
  document.getElementById("form-area").classList.remove("show");
  editingId = null;
}

function save() {
  const name = document.getElementById("f-name").value.trim();
  if (!name) { alert("이름을 입력하세요"); return; }
  const tags = document.getElementById("f-tags").value.split(",").map(t => t.trim()).filter(Boolean);
  const payload = {
    name,
    company: document.getElementById("f-company").value,
    email: document.getElementById("f-email").value,
    phone: document.getElementById("f-phone").value,
    source: document.getElementById("f-source").value,
    status: document.getElementById("f-status").value,
    value: document.getElementById("f-value").value,
    tags,
    summary: document.getElementById("f-summary").value
  };
  if (editingId !== null) DB.update(STORAGE_KEY, editingId, payload);
  else DB.add(STORAGE_KEY, { ...payload, notes: [] });
  resetForm();
  render();
}

function del(id) { if (confirmDel()) { DB.del(STORAGE_KEY, id); render(); } }

/* Drawer */
function openDrawer(id) {
  const d = DB.get(STORAGE_KEY).find(x => x.id === id);
  if (!d) return;
  drawerId = id;
  document.getElementById("d-stage").textContent = stageMeta(d.status).en;
  document.getElementById("d-name").textContent = d.name;
  document.getElementById("d-company").textContent = d.company || "—";
  document.getElementById("d-email").textContent = d.email || "-";
  document.getElementById("d-phone").textContent = d.phone || "-";
  document.getElementById("d-source").textContent = d.source || "-";
  document.getElementById("d-value").textContent = fmtMoney(d.value);
  document.getElementById("d-date").textContent = d.date;
  document.getElementById("d-tags").innerHTML = (d.tags||[]).map(t => `<span class="adm-chip">${escHtml(t)}</span>`).join("") || '<span style="font-size:11px;color:#b9b5ae">태그 없음</span>';
  document.getElementById("d-summary").textContent = d.summary || "—";
  document.getElementById("d-stage-pick").value = d.status;
  document.getElementById("d-timeline").innerHTML = (d.notes && d.notes.length)
    ? d.notes.slice().reverse().map(n => `<div class="adm-timeline-item"><div class="ts">${escHtml(n.ts)}</div><div class="body">${escHtml(n.text)}</div></div>`).join("")
    : '<div style="font-size:12px;color:#b9b5ae">아직 기록된 메모가 없습니다.</div>';
  document.getElementById("note-form").style.display = "none";
  document.getElementById("drawer-mask").classList.add("show");
  document.getElementById("drawer").classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeDrawer() {
  drawerId = null;
  document.getElementById("drawer-mask").classList.remove("show");
  document.getElementById("drawer").classList.remove("show");
  document.body.style.overflow = "";
}

function toggleNoteForm() {
  const f = document.getElementById("note-form");
  f.style.display = (f.style.display === "none") ? "block" : "none";
  if (f.style.display === "block") document.getElementById("note-text").focus();
}
function addNote() {
  if (!drawerId) return;
  const text = document.getElementById("note-text").value.trim();
  if (!text) return;
  const d = DB.get(STORAGE_KEY).find(x => x.id === drawerId);
  if (!d) return;
  const notes = (d.notes || []).concat([{ ts: new Date().toLocaleString('ko'), text }]);
  DB.update(STORAGE_KEY, drawerId, { notes });
  document.getElementById("note-text").value = "";
  openDrawer(drawerId);
  render();
}
function changeStage(status) {
  if (!drawerId) return;
  DB.update(STORAGE_KEY, drawerId, { status });
  openDrawer(drawerId);
  render();
}
function editFromDrawer() { const id = drawerId; closeDrawer(); openEdit(id); }
function delFromDrawer() { const id = drawerId; if (confirmDel()) { closeDrawer(); DB.del(STORAGE_KEY, id); render(); } }

render();


Object.assign(window, { getAllTags, refreshTagFilter, fmtMoney, filtered, stageMeta, renderPipeline, render, openAdd, openEdit, resetForm, save, del, openDrawer, closeDrawer, toggleNoteForm, addNote, changeStage, editFromDrawer, delFromDrawer });
})();
