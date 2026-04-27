(function() {
  'use strict';
const KEY = "orders";
let editingId = null;

function loadPartners() {
  const sel = document.getElementById("f-partner-pick");
  const partners = DB.get("partners");
  sel.innerHTML = '<option value="">— 등록된 파트너 선택 —</option>' +
    partners.map(p => `<option value="${p.name}">${p.name} · ${p.role||""}</option>`).join("");
}
function onPickPartner() {
  const v = document.getElementById("f-partner-pick").value;
  if (v) document.getElementById("f-partner").value = v;
}

function fmtMoney(n){ return Number(n||0).toLocaleString('ko'); }

function filtered() {
  const q = (document.getElementById("q").value || "").toLowerCase();
  const fs = document.getElementById("filter-status").value;
  return DB.get(KEY).filter(d =>
    (!q || (d.partner+" "+d.product).toLowerCase().includes(q)) &&
    (!fs || d.status === fs)
  );
}

function render() {
  const all = DB.get(KEY);
  document.getElementById("s-total").textContent = all.length;
  document.getElementById("s-new").textContent = all.filter(d=>d.status==="접수").length;
  document.getElementById("s-pending").textContent = all.filter(d=>d.status==="처리중").length;
  const totalAmt = all.reduce((sum, d) => sum + (Number(d.qty||0) * Number(d.price||0)), 0);
  document.getElementById("s-amount").textContent = fmtMoney(totalAmt);

  const data = filtered();
  document.getElementById("count").textContent = data.length + "건";
  document.getElementById("list").innerHTML = data.length ? data.map(d => {
    const amt = Number(d.qty||0) * Number(d.price||0);
    return `<tr>
      <td data-label="주문번호">#${String(d.id).slice(-6)}</td>
      <td data-label="파트너">${d.partner}</td>
      <td data-label="상품">${d.product}</td>
      <td data-label="수량">${d.qty||"-"}</td>
      <td data-label="금액">${amt ? fmtMoney(amt)+'원' : '-'}</td>
      <td data-label="접수일">${d.date}</td>
      <td data-label="상태">${badge(d.status)}</td>
      <td data-label="관리" class="col-actions">
        <select class="adm-status-select" onchange="updateStatus(${d.id},this.value)">
          <option ${d.status==="접수"?"selected":""}>접수</option>
          <option ${d.status==="처리중"?"selected":""}>처리중</option>
          <option ${d.status==="출고완료"?"selected":""}>출고완료</option>
        </select>
        ${d.contract ? `<button class="adm-btn-sm" onclick="sendContract(${d.id})">계약서 발송</button>` : ''}
        <button class="adm-btn-sm" onclick="openEdit(${d.id})">수정</button>
        <button class="adm-btn-sm danger" onclick="del(${d.id})">삭제</button>
      </td>
    </tr>`;
  }).join("") : '<tr><td colspan="8" class="adm-empty">조건에 맞는 발주가 없습니다.</td></tr>';
}

function openAdd() {
  editingId = null;
  loadPartners();
  ["f-partner","f-qty","f-price","f-note"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("f-partner-pick").value = "";
  document.getElementById("f-product").value = "생지 (냉동)";
  document.getElementById("f-status").value = "접수";
  document.getElementById("save-btn").textContent = "저장";
  document.getElementById("form-mode").textContent = "신규 등록";
  document.getElementById("form-area").classList.add("show");
}

function openEdit(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  editingId = id;
  loadPartners();
  document.getElementById("f-partner-pick").value = d.partner || "";
  document.getElementById("f-partner").value = d.partner || "";
  document.getElementById("f-product").value = d.product || "생지 (냉동)";
  document.getElementById("f-qty").value = d.qty || "";
  document.getElementById("f-price").value = d.price || "";
  document.getElementById("f-status").value = d.status || "접수";
  document.getElementById("f-note").value = d.note || "";
  const cf = document.getElementById("f-contract");
  if (cf) cf.value = d.contract || "";
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
  const partner = document.getElementById("f-partner").value.trim();
  if (!partner) { alert("파트너명을 입력하세요"); return; }
  const cf = document.getElementById("f-contract");
  const payload = {
    partner,
    product: document.getElementById("f-product").value,
    qty: document.getElementById("f-qty").value,
    price: document.getElementById("f-price").value,
    status: document.getElementById("f-status").value,
    note: document.getElementById("f-note").value,
    contract: cf ? cf.value : ""
  };
  if (editingId !== null) DB.update(KEY, editingId, payload);
  else DB.add(KEY, payload);
  resetForm();
  render();
}

function updateStatus(id, status) { DB.update(KEY, id, { status }); render(); }
function del(id) { if (confirmDel()) { DB.del(KEY, id); render(); } }

async function sendContract(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d || !d.contract) { alert('계약서 본문이 비어 있습니다. 발주 항목을 수정해서 작성하세요.'); return; }
  const partner = DB.get('partners').find(p => p.name === d.partner);
  const email = partner && partner.email;
  if (!email) { alert('해당 파트너의 이메일이 등록되어 있지 않습니다.'); return; }
  if (!confirm(email + ' 로 계약서를 발송할까요?')) return;
  if (window.sendAdminReply && window.isEmailEnabled && window.isEmailEnabled()) {
    const r = await window.sendAdminReply({ to_email: email, to_name: partner.person || partner.name, subject: '[대무] 발주 계약서 #' + String(id).slice(-6), body: d.contract });
    alert(r.ok ? '계약서 발송 완료' : '발송 실패: ' + (r.error || r.reason));
  } else {
    alert('이메일 API 미설정 — 발송 시뮬레이션. (.env에 EmailJS 키 등록 시 실제 발송)');
  }
}

render();


Object.assign(window, { loadPartners, onPickPartner, fmtMoney, filtered, render, openAdd, openEdit, resetForm, save, updateStatus, del, sendContract });
})();
