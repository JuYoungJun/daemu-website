(function() {
  'use strict';
const STORAGE_KEY = "partners";
let editingId = null;

// ── backend ↔ admin shape 매핑 ──────────────────────────────
// Partner.status 값: '대기' (신청 직후) / '승인' (활성화 완료) / '비활성' (관리자가 비활성).
// 활성화 = '승인' 인 row 만. '대기' / '비활성' / 빈 값 / 기타 → 비활성 (= 로그인/발주 불가).
function _mapBackendPartner(it) {
  const rawStatus = it.status || '대기';
  const isApproved = rawStatus === '승인' || rawStatus === 'approved' || rawStatus === 'active' || rawStatus === '활성';
  return {
    id: it.id,
    name: it.company_name || '',
    person: it.contact_name || '',
    email: it.email || '',
    phone: it.phone || '',
    type: it.category || '',
    role: '발주 전용',
    active: isApproved ? 'active' : 'inactive',
    note: it.intro || '',
    status: rawStatus,  // 대기 / 승인 / 비활성
    approved_at: it.approved_at || null,
    date: it.created_at ? new Date(it.created_at).toLocaleDateString('ko-KR') : '',
  };
}
function _toBackendPartner(p) {
  return {
    company_name: p.name || '',
    contact_name: p.person || '',
    email: p.email || '',
    phone: p.phone || '',
    category: p.type || '',
    intro: p.note || '',
    status: p.active === 'inactive' ? '비활성' : (p.status || '승인'),
  };
}
async function hydrateFromBackend() {
  if (!window.daemuHydrate) return;
  await window.daemuHydrate({
    storageKey: STORAGE_KEY,
    endpoint: '/api/partners?page=1&page_size=500',
    mapItem: _mapBackendPartner,
  });
}

function filtered() {
  const q = (document.getElementById("q").value || "").toLowerCase();
  const fr = document.getElementById("filter-role").value;
  const fa = document.getElementById("filter-active").value;
  return (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).filter(d =>
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
    // 상태 라벨 — backend status 값 그대로 노출 (신청자가 본 운영자가 의미를 즉시 이해).
    //   대기   → "신청 (대기)"  파란 배지
    //   승인   → "활성"        초록 배지
    //   비활성 → "비활성"      회색 배지
    const statusLabel = d.status === '승인' ? '활성'
      : d.status === '비활성' ? '비활성'
      : '신청 (대기)';
    return `<tr>
      <td data-label="회사명">${escHtml(d.name)}</td>
      <td data-label="담당자">${escHtml(d.person||"-")}</td>
      <td data-label="연락처">${escHtml(d.phone||"-")}</td>
      <td data-label="업종">${escHtml(d.type||"-")}</td>
      <td data-label="권한">${escHtml(d.role||"-")}</td>
      <td data-label="상태">${badge(statusLabel)}</td>
      <td data-label="관리" class="col-actions">
        <button class="adm-btn-sm" onclick="toggleActive(${escAttr(d.id)})">${isActive ? "비활성으로" : "승인/활성화"}</button>
        <button class="adm-btn-sm" onclick="openEdit(${escAttr(d.id)})">수정</button>
        <button class="adm-btn-sm danger" onclick="del(${escAttr(d.id)})">삭제</button>
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
  const d = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === id);
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

async function save() {
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
  // 정책: backend Aiven 이 source of truth. backend 가 OK 일 때만 미러 갱신.
  if (!window.daemuMirror) {
    alert('백엔드 미연결 — 저장할 수 없습니다.');
    return;
  }
  if (editingId !== null) {
    const existing = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === editingId);
    const r = await window.daemuMirror({
      method: 'PATCH', endpoint: '/api/partners/' + editingId,
      body: _toBackendPartner({ ...(existing || {}), ...payload }),
      refetchKey: STORAGE_KEY,
    });
    if (!r.ok) {
      alert('서버 저장에 실패했습니다. 잠시 후 다시 시도해 주세요. (' + (r.error || ('HTTP ' + (r.status || 0))) + ')');
      return;
    }
  } else {
    const r = await window.daemuMirror({
      method: 'POST', endpoint: '/api/partners', body: _toBackendPartner(payload),
      refetchKey: STORAGE_KEY,
    });
    if (!r.ok || !r.item || r.item.id == null) {
      alert('서버 저장에 실패했습니다. 잠시 후 다시 시도해 주세요. (' + (r.error || ('HTTP ' + (r.status || 0))) + ')');
      return;
    }
  }
  resetForm();
  render();
}

async function toggleActive(id) {
  const d = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === id);
  if (!d) return;
  const next = d.active === "inactive" ? "active" : "inactive";
  if (d._backend) {
    if (!window.daemuMirror) {
      alert('백엔드 미연결 — 상태 변경할 수 없습니다.');
      return;
    }
    const r = await window.daemuMirror({
      method: 'PATCH', endpoint: '/api/partners/' + id,
      body: { status: next === 'inactive' ? '비활성' : '승인' },
      refetchKey: STORAGE_KEY,
    });
    if (!r.ok) {
      alert('서버 상태 변경에 실패했습니다. 잠시 후 다시 시도해 주세요. (' + (r.error || ('HTTP ' + (r.status || 0))) + ')');
      return;
    }
  }
  render();
}

async function del(id) {
  if (!confirmDel()) return;
  const existing = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === id);
  if (existing && existing._backend && window.daemuMirror) {
    const r = await window.daemuMirror({ method: 'DELETE', endpoint: '/api/partners/' + id, refetchKey: STORAGE_KEY });
    if (!r.ok) { alert('백엔드 삭제 실패'); return; }
  }
  render();
}
render();
hydrateFromBackend().then(render);


Object.assign(window, { filtered, render, openAdd, openEdit, resetForm, save, toggleActive, del, hydrateFromBackend });
})();
