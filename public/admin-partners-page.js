(function() {
  'use strict';
const KEY = "partners";
let editingId = null;

function filtered() {
  const q = (document.getElementById("q").value || "").toLowerCase();
  const fr = document.getElementById("filter-role").value;
  const fa = document.getElementById("filter-active").value;
  return DB.get(KEY).filter(d =>
    (!q || (d.name+" "+(d.person||"")).toLowerCase().includes(q)) &&
    (!fr || d.role === fr) &&
    (!fa || (d.active||"active") === fa)
  );
}

function render() {
  const data = filtered();
  document.getElementById("count").textContent = data.length + "건";
  document.getElementById("list").innerHTML = data.length ? data.map(d => {
    const isActive = (d.active || "active") === "active";
    return `<tr>
      <td data-label="회사명">${d.name}</td>
      <td data-label="담당자">${d.person||"-"}</td>
      <td data-label="연락처">${d.phone||"-"}</td>
      <td data-label="업종">${d.type||"-"}</td>
      <td data-label="권한">${d.role||"-"}</td>
      <td data-label="상태">${badge(isActive ? "활성" : "비활성")}</td>
      <td data-label="관리" class="col-actions">
        <button class="adm-btn-sm" onclick="toggleActive(${d.id})">${isActive ? "비활성" : "활성"}</button>
        <button class="adm-btn-sm" onclick="openEdit(${d.id})">수정</button>
        <button class="adm-btn-sm danger" onclick="del(${d.id})">삭제</button>
      </td>
    </tr>`;
  }).join("") : '<tr><td colspan="7" class="adm-empty">조건에 맞는 파트너가 없습니다.</td></tr>';
}

function openAdd() {
  editingId = null;
  ["f-name","f-person","f-phone","f-email","f-type","f-note"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("f-role").value = "발주 전용";
  document.getElementById("f-active").value = "active";
  document.getElementById("save-btn").textContent = "저장";
  document.getElementById("form-mode").textContent = "신규 등록";
  document.getElementById("form-area").classList.add("show");
}

function openEdit(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  editingId = id;
  document.getElementById("f-name").value = d.name || "";
  document.getElementById("f-person").value = d.person || "";
  document.getElementById("f-phone").value = d.phone || "";
  document.getElementById("f-email").value = d.email || "";
  document.getElementById("f-type").value = d.type || "";
  document.getElementById("f-role").value = d.role || "발주 전용";
  document.getElementById("f-active").value = d.active || "active";
  document.getElementById("f-note").value = d.note || "";
  document.getElementById("save-btn").textContent = "수정";
  document.getElementById("form-mode").textContent = "수정 모드 · #"+String(id).slice(-6);
  document.getElementById("form-area").classList.add("show");
  scrollTo({top: document.getElementById("form-area").offsetTop - 40, behavior:"smooth"});
}

function resetForm() {
  document.getElementById("form-area").classList.remove("show");
  editingId = null;
}

function save() {
  const name = document.getElementById("f-name").value.trim();
  if (!name) { alert("회사명을 입력하세요"); return; }
  const payload = {
    name,
    person: document.getElementById("f-person").value,
    phone: document.getElementById("f-phone").value,
    email: document.getElementById("f-email").value,
    type: document.getElementById("f-type").value,
    role: document.getElementById("f-role").value,
    active: document.getElementById("f-active").value,
    note: document.getElementById("f-note").value
  };
  if (editingId !== null) DB.update(KEY, editingId, payload);
  else DB.add(KEY, payload);
  resetForm();
  render();
}

function toggleActive(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  DB.update(KEY, id, { active: (d.active === "inactive" ? "active" : "inactive") });
  render();
}

function del(id) { if (confirmDel()) { DB.del(KEY, id); render(); } }
render();


Object.assign(window, { filtered, render, openAdd, openEdit, resetForm, save, toggleActive, del });
})();
