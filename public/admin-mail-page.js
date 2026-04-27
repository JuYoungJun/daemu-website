(function() {
  'use strict';
  const defaults = {
    subject: "[대무] 문의가 접수되었습니다",
    body: "{{name}} 님,\n\n대무에 문의해 주셔서 감사합니다.\n아래 내용으로 접수되었으며, 1-2 영업일 내 담당자가 회신드리겠습니다.\n\n─ 카테고리: {{category}}\n─ 문의 내용:\n{{message}}\n\n감사합니다.\n대무 (DAEMU)\n061-335-1239\ndaemu_office@naver.com",
    active: "on",
    category: "all"
  };

  function load() {
    const d = JSON.parse(localStorage.getItem("daemu_mail") || "null") || defaults;
    document.getElementById("m-subject").value = d.subject;
    document.getElementById("m-body").value = d.body;
    document.getElementById("m-active").value = d.active;
    document.getElementById("m-category").value = d.category;
    updatePreview();
  }

  function updatePreview() {
    const el = document.getElementById("m-preview");
    if (!el) return;
    const subject = document.getElementById("m-subject").value;
    const body = document.getElementById("m-body").value;
    el.textContent = '제목: ' + subject + '\n\n' + body;
  }

  function saveMail() {
    localStorage.setItem("daemu_mail", JSON.stringify({
      subject: document.getElementById("m-subject").value,
      body: document.getElementById("m-body").value,
      active: document.getElementById("m-active").value,
      category: document.getElementById("m-category").value,
    }));
    alert("저장되었습니다.\n이후 신규 문의 발송부터 새 템플릿이 적용됩니다.");
  }

  function resetMail() {
    if (!confirm('초기 템플릿으로 되돌리시겠습니까?')) return;
    localStorage.removeItem("daemu_mail");
    load();
    alert("초기화되었습니다.");
  }

  async function testSend() {
    const to = prompt('테스트 발송 받을 이메일 주소를 입력하세요:');
    if (!to) return;
    if (!window.isEmailEnabled || !window.isEmailEnabled()) {
      alert('백엔드 API가 연결되지 않은 데모 환경입니다.\n발송이 시뮬레이션되어 /admin/outbox에 기록됩니다.');
    }
    saveMail.silent = true; // mark
    // Save current edits temporarily so sendAutoReply picks them up
    localStorage.setItem("daemu_mail", JSON.stringify({
      subject: document.getElementById("m-subject").value,
      body: document.getElementById("m-body").value,
      active: 'on',
      category: document.getElementById("m-category").value
    }));
    const r = await window.sendAutoReply({
      to_email: to,
      to_name: '테스트 수신자',
      category: '테스트 카테고리',
      message: '테스트 발송입니다. 이 메시지는 변수 {{message}}에 들어갑니다.',
      phone: '010-0000-0000',
      email: to
    });
    if (r.ok) {
      alert('테스트 메일 발송 완료\n수신함을 확인해주세요.');
    } else if (r.simulated) {
      alert('이메일 API 미설정 — 시뮬레이션만 실행됨.');
    } else {
      alert('발송 실패: ' + (r.error || r.reason));
    }
  }

  // Live preview
  ['m-subject', 'm-body'].forEach((id) => {
    document.addEventListener('input', (e) => {
      if (e.target && e.target.id === id) updatePreview();
    });
  });

  load();

  Object.assign(window, { load, saveMail, resetMail, testSend, updatePreview });
})();
