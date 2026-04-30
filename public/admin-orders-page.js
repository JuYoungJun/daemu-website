(function() {
  'use strict';
const STORAGE_KEY = "orders";
let editingId = null;
let pendingAttachments = []; // [{ filename, content (base64), mimeType, previewUrl, isImage }]

// ── 백엔드 ↔ localStorage 매핑 ──────────────────────────────────
// backend Order 의 items 는 JSON 배열 — 우리는 단일 product/qty/price 만 쓰니
// items[0] 으로 압축. 다중 라인 발주는 V2 에서 확장.
function _mapBackendOrder(it) {
  const first = (Array.isArray(it.items) && it.items[0]) || {};
  return {
    id: it.id,
    po_no: it.po_no || first.po_no || it.title || ('#' + String(it.id).slice(-6)),
    partner: first.partner_name || it.partner_name || '',
    product: first.product || it.title || '',
    qty: first.qty || 0,
    price: first.price || 0,
    status: it.status || '접수',
    note: it.note || '',
    contract: first.contract || '',
    purchaseOrder: first.purchaseOrder || first.po_body || '',
    attachments: first.attachments || [],
    date: it.created_at ? new Date(it.created_at).toLocaleDateString('ko-KR') : '',
  };
}
function _toBackendOrderPayload(p) {
  return {
    title: p.po_no || (p.product || '발주'),
    status: p.status || '접수',
    amount: Number(p.qty || 0) * Number(p.price || 0),
    items: [{
      partner_name: p.partner,
      product: p.product,
      qty: Number(p.qty || 0),
      price: Number(p.price || 0),
      contract: p.contract || '',
      purchaseOrder: p.purchaseOrder || '',
      attachments: p.attachments || [],
      po_no: p.po_no || '',
    }],
    note: p.note || '',
  };
}
async function hydrateFromBackend() {
  if (!window.daemuHydrate) return;
  await window.daemuHydrate({
    storageKey: STORAGE_KEY,
    endpoint: '/api/orders?page=1&page_size=500',
    mapItem: _mapBackendOrder,
  });
}

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
  return DB.get(STORAGE_KEY).filter(d =>
    (!q || (d.partner+" "+d.product).toLowerCase().includes(q)) &&
    (!fs || d.status === fs)
  );
}

function render() {
  const all = DB.get(STORAGE_KEY);
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
      <td data-label="주문번호">${escHtml(d.po_no || ('#'+String(d.id).slice(-6)))}</td>
      <td data-label="파트너">${escHtml(d.partner)}</td>
      <td data-label="상품">${escHtml(d.product)}</td>
      <td data-label="수량">${escHtml(d.qty||"-")}</td>
      <td data-label="금액">${amt ? fmtMoney(amt)+'원' : '-'}</td>
      <td data-label="접수일">${escHtml(d.date)}</td>
      <td data-label="상태">${badge(d.status)}</td>
      <td data-label="관리" class="col-actions">
        <select class="adm-status-select" onchange="updateStatus(${escAttr(d.id)},this.value)">
          <option ${d.status==="접수"?"selected":""}>접수</option>
          <option ${d.status==="처리중"?"selected":""}>처리중</option>
          <option ${d.status==="출고완료"?"selected":""}>출고완료</option>
        </select>
        ${hasPO ? `<button class="adm-btn-sm" onclick="sendDoc(${escAttr(d.id)},'po')">발주서 발송</button>` : ''}
        ${hasContract ? `<button class="adm-btn-sm" onclick="sendDoc(${escAttr(d.id)},'contract')">계약서 발송</button>` : ''}
        <button class="adm-btn-sm" onclick="openEdit(${escAttr(d.id)})">수정</button>
        <button class="adm-btn-sm danger" onclick="del(${escAttr(d.id)})">삭제</button>
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
  const d = DB.get(STORAGE_KEY).find(x => x.id === id);
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

async function save() {
  const partner = document.getElementById("f-partner").value.trim();
  if (!partner) { alert("파트너명을 입력하세요"); return; }
  const cf = document.getElementById("f-contract");
  const pf = document.getElementById("f-purchaseorder");
  const product = document.getElementById("f-product").value;
  const qty = Number(document.getElementById("f-qty").value) || 0;
  const price = Number(document.getElementById("f-price").value) || 0;
  const payload = {
    partner,
    product,
    qty,
    price,
    status: document.getElementById("f-status").value,
    note: document.getElementById("f-note").value,
    contract: cf ? cf.value : "",
    purchaseOrder: pf ? pf.value : "",
    attachments: pendingAttachments,
  };
  if (editingId !== null) {
    const existing = DB.get(STORAGE_KEY).find(x => x.id === editingId);
    DB.update(STORAGE_KEY, editingId, payload);
    if (existing && existing._backend && window.daemuMirror) {
      const r = await window.daemuMirror({
        method: 'PATCH',
        endpoint: '/api/orders/' + editingId,
        body: _toBackendOrderPayload({ ...existing, ...payload }),
      });
      if (!r.ok) alert('백엔드 동기화 실패 — 화면에는 반영했으나 서버에는 저장되지 않았습니다.');
    }
  } else {
    // 신규 발주 — PO 번호 자동 생성 + 입력된 SKU 가 카탈로그에 있으면 재고 차감.
    if (typeof window.nextPoNumber === 'function') {
      payload.po_no = window.nextPoNumber();
    }
    // product 값에 SKU 형태(예: BAKERY-001) 가 들어있으면 재고 검증 + 차감.
    // 재고 부족 시 발주 저장 자체를 차단 (발주 후 차감 실패가 아니라 사전 차단).
    if (typeof window.decrementStock === 'function' && qty > 0) {
      const m = /[A-Z][A-Z0-9_-]+-\d{3,}/.exec(String(product || ''));
      if (m && typeof window.getStock === 'function') {
        const cur = window.getStock(m[0]);
        if (cur != null && cur < qty) {
          alert(`재고 부족 — ${m[0]} 잔여 ${cur}, 요청 ${qty}. 발주를 저장할 수 없습니다.`);
          return;
        }
      }
    }
    // backend 미러 — server id 우선 사용, 실패 시 client 측 임시 id.
    if (window.daemuMirror) {
      const r = await window.daemuMirror({
        method: 'POST',
        endpoint: '/api/orders',
        body: _toBackendOrderPayload(payload),
      });
      if (r.ok && r.item && r.item.id != null) {
        // server id 로 localStorage 추가
        const all = DB.get(STORAGE_KEY);
        const row = { ...payload, id: r.item.id, _backend: true,
          date: r.item.created_at ? new Date(r.item.created_at).toLocaleDateString('ko-KR') : new Date().toLocaleDateString('ko-KR') };
        all.unshift(row);
        DB.set(STORAGE_KEY, all);
        window.dispatchEvent(new Event('daemu-db-change'));
      } else {
        // backend 실패 시 localStorage 만 — 다음 hydrate 에서 정정될 수 있음.
        DB.add(STORAGE_KEY, payload);
        if (r.status !== 0) alert('백엔드 동기화 실패 — 임시로 화면에만 저장됨.');
      }
    } else {
      DB.add(STORAGE_KEY, payload);
    }
    if (typeof window.decrementStock === 'function' && qty > 0) {
      const m = /[A-Z][A-Z0-9_-]+-\d{3,}/.exec(String(product || ''));
      if (m) {
        const r = window.decrementStock(m[0], qty, 'order:' + (payload.po_no || ''));
        if (!r.ok && r.error === 'insufficient stock') {
          alert(`재고 부족 (사후 검증) — ${m[0]} 잔여 ${r.current}, 요청 ${r.requested}. 운영자 확인 필요.`);
        }
      }
    }
  }
  resetForm();
  render();
  if (window.siteToast) window.siteToast('저장 완료', { tone: 'success' });
}

async function updateStatus(id, status) {
  const existing = DB.get(STORAGE_KEY).find(x => x.id === id);
  DB.update(STORAGE_KEY, id, { status });
  if (existing && existing._backend && window.daemuMirror) {
    const r = await window.daemuMirror({
      method: 'PATCH',
      endpoint: '/api/orders/' + id,
      body: _toBackendOrderPayload({ ...existing, status }),
    });
    if (!r.ok) alert('백엔드 동기화 실패 — 화면에는 반영했으나 서버에는 저장되지 않았습니다.');
  }
  render();
}
async function del(id) {
  if (!confirmDel()) return;
  const existing = DB.get(STORAGE_KEY).find(x => x.id === id);
  if (existing && existing._backend && window.daemuMirror) {
    const r = await window.daemuMirror({ method: 'DELETE', endpoint: '/api/orders/' + id });
    if (!r.ok) { alert('백엔드 삭제 실패 — 다시 시도해 주세요.'); return; }
  }
  DB.del(STORAGE_KEY, id);
  render();
}

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
      return `<div class="adm-thumb"><img src="${escUrl(a.previewUrl)}" alt=""><button type="button" class="x" onclick="removeOrderAttachment(${i})">×</button></div>`;
    }
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#f6f4f0;border:1px solid #d7d4cf;font-size:12px">📎 ${escHtml(a.filename)} <button type="button" onclick="removeOrderAttachment(${i})" style="background:none;border:none;color:#c0392b;cursor:pointer;font-size:13px">×</button></div>`;
  }).join('');
}

/* Document send (계약서 / 발주서) */
async function sendDoc(id, kind) {
  const d = DB.get(STORAGE_KEY).find(x => x.id === id);
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

// 초기 로드: 동기 render → backend hydrate 끝나면 다시 render.
render();
hydrateFromBackend().then(render);

Object.assign(window, {
  loadPartners, onPickPartner, fmtMoney, filtered, render,
  openAdd, openEdit, resetForm, save, updateStatus, del,
  sendDoc, addOrderAttachments, removeOrderAttachment, renderAttachments,
  hydrateFromBackend,
});
})();
