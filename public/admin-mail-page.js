(function() {
  'use strict';

  const VARS = ['name', 'category', 'message', 'phone', 'email'];

  const defaults = {
    subject: "[대무] 문의가 접수되었습니다",
    body: "{{name}} 님,\n\n대무에 문의해 주셔서 감사합니다.\n아래 내용으로 접수되었으며, 1-2 영업일 내 담당자가 회신드리겠습니다.\n\n─ 카테고리: {{category}}\n─ 문의 내용:\n{{message}}\n\n감사합니다.\n대무 (DAEMU)\n061-335-1239\ndaemu_office@naver.com",
    active: "on",
    category: "all"
  };

  let attachments = []; // [{ filename, content (base64) }]

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // text → contenteditable HTML with locked tokens for {{var}}
  function renderBody(text) {
    const ed = document.getElementById('m-body');
    if (!ed) return;
    ed.innerHTML = '';
    const parts = String(text || '').split(/(\{\{\s*[\w-]+\s*\}\})/g);
    parts.forEach(part => {
      const m = part.match(/^\{\{\s*([\w-]+)\s*\}\}$/);
      if (m) {
        ed.appendChild(makeToken(m[1]));
      } else {
        // Preserve newlines as <br>
        const lines = part.split('\n');
        lines.forEach((line, i) => {
          if (i > 0) ed.appendChild(document.createElement('br'));
          if (line) ed.appendChild(document.createTextNode(line));
        });
      }
    });
    // Add a trailing space text node so cursor can land after the last token
    ed.appendChild(document.createTextNode(''));
  }

  function makeToken(name) {
    const span = document.createElement('span');
    span.className = 'adm-var-token';
    span.contentEditable = 'false';
    span.dataset.var = name;
    span.textContent = '{{' + name + '}}';

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    x.textContent = '×';
    x.title = '제거';
    x.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      span.remove();
      updatePreview();
    });
    span.appendChild(x);
    return span;
  }

  // contenteditable HTML → plain text with {{var}} tokens
  function readBody() {
    const ed = document.getElementById('m-body');
    if (!ed) return '';
    let out = '';
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.nodeValue;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.classList && node.classList.contains('adm-var-token')) {
          out += '{{' + node.dataset.var + '}}';
        } else if (node.tagName === 'BR') {
          out += '\n';
        } else if (node.tagName === 'DIV' || node.tagName === 'P') {
          // Browsers wrap new lines in <div>/<p> in contenteditable
          if (out && !out.endsWith('\n')) out += '\n';
          node.childNodes.forEach(walk);
        } else {
          node.childNodes.forEach(walk);
        }
      }
    }
    ed.childNodes.forEach(walk);
    return out;
  }

  function load() {
    const d = JSON.parse(localStorage.getItem("daemu_mail") || "null") || defaults;
    document.getElementById("m-subject").value = d.subject;
    renderBody(d.body || '');
    document.getElementById("m-active").value = d.active;
    document.getElementById("m-category").value = d.category;
    updatePreview();
    renderAttachments();
  }

  function updatePreview() {
    const el = document.getElementById('m-preview');
    if (!el) return;
    const subject = document.getElementById('m-subject').value;
    const body = readBody();
    el.textContent = '제목: ' + subject + '\n\n' + body;
  }

  function saveMail() {
    const subject = document.getElementById('m-subject').value;
    const body = readBody();
    const active = document.getElementById('m-active').value;
    const category = document.getElementById('m-category').value;
    localStorage.setItem('daemu_mail', JSON.stringify({ subject, body, active, category }));
    alert('저장되었습니다.\n이후 신규 문의 발송부터 새 템플릿이 적용됩니다.');
  }

  function resetMail() {
    if (!confirm('초기 템플릿으로 되돌리시겠습니까?')) return;
    localStorage.removeItem('daemu_mail');
    load();
    alert('초기화되었습니다.');
  }

  // Insert {{var}} token at current caret position
  function insertVar(name) {
    if (!VARS.includes(name)) return;
    const ed = document.getElementById('m-body');
    if (!ed) return;
    ed.focus();
    const sel = window.getSelection();
    const token = makeToken(name);
    if (sel && sel.rangeCount && ed.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(token);
      // place caret after inserted token
      range.setStartAfter(token);
      range.setEndAfter(token);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      ed.appendChild(token);
    }
    updatePreview();
  }

  // Image attachments — optimize then read base64
  async function addAttachments(files) {
    for (const file of Array.from(files)) {
      try {
        const optimized = await window.uploadImage(file); // optimizes + returns base64 url
        // optimized.url is "data:image/jpeg;base64,..."
        const dataUrl = optimized.url;
        const base64 = dataUrl.split(',')[1] || '';
        attachments.push({
          filename: optimized.name || file.name,
          content: base64,
          previewUrl: dataUrl
        });
      } catch (err) {
        alert('첨부 실패: ' + (err && err.message ? err.message : err));
      }
    }
    document.getElementById('m-files').value = '';
    renderAttachments();
  }

  function removeAttachment(i) {
    attachments.splice(i, 1);
    renderAttachments();
  }

  function renderAttachments() {
    const wrap = document.getElementById('m-attach-thumbs');
    if (!wrap) return;
    wrap.innerHTML = attachments.map((a, i) =>
      `<div class="adm-thumb"><img src="${a.previewUrl}" alt=""><button type="button" class="x" onclick="removeAttachment(${i})">×</button></div>`
    ).join('');
  }

  async function testSend() {
    const to = prompt('테스트 발송 받을 이메일 주소 (Resend 계정 등록 이메일 권장):');
    if (!to) return;
    if (!window.isEmailEnabled || !window.isEmailEnabled()) {
      alert('백엔드 API가 연결되지 않은 데모 환경입니다.\n발송이 시뮬레이션되어 /admin/outbox에 기록됩니다.');
    }
    // Save current edits so sendAutoReply picks up latest values
    const subject = document.getElementById('m-subject').value;
    const body = readBody();
    const active = document.getElementById('m-active').value;
    const category = document.getElementById('m-category').value;
    localStorage.setItem('daemu_mail', JSON.stringify({ subject, body, active: 'on', category }));

    // For test send, we directly call api.post via window.sendAutoReply,
    // but auto-reply doesn't currently take attachments. Use sendAdminReply for attachments.
    const hasAttachments = attachments.length > 0;
    let r;
    if (hasAttachments && window.sendAdminReplyWithAttachments) {
      r = await window.sendAdminReplyWithAttachments({
        to_email: to,
        to_name: '테스트 수신자',
        subject: subject,
        body: applyVars(body, {
          name: '테스트 수신자',
          category: '테스트 카테고리',
          message: '테스트 발송입니다.',
          phone: '010-0000-0000',
          email: to
        }),
        attachments
      });
    } else {
      r = await window.sendAutoReply({
        to_email: to,
        to_name: '테스트 수신자',
        category: '테스트 카테고리',
        message: '테스트 발송입니다. 변수 {{message}}는 이렇게 들어갑니다.',
        phone: '010-0000-0000',
        email: to
      });
    }
    if (r.ok) {
      alert('테스트 메일 발송 완료\n수신함을 확인해주세요.');
    } else if (r.simulated) {
      alert('이메일 API 미설정 — 시뮬레이션만 실행됨.');
    } else {
      alert('발송 실패: ' + (r.error || r.reason || ''));
    }
  }

  function applyVars(text, vars) {
    if (!text) return '';
    return String(text).replace(/\{\{\s*([\w-]+)\s*\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
  }

  // Live preview (subject + body)
  document.addEventListener('input', (e) => {
    if (!e.target) return;
    if (e.target.id === 'm-subject') updatePreview();
    if (e.target.id === 'm-body') updatePreview();
  });

  // Block typing inside locked tokens
  document.addEventListener('beforeinput', (e) => {
    const ed = document.getElementById('m-body');
    if (!ed || !ed.contains(e.target)) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const inToken = (n) => {
      while (n && n !== ed) {
        if (n.classList && n.classList.contains('adm-var-token')) return true;
        n = n.parentNode;
      }
      return false;
    };
    if (inToken(range.startContainer) || inToken(range.endContainer)) {
      e.preventDefault();
    }
  });

  load();

  Object.assign(window, {
    load, saveMail, resetMail, testSend, insertVar,
    addAttachments, removeAttachment, updatePreview
  });
})();
