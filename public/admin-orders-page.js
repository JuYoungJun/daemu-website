(function() {
  'use strict';
const KEY = "orders";
let editingId = null;
let pendingAttachments = []; // [{ filename, content (base64), mimeType, previewUrl, isImage }]

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
    const hasContract = !!(d.contract && d.contract.trim());
    const hasPO = !!(d.purchaseOrder && d.purchaseOrder.trim());
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
        ${hasPO ? `<button class="adm-btn-sm" onclick="sendDoc(${d.id},'po')">발주서 발송</button>` : ''}
        ${hasContract ? `<button class="adm-btn-sm" onclick="sendDoc(${d.id},'contract')">계약서 발송</button>` : ''}
        <button class="adm-btn-sm" onclick="openEdit(${d.id})">수정</button>
        <button class="adm-btn-sm danger" onclick="del(${d.id})">삭제</button>
      </td>
    </tr>`;
  }).join("") : '<tr><td colspan="8" class="adm-empty">조건에 맞는 발주가 없습니다.</td></tr>';
}

function openAdd() {
  editingId = null;
  loadPartners();
  pendingAttachments = [];
  ["f-partner","f-qty","f-price","f-note","f-contract","f-purchaseorder"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  document.getElementById("f-partner-pick").value = "";
  document.getElementById("f-product").value = "생지 (냉동)";
  document.getElementById("f-status").value = "접수";
  document.getElementById("save-btn").textContent = "저장";
  document.getElementById("form-mode").textContent = "신규 등록";
  document.getElementById("form-area").classList.add("show");
  renderAttachments();
}

function openEdit(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  editingId = id;
  loadPartners();
  pendingAttachments = (d.attachments || []).map(a => ({...a}));
  document.getElementById("f-partner-pick").value = d.partner || "";
  document.getElementById("f-partner").value = d.partner || "";
  document.getElementById("f-product").value = d.product || "생지 (냉동)";
  document.getElementById("f-qty").value = d.qty || "";
  document.getElementById("f-price").value = d.price || "";
  document.getElementById("f-status").value = d.status || "접수";
  document.getElementById("f-note").value = d.note || "";
  const cf = document.getElementById("f-contract");
  if (cf) cf.value = d.contract || "";
  const pf = document.getElementById("f-purchaseorder");
  if (pf) pf.value = d.purchaseOrder || "";
  document.getElementById("save-btn").textContent = "수정";
  document.getElementById("form-mode").textContent = "수정 모드 · #"+String(id).slice(-6);
  document.getElementById("form-area").classList.add("show");
  renderAttachments();
  scrollTo({top: document.getElementById("form-area").offsetTop - 40, behavior:"smooth"});
}

function resetForm() {
  document.getElementById("form-area").classList.remove("show");
  editingId = null;
  pendingAttachments = [];
}

function save() {
  const partner = document.getElementById("f-partner").value.trim();
  if (!partner) { alert("파트너명을 입력하세요"); return; }
  const cf = document.getElementById("f-contract");
  const pf = document.getElementById("f-purchaseorder");
  const payload = {
    partner,
    product: document.getElementById("f-product").value,
    qty: document.getElementById("f-qty").value,
    price: document.getElementById("f-price").value,
    status: document.getElementById("f-status").value,
    note: document.getElementById("f-note").value,
    contract: cf ? cf.value : "",
    purchaseOrder: pf ? pf.value : "",
    attachments: pendingAttachments
  };
  if (editingId !== null) DB.update(KEY, editingId, payload);
  else DB.add(KEY, payload);
  resetForm();
  render();
  if (window.siteToast) window.siteToast('저장 완료', { tone: 'success' });
}

function updateStatus(id, status) { DB.update(KEY, id, { status }); render(); }
function del(id) { if (confirmDel()) { DB.del(KEY, id); render(); } }

/* Attachments */
async function addOrderAttachments(files) {
  for (const file of Array.from(files)) {
    try {
      let content, previewUrl, mimeType;
      if (file.type.startsWith('image/')) {
        const optimized = await window.uploadImage(file);
        previewUrl = optimized.url;
        content = (optimized.url.split(',')[1] || '');
        mimeType = 'image/jpeg';
      } else {
        const buf = await file.arrayBuffer();
        const b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
        content = b64;
        previewUrl = '';
        mimeType = file.type || 'application/octet-stream';
      }
      pendingAttachments.push({
        filename: file.name,
        content,
        mimeType,
        previewUrl,
        isImage: file.type.startsWith('image/'),
        size: file.size
      });
    } catch (err) {
      alert('첨부 실패: ' + (err && err.message ? err.message : err));
    }
  }
  document.getElementById('f-doc-files').value = '';
  renderAttachments();
}

function removeOrderAttachment(i) {
  pendingAttachments.splice(i, 1);
  renderAttachments();
}

function renderAttachments() {
  const wrap = document.getElementById('f-doc-thumbs');
  if (!wrap) return;
  wrap.innerHTML = pendingAttachments.map((a, i) => {
    if (a.isImage && a.previewUrl) {
      return `<div class="adm-thumb"><img src="${a.previewUrl}" alt=""><button type="button" class="x" onclick="removeOrderAttachment(${i})">×</button></div>`;
    }
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f6f4f0;border:1px solid #d7d4cf;font-size:12px">📎 ${a.filename} <button type="button" onclick="removeOrderAttachment(${i})" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:13px">×</button></div>`;
  }).join('');
}

/* Document send (계약서 / 발주서) */
async function sendDoc(id, kind) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  const partner = DB.get('partners').find(p => p.name === d.partner);
  const email = partner && partner.email;
  if (!email) { alert('해당 파트너의 이메일이 등록되어 있지 않습니다.'); return; }

  const isPO = kind === 'po';
  const subject = isPO
    ? '[대무] 발주서 #' + String(id).slice(-6)
    : '[대무] 발주 계약서 #' + String(id).slice(-6);
  const body = isPO
    ? (d.purchaseOrder || d.contract || '')
    : (d.contract || '');
  if (!body.trim()) { alert('본문이 비어 있습니다. 발주를 수정해 본문을 작성하세요.'); return; }

  if (!confirm(email + ' 로 ' + (isPO ? '발주서' : '계약서') + '를 발송합니다.\n첨부 파일 ' + (d.attachments?.length || 0) + '개 포함.\n진행할까요?')) return;

  if (window.sendDocument && window.isEmailEnabled && window.isEmailEnabled()) {
    const r = await window.sendDocument({
      to_email: email,
      to_name: partner.person || partner.name,
      subject,
      body,
      attachments: (d.attachments || []).map(a => ({ filename: a.filename, content: a.content }))
    });
    alert(r.ok ? (isPO ? '발주서' : '계약서') + ' 발송 완료' : '발송 실패: ' + (r.error || r.reason || ''));
  } else {
    alert('백엔드 미설정 — 시뮬레이션 (Outbox에 기록).');
    // Still call sendDocument so it logs to outbox in simulation mode
    if (window.sendDocument) {
      await window.sendDocument({
        to_email: email,
        to_name: partner.person || partner.name,
        subject,
        body,
        attachments: (d.attachments || []).map(a => ({ filename: a.filename, content: a.content }))
      });
    }
  }
}

render();

Object.assign(window, {
  loadPartners, onPickPartner, fmtMoney, filtered, render,
  openAdd, openEdit, resetForm, save, updateStatus, del,
  sendDoc, addOrderAttachments, removeOrderAttachment, renderAttachments
});
})();
