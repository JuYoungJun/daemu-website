(function() {
  'use strict';
const KEY = "coupons";
const EV_KEY = "events";
let editingId = null;
let evEditingId = null;

function statusLabel(s) { return ({active:"활성",paused:"일시중지",expired:"만료"})[s] || s; }
function typeLabel(t) { return ({percent:"정률",amount:"정액",bogo:"1+1"})[t] || t; }
function onType() { /* placeholder for dynamic UI per type */ }

function fmtMoney(n){ return Number(n||0).toLocaleString('ko'); }
function isExpiredByDate(c) {
  if (!c.to) return false;
  return new Date(c.to) < new Date(new Date().toDateString());
}
function effectiveStatus(c) {
  if (c.status === "expired") return "expired";
  if (isExpiredByDate(c)) return "expired";
  return c.status || "active";
}

function filtered() {
  const q = (document.getElementById("q").value || "").toLowerCase();
  const fs = document.getElementById("filter-status").value;
  return DB.get(KEY).filter(d =>
    (!q || (d.code+" "+(d.desc||"")).toLowerCase().includes(q)) &&
    (!fs || effectiveStatus(d) === fs)
  );
}

function renderKPI() {
  const all = DB.get(KEY);
  document.getElementById("k-active").textContent = all.filter(d => effectiveStatus(d) === "active").length;
  document.getElementById("k-uses").textContent = all.reduce((a,d) => a + (d.uses||0), 0);
  document.getElementById("k-events").textContent = DB.get(EV_KEY).length;
  const totalDiscount = all.reduce((a,d) => {
    if (d.type === "amount") return a + (Number(d.value||0) * Number(d.uses||0));
    return a;
  }, 0);
  document.getElementById("k-discount").textContent = fmtMoney(totalDiscount);
}

function render() {
  renderKPI();
  const data = filtered();
  document.getElementById("count").textContent = data.length + "건";
  document.getElementById("list").innerHTML = data.length ? data.map(d => {
    const eff = effectiveStatus(d);
    const period = (d.from || "—") + " ~ " + (d.to || "무제한");
    const value = d.type === "percent" ? (d.value+"%") : (d.type === "amount" ? fmtMoney(d.value)+"원" : "1+1");
    const usage = (d.uses||0) + "/" + (d.max||"∞");
    return `<tr>
      <td data-label="코드"><b style="font-family:'Cormorant Garamond',serif;font-style:italic;font-size:18px">${escHtml(d.code)}</b><div style="font-size:11px;color:#8c867d">${escHtml(d.desc||"")}</div></td>
      <td data-label="유형">${typeLabel(d.type)}</td>
      <td data-label="값">${value}</td>
      <td data-label="유효기간" style="font-size:11px;color:#6f6b68">${escHtml(period)}</td>
      <td data-label="사용">${usage}</td>
      <td data-label="상태">${badge(statusLabel(eff))}</td>
      <td data-label="관리" class="col-actions">
        <button class="adm-btn-sm" onclick="bumpUse(${escAttr(d.id)})">+1 사용</button>
        <button class="adm-btn-sm" onclick="openEdit(${escAttr(d.id)})">수정</button>
        <button class="adm-btn-sm danger" onclick="del(${escAttr(d.id)})">삭제</button>
      </td>
    </tr>`;
  }).join("") : '<tr><td colspan="7" class="adm-empty">조건에 맞는 쿠폰이 없습니다.</td></tr>';
  renderEvents();
}

function openAdd() {
  editingId = null;
  ["f-code","f-desc","f-value","f-from","f-to","f-max","f-note"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("f-type").value = "percent";
  document.getElementById("f-status").value = "active";
  document.getElementById("save-btn").textContent = "저장";
  document.getElementById("form-mode").textContent = "신규 발급";
  document.getElementById("form-area").classList.add("show");
}

function openEdit(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  editingId = id;
  document.getElementById("f-code").value = d.code || "";
  document.getElementById("f-desc").value = d.desc || "";
  document.getElementById("f-type").value = d.type || "percent";
  document.getElementById("f-value").value = d.value || "";
  document.getElementById("f-from").value = d.from || "";
  document.getElementById("f-to").value = d.to || "";
  document.getElementById("f-max").value = d.max || "";
  document.getElementById("f-status").value = d.status || "active";
  document.getElementById("f-note").value = d.note || "";
  document.getElementById("save-btn").textContent = "수정";
  document.getElementById("form-mode").textContent = "수정 모드 · " + d.code;
  document.getElementById("form-area").classList.add("show");
  scrollTo({top: document.getElementById("form-area").offsetTop - 40, behavior:"smooth"});
}

function resetForm() {
  document.getElementById("form-area").classList.remove("show");
  editingId = null;
}

function save() {
  const code = document.getElementById("f-code").value.trim().toUpperCase();
  if (!code) { alert("쿠폰 코드를 입력하세요"); return; }
  const dup = DB.get(KEY).find(d => d.code === code && d.id !== editingId);
  if (dup) { alert("이미 사용 중인 코드입니다."); return; }
  const payload = {
    code,
    desc: document.getElementById("f-desc").value,
    type: document.getElementById("f-type").value,
    value: document.getElementById("f-value").value,
    from: document.getElementById("f-from").value,
    to: document.getElementById("f-to").value,
    max: document.getElementById("f-max").value,
    status: document.getElementById("f-status").value,
    note: document.getElementById("f-note").value
  };
  if (editingId !== null) {
    DB.update(KEY, editingId, payload);
  } else {
    DB.add(KEY, { ...payload, uses: 0 });
  }
  resetForm();
  render();
}

function bumpUse(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  if (d.max && Number(d.uses||0) >= Number(d.max)) { alert("최대 사용 횟수에 도달했습니다."); return; }
  DB.update(KEY, id, { uses: Number(d.uses||0) + 1 });
  render();
}

function del(id) { if (confirmDel()) { DB.del(KEY, id); render(); } }

/* Events / Notices */
function renderEvents() {
  const data = DB.get(EV_KEY);
  document.getElementById("ev-list").innerHTML = data.length ? data.map(d =>
    `<tr>
      <td data-label="제목" style="max-width:280px">${escHtml(d.title)}</td>
      <td data-label="구분">${escHtml(d.type)}</td>
      <td data-label="기간" style="font-size:11px;color:#6f6b68">${escHtml(d.period||"-")}</td>
      <td data-label="등록일">${escHtml(d.date)}</td>
      <td data-label="상태">${badge(d.status === "active" ? "게시" : "숨김")}</td>
      <td data-label="관리" class="col-actions">
        <button class="adm-btn-sm" onclick="evToggle(${escAttr(d.id)})">${d.status==="active"?"숨김":"게시"}</button>
        <button class="adm-btn-sm" onclick="evEdit(${escAttr(d.id)})">수정</button>
        <button class="adm-btn-sm danger" onclick="evDel(${escAttr(d.id)})">삭제</button>
      </td>
    </tr>`
  ).join("") : '<tr><td colspan="6" class="adm-empty">등록된 이벤트가 없습니다.</td></tr>';
}
function openEvAdd() {
  evEditingId = null;
  ["ef-title","ef-period","ef-body"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("ef-type").value = "이벤트";
  document.getElementById("ef-status").value = "active";
  document.getElementById("ev-save-btn").textContent = "저장";
  document.getElementById("ev-form-mode").textContent = "신규 등록";
  document.getElementById("ev-form-area").classList.add("show");
}
function evEdit(id) {
  const d = DB.get(EV_KEY).find(x => x.id === id);
  if (!d) return;
  evEditingId = id;
  document.getElementById("ef-title").value = d.title || "";
  document.getElementById("ef-type").value = d.type || "이벤트";
  document.getElementById("ef-period").value = d.period || "";
  document.getElementById("ef-body").value = d.body || "";
  document.getElementById("ef-status").value = d.status || "active";
  document.getElementById("ev-save-btn").textContent = "수정";
  document.getElementById("ev-form-mode").textContent = "수정 모드";
  document.getElementById("ev-form-area").classList.add("show");
}
function evReset() {
  document.getElementById("ev-form-area").classList.remove("show");
  evEditingId = null;
}
function evSave() {
  const title = document.getElementById("ef-title").value.trim();
  if (!title) { alert("제목을 입력하세요"); return; }
  const payload = {
    title,
    type: document.getElementById("ef-type").value,
    period: document.getElementById("ef-period").value,
    body: document.getElementById("ef-body").value,
    status: document.getElementById("ef-status").value
  };
  if (evEditingId !== null) DB.update(EV_KEY, evEditingId, payload);
  else DB.add(EV_KEY, payload);
  evReset();
  render();
}
function evToggle(id) {
  const d = DB.get(EV_KEY).find(x => x.id === id);
  if (!d) return;
  DB.update(EV_KEY, id, { status: d.status === "active" ? "hidden" : "active" });
  render();
}
function evDel(id) { if (confirmDel()) { DB.del(EV_KEY, id); render(); } }

render();


Object.assign(window, { statusLabel, typeLabel, onType, fmtMoney, isExpiredByDate, effectiveStatus, filtered, renderKPI, render, openAdd, openEdit, resetForm, save, bumpUse, del, renderEvents, openEvAdd, evEdit, evReset, evSave, evToggle, evDel });
})();
