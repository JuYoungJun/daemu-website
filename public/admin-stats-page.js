(function() {
  'use strict';
// 어드민 통계 페이지 — backend Aiven 의 `/api/admin/stats` 한 번 호출로 KPI 채움.
// localStorage 다중 read 의존 제거 (2026-05). monitoring read 권한 필요 (admin/developer).

const STAGE_LABELS = {lead:"리드", qualified:"검토중", customer:"전환", lost:"이탈"};

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function emptyChart(el) {
  if (el) el.innerHTML = '<p class="adm-empty">데이터가 없습니다.</p>';
}

async function loadStats() {
  const setLoading = (label) => {
    ['s1','s2','s3','s4','m1','m2','m3','m4','p1','p2','p3','p4'].forEach(id => setText(id, label));
  };
  setLoading('…');

  if (!window.api || !window.api.isConfigured || !window.api.isConfigured()) {
    setLoading('-');
    emptyChart(document.getElementById("crm-chart"));
    emptyChart(document.getElementById("inq-chart"));
    emptyChart(document.getElementById("ord-chart"));
    return;
  }

  let counts = {};
  try {
    const r = await window.api.get('/api/admin/stats');
    if (r && r.ok && r.counts) counts = r.counts;
    else throw new Error((r && r.error) || ('HTTP ' + (r && r.status)));
  } catch (err) {
    setLoading('-');
    const errBox = document.getElementById('stats-error');
    if (errBox) errBox.textContent = '통계 로드 실패: ' + (err && err.message ? err.message : err);
    return;
  }

  // 상단 4 박스 — works / inquiries / partners / orders.
  setText('s1', counts.works || 0);
  setText('s2', counts.inquiries || 0);
  setText('s3', counts.partners || 0);
  setText('s4', counts.orders || 0);

  // 마케팅 — CRM 전체 / customer 단계 / 뉴스레터 active / 프로모션 active.
  setText('m1', counts.crm || 0);
  // m2 (CRM customer 단계) 는 backend stats 에 별도로 분리되어 있지 않음 — 어드민 CRM 페이지에서 정확한 분포 확인 가능.
  setText('m2', '—');
  setText('m3', counts.newsletter_active || 0);
  setText('m4', counts.promotions_active || 0);

  // 팝업 — active 개수만 backend 에서 집계. impressions/clicks 는 backend 모델에
  // 컬럼이 없어 운영 단계에서 별도 분석 endpoint 가 필요. demo 단계에서는 0 표시.
  setText('p1', counts.popups_active || 0);
  setText('p2', '—');
  setText('p3', '—');
  setText('p4', '—');

  // CRM / 문의 / 발주 mini chart — backend 가 status 분포까지 반환하지 않으므로
  // 상세 분포는 각 어드민 페이지(/admin/crm, /admin/inquiries, /admin/orders) 에서
  // 확인하도록 안내. 본 페이지는 총 카운트 표시.
  const crmEl = document.getElementById("crm-chart");
  if (crmEl) {
    crmEl.innerHTML = counts.crm
      ? `<div class="adm-mini-chart-item"><b>${counts.crm}</b> 건 — 상세 분포는 <a href="${(window.DAEMU_BASE || '/')}admin/crm">CRM 페이지</a> 참고</div>`
      : '<p class="adm-empty">데이터가 없습니다.</p>';
  }
  const inqEl = document.getElementById("inq-chart");
  if (inqEl) {
    inqEl.innerHTML = counts.inquiries
      ? `<div class="adm-mini-chart-item"><b>${counts.inquiries}</b> 건 — 상세 분포는 <a href="${(window.DAEMU_BASE || '/')}admin/inquiries">문의 페이지</a> 참고</div>`
      : '<p class="adm-empty">데이터가 없습니다.</p>';
  }
  const ordEl = document.getElementById("ord-chart");
  if (ordEl) {
    ordEl.innerHTML = counts.orders
      ? `<div class="adm-mini-chart-item"><b>${counts.orders}</b> 건 — 상세 분포는 <a href="${(window.DAEMU_BASE || '/')}admin/orders">발주 페이지</a> 참고</div>`
      : '<p class="adm-empty">데이터가 없습니다.</p>';
  }

  // Campaign KV — 캠페인 발송 메트릭 (오픈/클릭) 은 backend 에 별도 컬럼 없음.
  // 운영 단계에서 추적 픽셀 / link redirect 로 수집 예정. demo 단계에서는 캠페인 총 수만.
  const cmpKv = document.getElementById("cmp-kv");
  if (cmpKv) {
    cmpKv.innerHTML = `
      <div><b>${counts.campaigns || 0}</b><span>전체 캠페인</span></div>
      <div><b>—</b><span>총 발송 (운영 후)</span></div>
      <div><b>—</b><span>오픈율 (운영 후)</span></div>
      <div><b>—</b><span>클릭률 (운영 후)</span></div>
    `;
  }

  // Revenue KV — 발주 총액 / 출고완료 / 평균 주문가 / CRM 예상 파이프라인.
  // 합계는 backend 에 amount 합산 endpoint 가 별도 추가되기 전까지 단순 카운트만.
  const revKv = document.getElementById("rev-kv");
  if (revKv) {
    revKv.innerHTML = `
      <div><b>${counts.orders || 0}</b><span>전체 발주 건수</span></div>
      <div><b>—</b><span>출고완료 건수 (상세는 발주 페이지)</span></div>
      <div><b>—</b><span>평균 주문가 (운영 후)</span></div>
      <div><b>—</b><span>예상 파이프라인 (운영 후)</span></div>
    `;
  }
}

// 마운트 시점에 호출. 다른 어드민 페이지에서 backend 갱신 후 daemu-db-change
// 이벤트로 다시 로드.
loadStats();
window.addEventListener('daemu-db-change', () => { loadStats(); });

Object.assign(window, { loadStats });
})();
