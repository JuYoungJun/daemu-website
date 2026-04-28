(function() {
  'use strict';
const KEY = "campaigns";
const SUB_KEY = "subscribers";
let editingId = null;

// 데모 뉴스레터 구독자 시드 제거 — 실제 구독은 Partners/Contact 페이지의 구독 폼에서 들어옵니다.

function onChannel() {
  const ch = document.getElementById("f-channel").value;
  const sw = document.getElementById("f-subject-wrap");
  sw.style.display = (ch === "Email") ? "" : "none";
}

function getRecipients() {
  const grp = document.getElementById("f-source-group").value;
  const stage = document.getElementById("f-seg-stage").value;
  const tagsRaw = document.getElementById("f-seg-tags").value;
  const tags = tagsRaw.split(",").map(t => t.trim()).filter(Boolean);
  let pool = [];
  if (grp === "crm") {
    pool = DB.get("crm").filter(d => !stage || d.status === stage);
    if (tags.length) pool = pool.filter(d => tags.every(t => (d.tags||[]).includes(t)));
  } else if (grp === "newsletter") {
    pool = DB.get(SUB_KEY).filter(d => d.status === "활성");
  } else if (grp === "partners") {
    pool = DB.get("partners").filter(d => (d.active||"active") === "active");
  }
  return pool;
}

function updateRecipients() {
  const list = getRecipients();
  document.getElementById("recipient-summary").textContent = "예상 수신자: " + list.length + "명";
}

function fmtPct(n){ return Math.round(n*100) + "%"; }

function statusLabel(s) {
  return ({draft:"초안",scheduled:"예약",sent:"발송완료"})[s] || s;
}

function filtered() {
  const q = (document.getElementById("q").value || "").toLowerCase();
  const fc = document.getElementById("filter-channel").value;
  const fs = document.getElementById("filter-status").value;
  return DB.get(KEY).filter(d =>
    (!q || (d.title||"").toLowerCase().includes(q)) &&
    (!fc || d.channel === fc) &&
    (!fs || d.status === fs)
  );
}

function renderKPI() {
  const all = DB.get(KEY);
  const sent = all.filter(d => d.status === "sent");
  document.getElementById("k-total").textContent = all.length;
  document.getElementById("k-sent").textContent = sent.length;
  document.getElementById("k-recipients").textContent = sent.reduce((a,d) => a + (d.recipients||0), 0).toLocaleString('ko');
  const openSum = sent.reduce((a,d) => a + (d.opens||0), 0);
  const recSum = sent.reduce((a,d) => a + (d.recipients||0), 0);
  document.getElementById("k-openrate").textContent = recSum ? Math.round(openSum/recSum*100)+"%" : "0%";
}

function render() {
  renderKPI();
  const data = filtered();
  document.getElementById("count").textContent = data.length + "건";
  document.getElementById("list").innerHTML = data.length ? data.map(d => {
    const openTxt = d.status === "sent" ? `${d.opens||0}/${d.clicks||0}` : "-";
    return `<tr>
      <td data-label="제목" style="max-width:280px"><a href="javascript:void(0)" onclick="openEdit(${escAttr(d.id)})" style="color:#111">${escHtml(d.title)}</a></td>
      <td data-label="채널">${escHtml(d.channel)}</td>
      <td data-label="수신자">${(d.recipients||0).toLocaleString('ko')}명</td>
      <td data-label="오픈/클릭">${openTxt}</td>
      <td data-label="발송일">${escHtml(d.sentDate || "-")}</td>
      <td data-label="상태">${badge(statusLabel(d.status))}</td>
      <td data-label="관리" class="col-actions">
        ${d.status !== "sent" ? `<button class="adm-btn-sm" onclick="sendNow(${escAttr(d.id)})">즉시 발송</button>` : ""}
        <button class="adm-btn-sm" onclick="openEdit(${escAttr(d.id)})">${d.status==="sent"?"보기":"수정"}</button>
        <button class="adm-btn-sm danger" onclick="del(${escAttr(d.id)})">삭제</button>
      </td>
    </tr>`;
  }).join("") : '<tr><td colspan="7" class="adm-empty">조건에 맞는 캠페인이 없습니다.</td></tr>';
  renderSubs();
}

function openAdd() {
  editingId = null;
  ["f-title","f-subject","f-body","f-seg-tags"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("f-channel").value = "Email";
  document.getElementById("f-when").value = "draft";
  document.getElementById("f-source-group").value = "crm";
  document.getElementById("f-seg-stage").value = "";
  onChannel();
  updateRecipients();
  document.getElementById("save-btn").textContent = "저장";
  document.getElementById("form-mode").textContent = "신규 작성";
  document.getElementById("form-area").classList.add("show");
}

function openEdit(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  editingId = id;
  document.getElementById("f-title").value = d.title || "";
  document.getElementById("f-channel").value = d.channel || "Email";
  document.getElementById("f-when").value = d.status === "sent" ? "draft" : (d.scheduledFor ? "schedule" : "draft");
  document.getElementById("f-subject").value = d.subject || "";
  document.getElementById("f-body").value = d.body || "";
  document.getElementById("f-source-group").value = d.segGroup || "crm";
  document.getElementById("f-seg-stage").value = d.segStage || "";
  document.getElementById("f-seg-tags").value = (d.segTags||[]).join(", ");
  onChannel();
  updateRecipients();
  document.getElementById("save-btn").textContent = d.status === "sent" ? "닫기" : "수정";
  document.getElementById("form-mode").textContent = (d.status === "sent" ? "보기 모드 · " : "수정 모드 · ") + d.title;
  document.getElementById("form-area").classList.add("show");
  scrollTo({top: document.getElementById("form-area").offsetTop - 40, behavior:"smooth"});
}

function resetForm() {
  document.getElementById("form-area").classList.remove("show");
  editingId = null;
}

function buildPayload() {
  const tags = document.getElementById("f-seg-tags").value.split(",").map(t => t.trim()).filter(Boolean);
  const recipients = getRecipients().length;
  const when = document.getElementById("f-when").value;
  return {
    title: document.getElementById("f-title").value.trim(),
    channel: document.getElementById("f-channel").value,
    subject: document.getElementById("f-subject").value,
    body: document.getElementById("f-body").value,
    segGroup: document.getElementById("f-source-group").value,
    segStage: document.getElementById("f-seg-stage").value,
    segTags: tags,
    recipients,
    when
  };
}

async function save() {
  const p = buildPayload();
  if (!p.title) { alert("제목을 입력하세요"); return; }
  let status = "draft";
  let extra = {};
  if (p.when === "now") {
    status = "sent";
    const result = await dispatchCampaign(p);
    extra = { opens: result.opens, clicks: result.clicks, sentReal: result.real, sentDate: new Date().toLocaleDateString('ko') };
  } else if (p.when === "schedule") {
    status = "scheduled";
    extra.scheduledFor = new Date(Date.now()+24*3600*1000).toLocaleDateString('ko');
  }
  const final = { ...p, status, ...extra };
  if (editingId !== null) DB.update(KEY, editingId, final);
  else DB.add(KEY, final);
  resetForm();
  render();
  if (status === "sent") {
    if (extra.sentReal) alert("발송 완료\n수신자 " + p.recipients + "명에게 실제 발송되었습니다.");
    else alert("발송 시뮬레이션 완료\n수신자 " + p.recipients + "명. (이메일 API 미설정 — 실제 발송하려면 .env에 EmailJS 키 등록)");
  }
}

function mockSendStats(recipients) {
  const opens = Math.floor(recipients * (0.35 + Math.random()*0.25));
  const clicks = Math.floor(opens * (0.18 + Math.random()*0.18));
  return { opens, clicks, real: false };
}

// Real send via EmailJS (or mock if not configured / non-Email channel).
async function dispatchCampaign(p) {
  const list = getRecipients();
  const recipients = list.map(r => ({ email: r.email || '', name: r.name || r.person || r.title || '' })).filter(x => x.email);

  if (window.sendCampaign && window.isEmailEnabled && window.isEmailEnabled() && p.channel === 'Email' && recipients.length) {
    try {
      const res = await window.sendCampaign({ recipients, subject: p.subject, body: p.body, channel: p.channel });
      if (res.ok) {
        // Treat actual sends as opens proxy until real tracking is wired
        return { opens: 0, clicks: 0, real: true, sent: res.sent, failed: res.failed };
      }
    } catch (err) {
      console.error('campaign send failed', err);
    }
  }
  // Fallback to simulated metrics
  return { ...mockSendStats(p.recipients), real: false };
}

async function sendNow(id) {
  const d = DB.get(KEY).find(x => x.id === id);
  if (!d) return;
  if (!confirm("'"+d.title+"' 캠페인을 즉시 발송합니다. 진행할까요?")) return;
  const stats = await dispatchCampaign({
    channel: d.channel,
    subject: d.subject,
    body: d.body,
    recipients: d.recipients || 0,
    segGroup: d.segGroup,
    segStage: d.segStage,
    segTags: d.segTags
  });
  DB.update(KEY, id, { status:"sent", opens: stats.opens, clicks: stats.clicks, sentReal: stats.real, sentDate: new Date().toLocaleDateString('ko') });
  render();
  if (stats.real) alert("발송 완료 (전송 " + (stats.sent||0) + " · 실패 " + (stats.failed||0) + ")");
  else alert("발송 시뮬레이션 완료 (이메일 API 미설정)");
}

function del(id) { if (confirmDel()) { DB.del(KEY, id); render(); } }

/* Newsletter subscribers */
function renderSubs() {
  const q = (document.getElementById("sub-q").value || "").toLowerCase();
  const data = DB.get(SUB_KEY).filter(d => !q || (d.email+" "+(d.name||"")).toLowerCase().includes(q));
  document.getElementById("sub-count").textContent = data.length + "명";
  document.getElementById("sub-list").innerHTML = data.length ? data.map(d =>
    `<tr>
      <td data-label="이메일">${escHtml(d.email)}</td>
      <td data-label="이름">${escHtml(d.name||"-")}</td>
      <td data-label="구독일">${escHtml(d.date)}</td>
      <td data-label="상태">${badge(d.status)}</td>
      <td data-label="관리" class="col-actions">
        <button class="adm-btn-sm" onclick="toggleSub(${escAttr(d.id)})">${d.status==="활성"?"해지":"활성화"}</button>
        <button class="adm-btn-sm danger" onclick="delSub(${escAttr(d.id)})">삭제</button>
      </td>
    </tr>`
  ).join("") : '<tr><td colspan="5" class="adm-empty">구독자가 없습니다.</td></tr>';
}
function addSub() {
  const email = prompt("이메일 주소");
  if (!email) return;
  const name = prompt("이름 (선택)") || "";
  DB.add(SUB_KEY, { email, name, status:"활성" });
  render();
}
function toggleSub(id) {
  const d = DB.get(SUB_KEY).find(x => x.id === id);
  if (!d) return;
  DB.update(SUB_KEY, id, { status: d.status === "활성" ? "해지" : "활성" });
  render();
}
function delSub(id) { if (confirmDel()) { DB.del(SUB_KEY, id); render(); } }

onChannel();
updateRecipients();
render();


Object.assign(window, { onChannel, getRecipients, updateRecipients, fmtPct, statusLabel, filtered, renderKPI, render, openAdd, openEdit, resetForm, buildPayload, save, mockSendStats, sendNow, del, renderSubs, addSub, toggleSub, delSub });
})();
