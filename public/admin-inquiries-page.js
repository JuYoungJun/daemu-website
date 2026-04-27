(function() {
  'use strict';
const KEY = "inquiries";
let editingId = null;

function filtered() {
  const q = (document.getElementById("q").value || "").toLowerCase();
  const fs = document.getElementById("filter-status").value;
  const ft = document.getElementById("filter-type").value;
  return DB.get(KEY).filter(d =>
    (!q || (d.name+" "+(d.email||"")+" "+(d.msg||"")).toLowerCase().includes(q)) &&
    (!fs || d.status === fs) &&
    (!ft || d.type === ft)
  );
}

function render() {
  const all = DB.get(KEY);
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
  const d = DB.get(KEY).find(x => x.id === id);
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

function save() {
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
    DB.update(KEY, editingId, payload);
  } else {
    DB.add(KEY, payload);
    // Fire auto-reply for newly added inquiry (best-effort, non-blocking)
    if (payload.email && window.sendAutoReply && window.isEmailEnabled && window.isEmailEnabled()) {
      window.sendAutoReply({ to_email: payload.email, to_name: payload.name, category: payload.type, message: payload.msg })
        .catch(() => { /* silent */ });
    }
  }
  resetForm();
  render();
}

function updateStatus(id, status) {
  DB.update(KEY, id, { status });
  // When admin marks 답변완료, optionally send admin reply email if reply memo exists
  if (status === '답변완료' && window.sendAdminReply && window.isEmailEnabled && window.isEmailEnabled()) {
    const d = DB.get(KEY).find(x => x.id === id);
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
function del(id) { if (confirmDel()) { DB.del(KEY, id); render(); } }
render();


Object.assign(window, { filtered, render, openAdd, openEdit, resetForm, save, updateStatus, del });
})();
