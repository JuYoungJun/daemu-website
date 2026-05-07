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
  // 파트너 목록은 어드민 partners storeKey 의 hydrate 결과를 우선 사용.
  // 본 페이지(/admin/orders) 가 마운트된 시점에 partners 가 hydrate 안 돼있을
  // 수 있으므로 그 경우 backend 직접 fetch (캐시 갱신).
  const cached = window.daemuRows ? window.daemuRows('partners') : [];
  const fillFromList = (partners) => {
    sel.innerHTML = '<option value="">— 등록된 파트너 선택 —</option>' +
      partners.map(p => `<option value="${p.name || p.company_name || ''}">${p.name || p.company_name || ''} · ${p.role || ''}</option>`).join("");
  };
  if (cached && cached.length) {
    fillFromList(cached);
    return;
  }
  if (window.api && window.api.isConfigured && window.api.isConfigured()) {
    window.api.get('/api/partners?page=1&page_size=500').then(r => {
      if (r && r.ok && Array.isArray(r.items)) {
        const partners = r.items.map(it => ({ name: it.company_name || '', role: it.category || '' }));
        fillFromList(partners);
      } else {
        fillFromList([]);
      }
    }).catch(() => fillFromList([]));
  } else {
    fillFromList([]);
  }
}
function onPickPartner() {
  const v = document.getElementById("f-partner-pick").value;
  if (v) document.getElementById("f-partner").value = v;
}

function fmtMoney(n){ return Number(n||0).toLocaleString('ko'); }

function filtered() {
  const q = (document.getElementById("q").value || "").toLowerCase();
  const fs = document.getElementById("filter-status").value;
  return (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).filter(d =>
    (!q || (d.partner+" "+d.product).toLowerCase().includes(q)) &&
    (!fs || d.status === fs)
  );
}

function render() {
  const all = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []);
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
  const d = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === id);
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
  // 정책: backend (Aiven MySQL) 가 source of truth. backend 가 OK 일 때만
  // localStorage 미러 갱신. 실패 시 fake-success / 캐시 잔재 만들지 않음.
  if (editingId !== null) {
    const existing = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === editingId);
    if (!window.daemuMirror) {
      alert('백엔드 미연결 — 저장할 수 없습니다.');
      return;
    }
    const r = await window.daemuMirror({
      method: 'PATCH',
      endpoint: '/api/orders/' + editingId,
      body: _toBackendOrderPayload({ ...(existing || {}), ...payload }),
      refetchKey: STORAGE_KEY,
    });
    if (!r.ok) {
      alert('서버 저장에 실패했습니다. 잠시 후 다시 시도해 주세요. (' + (r.error || ('HTTP ' + (r.status || 0))) + ')');
      return;
    }
    // backend = source of truth — auto-refetch 가 store 갱신 완료. 추가 mirror 불필요.
  } else {
    // 신규 발주 — PO 번호 자동 생성 + 입력된 SKU 가 카탈로그에 있으면 재고 차감.
    if (typeof window.nextPoNumber === 'function') {
      payload.po_no = window.nextPoNumber();
    }
    // product 값에 SKU 형태(예: BAKERY-001) 가 들어있으면 재고 검증 + 차감.
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
    if (!window.daemuMirror) {
      alert('백엔드 미연결 — 저장할 수 없습니다.');
      return;
    }
    const r = await window.daemuMirror({
      method: 'POST',
      endpoint: '/api/orders',
      body: _toBackendOrderPayload(payload),
      refetchKey: STORAGE_KEY,
    });
    if (!r.ok || !r.item || r.item.id == null) {
      alert('서버 저장에 실패했습니다. 잠시 후 다시 시도해 주세요. (' + (r.error || ('HTTP ' + (r.status || 0))) + ')');
      return;
    }
    // backend = source of truth — auto-refetch 가 store 갱신 완료. 화면 즉시 갱신용 dispatch 만.
    try { window.dispatchEvent(new Event('daemu-db-change')); } catch (_) { /* ignore */ }
    if (typeof window.decrementStock === 'function' && qty > 0) {
      const m = /[A-Z][A-Z0-9_-]+-\d{3,}/.exec(String(product || ''));
      if (m) {
        const sr = window.decrementStock(m[0], qty, 'order:' + (payload.po_no || ''));
        if (!sr.ok && sr.error === 'insufficient stock') {
          alert(`재고 부족 (사후 검증) — ${m[0]} 잔여 ${sr.current}, 요청 ${sr.requested}. 운영자 확인 필요.`);
        }
      }
    }
  }
  resetForm();
  render();
  if (window.siteToast) window.siteToast('저장 완료', { tone: 'success' });
}

async function updateStatus(id, status) {
  const existing = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === id);
  if (existing && existing._backend) {
    if (!window.daemuMirror) {
      alert('백엔드 미연결 — 상태 변경할 수 없습니다.');
      return;
    }
    const r = await window.daemuMirror({
      method: 'PATCH',
      endpoint: '/api/orders/' + id,
      body: _toBackendOrderPayload({ ...existing, status }),
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
    const r = await window.daemuMirror({ method: 'DELETE', endpoint: '/api/orders/' + id, refetchKey: STORAGE_KEY });
    if (!r.ok) { alert('백엔드 삭제 실패 — 다시 시도해 주세요.'); return; }
  }
  // backend = source of truth — auto-refetch 가 store 갱신 완료.
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
  const d = (window.daemuRows ? window.daemuRows(STORAGE_KEY) : []).find(x => x.id === id);
  if (!d) return;
  // 파트너 이메일 조회 — partners store(=Aiven) 우선, 없으면 backend 직접 fetch.
  const cachedPartners = window.daemuRows ? window.daemuRows('partners') : [];
  let partner = cachedPartners.find(p => (p.name || p.company_name) === d.partner);
  if (!partner && window.api && window.api.isConfigured && window.api.isConfigured()) {
    const pr = await window.api.get('/api/partners?page=1&page_size=500');
    if (pr && pr.ok && Array.isArray(pr.items)) {
      partner = pr.items.map(it => ({
        name: it.company_name || '', email: it.email || '',
        person: it.contact_name || '',
      })).find(p => p.name === d.partner);
    }
  }
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

// daemu-db-change 이벤트 listener — admin-hydrate-helper 의 자동 refetch 가
// store 를 갱신하면 즉시 재렌더. 다른 탭/다른 디바이스의 변경(60s 폴링 또는
// 탭 복귀 트리거) 도 같은 경로로 화면에 반영. 한 번만 등록되도록 guard.
if (!window.__daemuOrdersListenerAttached) {
  window.__daemuOrdersListenerAttached = true;
  window.addEventListener('daemu-db-change', () => {
    try { render(); } catch (_) { /* ignore */ }
  });
}

Object.assign(window, {
  loadPartners, onPickPartner, fmtMoney, filtered, render,
  openAdd, openEdit, resetForm, save, updateStatus, del,
  sendDoc, addOrderAttachments, removeOrderAttachment, renderAttachments,
  hydrateFromBackend,
});
})();
