(function() {
  'use strict';
const KEY = "crm";
const STAGES = [
  {key:"lead",       label:"리드",     en:"Lead"},
  {key:"qualified",  label:"검토중",   en:"Qualified"},
  {key:"customer",   label:"전환",     en:"Customer"},
  {key:"lost",       label:"이탈",     en:"Lost"}
];
let editingId = null;
let drawerId = null;

if (!DB.get(KEY).length) {
  [
    {name:"김민수",company:"카페 이음",email:"minsoo@example.com",phone:"010-1111-2222",source:"웹사이트",status:"lead",value:50000000,tags:["카페","신규창업"],summary:"강남 신축 상가 카페 오픈 예정. 비클래시 형태 관심.",notes:[]},
    {name:"박지영",company:"베이크하우스",email:"jiyoung@example.com",phone:"010-3333-4444",source:"레퍼럴",status:"qualified",value:30000000,tags:["베이커리"],summary:"기존 매장 리브랜딩 + 메뉴 개발 의뢰.",notes:[]},
    {name:"이한솔",company:"-",email:"hansol@example.com",phone:"010-5555-6666",source:"SNS",status:"customer",value:120000000,tags:["전라남도","장어"],summary:"품장 인천점 오픈 예정.",notes:[]},
  ].forEach(d => DB.add(KEY, d));
}

function getAllTags() {
  const set = new Set();
  DB.get(KEY).forEach(d => (d.tags||[]).forEach(t => set.add(t)));
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
  return DB.get(KEY).filter(d =>
    (!q || (d.name+" "+(d.company||"")+" "+(d.email||"")).toLowerCase().includes(q)) &&
    (!fs || d.status === fs) &&
    (!ft || (d.tags||[]).includes(ft))
  );
}

function stageMeta(key){ return STAGES.find(s => s.key === key) || STAGES[0]; }

function renderPipeline() {
  const all = DB.get(KEY);
  document.getElementById("pipeline").innerHTML = STAGES.map(s => {
    const items = all.filter(d => d.status === s.key);
    return `<div class="adm-pipe-col">
      <h4>${s.label} <b>${items.length}</b></h4>
      ${items.length ? items.map(d => `
        <div class="adm-pipe-card" onclick="openDrawer(${d.id})">
          <div class="nm">${d.name}</div>
          <div class="meta">${d.company||"개인"} · ${fmtMoney(d.value)}</div>
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
    const tags = (d.tags||[]).slice(0,3).map(t => `<span class="adm-chip">${t}</span>`).join("");
    return `<tr>
      <td data-label="이름"><a href="javascript:void(0)" onclick="openDrawer(${d.id})" style="color:#111;font-weight:500">${d.name}</a></td>
      <td data-label="회사">${d.company||"-"}</td>
      <td data-label="연락처">${d.phone||"-"}</td>
      <td data-label="태그">${tags||"-"}</td>
      <td data-label="금액">${fmtMoney(d.value)}</td>
      <td data-label="단계">${badge(stageMeta(d.status).label)}</td>
      <td data-label="등록일">${d.date}</td>
      <td data-label="관리" class="col-actions">
        <button class="adm-btn-sm" onclick="openEdit(${d.id})">수정</button>
        <button class="adm-btn-sm danger" onclick="del(${d.id})">삭제</button>
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
  const d = DB.get(KEY).find(x => x.id === id);
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
  if (editingId !== null) DB.update(KEY, editingId, payload);
  else DB.add(KEY, { ...payload, notes: [] });
  resetForm();
  render();
}

function del(id) { if (confirmDel()) { DB.del(KEY, id); render(); } }

/* Drawer */
function openDrawer(id) {
  const d = DB.get(KEY).find(x => x.id === id);
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
  document.getElementById("d-tags").innerHTML = (d.tags||[]).map(t => `<span class="adm-chip">${t}</span>`).join("") || '<span style="font-size:11px;color:#b9b5ae">태그 없음</span>';
  document.getElementById("d-summary").textContent = d.summary || "—";
  document.getElementById("d-stage-pick").value = d.status;
  document.getElementById("d-timeline").innerHTML = (d.notes && d.notes.length)
    ? d.notes.slice().reverse().map(n => `<div class="adm-timeline-item"><div class="ts">${n.ts}</div><div class="body">${n.text}</div></div>`).join("")
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
  const d = DB.get(KEY).find(x => x.id === drawerId);
  if (!d) return;
  const notes = (d.notes || []).concat([{ ts: new Date().toLocaleString('ko'), text }]);
  DB.update(KEY, drawerId, { notes });
  document.getElementById("note-text").value = "";
  openDrawer(drawerId);
  render();
}
function changeStage(status) {
  if (!drawerId) return;
  DB.update(KEY, drawerId, { status });
  openDrawer(drawerId);
  render();
}
function editFromDrawer() { const id = drawerId; closeDrawer(); openEdit(id); }
function delFromDrawer() { const id = drawerId; if (confirmDel()) { closeDrawer(); DB.del(KEY, id); render(); } }

render();


Object.assign(window, { getAllTags, refreshTagFilter, fmtMoney, filtered, stageMeta, renderPipeline, render, openAdd, openEdit, resetForm, save, del, openDrawer, closeDrawer, toggleNoteForm, addNote, changeStage, editFromDrawer, delFromDrawer });
})();
