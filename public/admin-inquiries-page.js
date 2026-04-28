(function() {
  'use strict';
const STORAGE_KEY = "inquiries";
let editingId = null;

// 백엔드에서 실제 문의를 가져와 localStorage로 미러합니다.
// Contact 폼은 백엔드 /api/inquiries로 직접 전송되므로,
// admin 페이지 진입 시 한 번 sync해야 실 데이터가 보입니다.
async function hydrateFromBackend() {
  try {
    if (!window.api || !window.api.isConfigured || !window.api.isConfigured()) return;
    const r = await window.api.get('/api/inquiries?page=1&page_size=500');
    if (!r || !r.ok || !Array.isArray(r.items)) return;
    const STATUS_MAP = { 'new': '신규', 'pending': '처리중', 'replied': '답변완료' };
    // backend 응답을 admin UI가 기대하는 shape로 매핑
    const mapped = r.items.map(it => ({
      id: it.id,
      name: it.name || '',
      phone: it.phone || '',
      email: it.email || '',
      type: it.category || it.type || '',
      status: STATUS_MAP[it.status] || it.status || '신규',
      open: it.expected_open || '',
      brand: it.brand_name || '',
      region: it.location || '',
      msg: it.message || '',
      reply: it.note || '',
      date: it.created_at ? new Date(it.created_at).toLocaleDateString('ko') : '',
      _backend: true,                       // 표식: 백엔드 row
    }));
    DB.set(STORAGE_KEY, mapped);
    window.dispatchEvent(new Event('daemu-db-change'));
  } catch (e) { /* 백엔드 미연결 — localStorage 데이터 그대로 사용 */ }
}

function filtered() {
  const q = (document.getElementById("q").value || "").toLowerCase();
  const fs = document.getElementById("filter-status").value;
  const ft = document.getElementById("filter-type").value;
  return DB.get(STORAGE_KEY).filter(d =>
    (!q || (d.name+" "+(d.email||"")+" "+(d.msg||"")).toLowerCase().includes(q)) &&
    (!fs || d.status === fs) &&
    (!ft || d.type === ft)
  );
}

function render() {
  const all = DB.get(STORAGE_KEY);
  document.getElementById("s-total").textContent = all.length;
  document.getElementById("s-new").textContent = all.filter(d=>d.status==="신규").length;
  document.getElementById("s-pending").textContent = all.filter(d=>d.status==="처리중").length;
  document.getElementById("s-done").textContent = all.filter(d=>d.status==="답변완료").length;

  const data = filtered();
  document.getElementById("count").textContent = data.length + "건";
  document.getElementById("list").innerHTML = data.length ? data.map(d =>
    `<tr>
      <td data-label="이름">${escHtml(d.name)}</td>
      <td data-label="연락처">${escHtml(d.phone||"-")}</td>
      <td data-label="업종">${escHtml(d.type||"-")}</td>
      <td data-label="접수일">${escHtml(d.date)}</td>
      <td data-label="상태">${badge(d.status)}</td>
      <td data-label="관리" class="col-actions">
        <select class="adm-status-select" onchange="updateStatus(${escAttr(d.id)},this.value)">
          <option ${d.status==="신규"?"selected":""}>신규</option>
          <option ${d.status==="처리중"?"selected":""}>처리중</option>
          <option ${d.status==="답변완료"?"selected":""}>답변완료</option>
        </select>
        <button class="adm-btn-sm" onclick="openEdit(${escAttr(d.id)})">수정</button>
        <button class="adm-btn-sm danger" onclick="del(${escAttr(d.id)})">삭제</button>
      </td>
    </tr>`
  ).join("") : '<tr><td colspan="6" class="adm-empty">조건에 맞는 문의가 없습니다.</td></tr>';
}

function openAdd() {
  editingId = null;
  ["f-name","f-phone","f-email","f-msg","f-reply","f-open"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("f-type").value = "창업 컨설팅";
  document.getElementById("f-status").value = "신규";
  document.getElementById("save-btn").textContent = "저장";
  document.getElementById("form-mode").textContent = "신규 등록";
  document.getElementById("form-area").classList.add("show");
}

function openEdit(id) {
  const d = DB.get(STORAGE_KEY).find(x => x.id === id);
  if (!d) return;
  editingId = id;
  document.getElementById("f-name").value = d.name || "";
  document.getElementById("f-phone").value = d.phone || "";
  document.getElementById("f-email").value = d.email || "";
  document.getElementById("f-type").value = d.type || "창업 컨설팅";
  document.getElementById("f-status").value = d.status || "신규";
  document.getElementById("f-open").value = d.open || "";
  document.getElementById("f-msg").value = d.msg || "";
  document.getElementById("f-reply").value = d.reply || "";
  document.getElementById("save-btn").textContent = "수정";
  document.getElementById("form-mode").textContent = "수정 모드 · #"+String(id).slice(-6);
  document.getElementById("form-area").classList.add("show");
  scrollTo({top: document.getElementById("form-area").offsetTop - 40, behavior:"smooth"});
}

function resetForm() {
  document.getElementById("form-area").classList.remove("show");
  editingId = null;
}

// 백엔드 ↔ localStorage 양방향 동기화 헬퍼.
// 백엔드 row(_backend=true)는 PATCH/DELETE /api/inquiries/{id}로,
// 데모(localStorage-only) row는 그대로 localStorage에 저장.
async function backendPatch(id, body) {
  try {
    if (!window.api || !window.api.isConfigured || !window.api.isConfigured()) return false;
    const REVERSE = { '신규': 'new', '처리중': 'pending', '답변완료': 'replied' };
    const apiBody = {
      status: REVERSE[body.status] || body.status,
      note: body.reply,
      replied: body.status === '답변완료',
    };
    const r = await window.api.patch('/api/inquiries/' + id, apiBody);
    return !!(r && r.ok);
  } catch (e) { return false; }
}
async function backendDelete(id) {
  try {
    if (!window.api || !window.api.isConfigured || !window.api.isConfigured()) return false;
    const r = await window.api.del('/api/inquiries/' + id);
    return !!(r && (r.ok || r.status === 204));
  } catch (e) { return false; }
}

async function save() {
  const name = document.getElementById("f-name").value.trim();
  if (!name) { alert("이름을 입력하세요"); return; }
  const payload = {
    name,
    phone: document.getElementById("f-phone").value,
    email: document.getElementById("f-email").value,
    type: document.getElementById("f-type").value,
    status: document.getElementById("f-status").value,
    open: document.getElementById("f-open").value,
    msg: document.getElementById("f-msg").value,
    reply: document.getElementById("f-reply").value
  };
  if (editingId !== null) {
    const existing = DB.get(STORAGE_KEY).find(x => x.id === editingId);
    DB.update(STORAGE_KEY, editingId, payload);
    if (existing && existing._backend) {
      const ok = await backendPatch(editingId, payload);
      if (!ok) alert('백엔드 동기화 실패 — 화면에는 반영했으나 서버에는 저장되지 않았습니다.');
    }
  } else {
    DB.add(STORAGE_KEY, payload);
    if (payload.email && window.sendAutoReply && window.isEmailEnabled && window.isEmailEnabled()) {
      window.sendAutoReply({ to_email: payload.email, to_name: payload.name, category: payload.type, message: payload.msg })
        .catch(() => { /* silent */ });
    }
  }
  resetForm();
  render();
}

async function updateStatus(id, status) {
  const existing = DB.get(STORAGE_KEY).find(x => x.id === id);
  DB.update(STORAGE_KEY, id, { status });
  if (existing && existing._backend) {
    const ok = await backendPatch(id, { status, reply: existing.reply });
    if (!ok) alert('백엔드 동기화 실패 — 화면에는 반영했으나 서버에는 저장되지 않았습니다.');
  }
  if (status === '답변완료' && window.sendAdminReply && window.isEmailEnabled && window.isEmailEnabled()) {
    const d = DB.get(STORAGE_KEY).find(x => x.id === id);
    if (d && d.email && d.reply && d.reply.trim()) {
      if (confirm('회신 메모 내용을 ' + d.email + ' 로 발송할까요?')) {
        window.sendAdminReply({ to_email: d.email, to_name: d.name, subject: '[대무] 문의 회신', body: d.reply })
          .then(r => alert(r.ok ? '회신 메일 발송 완료' : '메일 발송 실패: ' + (r.error || r.reason || '')))
          .catch(err => alert('메일 발송 실패: ' + err));
      }
    }
  }
  render();
}

async function del(id) {
  if (!confirmDel()) return;
  const existing = DB.get(STORAGE_KEY).find(x => x.id === id);
  if (existing && existing._backend) {
    const ok = await backendDelete(id);
    if (!ok) {
      alert('백엔드 삭제 실패 — 다시 시도해 주세요.');
      return;
    }
  }
  DB.del(STORAGE_KEY, id);
  render();
}

// 새로고침 버튼 — backend에서 다시 가져오기.
async function reloadFromBackend() {
  const btn = document.getElementById('reload-btn');
  if (btn) btn.disabled = true;
  await hydrateFromBackend();
  render();
  if (btn) btn.disabled = false;
}

// 초기 로드: 동기 render 먼저 → backend hydrate 끝나면 다시 render
render();
hydrateFromBackend().then(render);

Object.assign(window, { filtered, render, openAdd, openEdit, resetForm, save, updateStatus, del, reloadFromBackend });
})();
