(function() {
  'use strict';
const STAGE_LABELS = {lead:"리드", qualified:"검토중", customer:"전환", lost:"이탈"};

document.getElementById("s1").textContent = DB.get("projects").length;
document.getElementById("s2").textContent = DB.get("inquiries").length;
document.getElementById("s3").textContent = DB.get("partners").length;
document.getElementById("s4").textContent = DB.get("orders").length;

const crm = DB.get("crm");
document.getElementById("m1").textContent = crm.length;
document.getElementById("m2").textContent = crm.filter(d => d.status === "customer").length;
document.getElementById("m3").textContent = DB.get("subscribers").filter(d => d.status === "활성").length;
document.getElementById("m4").textContent = DB.get("coupons").filter(d => (d.status||"active") === "active").length;

const popups = DB.get("popups");
const popImps = popups.reduce((a,d) => a + (d.impressions||0), 0);
const popClicks = popups.reduce((a,d) => a + (d.clicks||0), 0);
document.getElementById("p1").textContent = popups.filter(d => (d.status||"active") === "active").length;
document.getElementById("p2").textContent = popImps.toLocaleString('ko');
document.getElementById("p3").textContent = popClicks.toLocaleString('ko');
document.getElementById("p4").textContent = (popImps ? Math.round(popClicks/popImps*100) : 0) + "%";

function miniChart(el, data, getStatus) {
  if (!data.length) { el.innerHTML = '<p class="adm-empty">데이터가 없습니다.</p>'; return; }
  const counts = {};
  data.forEach(d => {
    const s = (typeof getStatus === "function") ? getStatus(d) : d.status;
    counts[s] = (counts[s]||0) + 1;
  });
  el.innerHTML = Object.entries(counts).map(([k,v]) =>
    `<div class="adm-mini-chart-item">${badge(k)} <b>${v}</b></div>`
  ).join("");
}

miniChart(document.getElementById("crm-chart"), crm, d => STAGE_LABELS[d.status] || d.status);
miniChart(document.getElementById("inq-chart"), DB.get("inquiries"));
miniChart(document.getElementById("ord-chart"), DB.get("orders"));

/* Campaign KV */
const cmp = DB.get("campaigns");
const sentCmps = cmp.filter(d => d.status === "sent");
const totalSent = sentCmps.reduce((a,d) => a + (d.recipients||0), 0);
const totalOpens = sentCmps.reduce((a,d) => a + (d.opens||0), 0);
const totalClicks = sentCmps.reduce((a,d) => a + (d.clicks||0), 0);
const openRate = totalSent ? Math.round(totalOpens/totalSent*100) : 0;
const ctr = totalOpens ? Math.round(totalClicks/totalOpens*100) : 0;
document.getElementById("cmp-kv").innerHTML = `
  <div><b>${cmp.length}</b><span>전체 캠페인</span></div>
  <div><b>${totalSent.toLocaleString('ko')}</b><span>총 발송</span></div>
  <div><b>${openRate}%</b><span>오픈율</span></div>
  <div><b>${ctr}%</b><span>클릭률</span></div>
`;

/* Revenue KV */
const orders = DB.get("orders");
const revenue = orders.reduce((a,d) => a + (Number(d.qty||0) * Number(d.price||0)), 0);
const completed = orders.filter(d => d.status === "출고완료").length;
const avgOrder = orders.length ? Math.round(revenue/orders.length) : 0;
const expectedDeals = crm.reduce((a,d) => a + Number(d.value||0), 0);
document.getElementById("rev-kv").innerHTML = `
  <div><b>${revenue.toLocaleString('ko')}</b><span>발주 총액 (원)</span></div>
  <div><b>${completed}</b><span>출고완료 건수</span></div>
  <div><b>${avgOrder.toLocaleString('ko')}</b><span>평균 주문가 (원)</span></div>
  <div><b>${expectedDeals.toLocaleString('ko')}</b><span>예상 파이프라인 (원)</span></div>
`;


Object.assign(window, { miniChart });
})();
