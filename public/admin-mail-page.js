(function() {
  'use strict';

  const VARS = ['name', 'category', 'message', 'phone', 'email'];

  const defaults = {
    subject: "[대무] 문의가 접수되었습니다",
    body: "{{name}} 님,\n\n대무에 문의해 주셔서 감사합니다.\n아래 내용으로 접수되었으며, 1-2 영업일 내 담당자가 회신드리겠습니다.\n\n─ 카테고리: {{category}}\n─ 문의 내용:\n{{message}}\n\n감사합니다.\n대무 (DAEMU)\n061-335-1239\ndaemu_office@naver.com",
    active: "on",
    category: "all",
    images: []
  };

  // images: [{ contentId, filename, content (base64), previewUrl (data:url) }]
  let imagesCache = [];

  function escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function newCid() {
    return 'cid' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function findImage(cid) {
    return imagesCache.find((i) => i.contentId === cid);
  }

  // text → contenteditable HTML with locked tokens for {{var}} and visual <img> for [[img:cid]]
  function renderBody(text) {
    const ed = document.getElementById('m-body');
    if (!ed) return;
    ed.innerHTML = '';
    const parts = String(text || '').split(/(\{\{\s*[\w-]+\s*\}\}|\[\[img:[\w-]+\]\])/g);
    parts.forEach(part => {
      const varM = part.match(/^\{\{\s*([\w-]+)\s*\}\}$/);
      const imgM = part.match(/^\[\[img:([\w-]+)\]\]$/);
      if (varM) {
        ed.appendChild(makeVarToken(varM[1]));
      } else if (imgM) {
        const img = findImage(imgM[1]);
        if (img) ed.appendChild(makeImgToken(img));
      } else {
        const lines = part.split('\n');
        lines.forEach((line, i) => {
          if (i > 0) ed.appendChild(document.createElement('br'));
          if (line) ed.appendChild(document.createTextNode(line));
        });
      }
    });
    ed.appendChild(document.createTextNode(''));
  }

  function makeVarToken(name) {
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
    x.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); span.remove(); updatePreview(); });
    span.appendChild(x);
    return span;
  }

  function makeImgToken(img) {
    const wrap = document.createElement('span');
    wrap.className = 'adm-mail-imgtoken';
    wrap.contentEditable = 'false';
    wrap.dataset.cid = img.contentId;
    const im = document.createElement('img');
    im.src = img.previewUrl;
    im.alt = img.filename || '';
    wrap.appendChild(im);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    x.textContent = '×';
    x.title = '이미지 제거';
    x.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      // also remove from cache
      const i = imagesCache.findIndex(im => im.contentId === img.contentId);
      if (i >= 0) imagesCache.splice(i, 1);
      wrap.remove();
      updatePreview();
    });
    wrap.appendChild(x);
    return wrap;
  }

  // Read DOM → serialize back to text with {{var}} and [[img:cid]] markers
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
        } else if (node.classList && node.classList.contains('adm-mail-imgtoken')) {
          out += '[[img:' + node.dataset.cid + ']]';
        } else if (node.tagName === 'BR') {
          out += '\n';
        } else if (node.tagName === 'DIV' || node.tagName === 'P') {
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
    imagesCache = (d.images || []).map(im => ({
      contentId: im.contentId,
      filename: im.filename,
      url: im.url || im.previewUrl || '',
      previewUrl: im.previewUrl || im.url || ''
    }));
    renderBody(d.body || '');
    document.getElementById("m-active").value = d.active;
    document.getElementById("m-category").value = d.category;
    updatePreview();
  }

  // Update HTML preview iframe
  function updatePreview() {
    const iframe = document.getElementById('m-preview');
    if (!iframe) return;
    const subject = document.getElementById('m-subject').value;
    const body = readBody();
    const html = renderHtmlPreview(subject, body);
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  }

  function renderHtmlPreview(subject, body) {
    const parts = String(body || '').split(/(\[\[img:[\w-]+\]\])/g);
    let inner = '';
    parts.forEach((part) => {
      const m = part.match(/^\[\[img:([\w-]+)\]\]$/);
      if (m) {
        const img = findImage(m[1]);
        if (img) {
          // Use data URL for preview (cid:xx wouldn't load in iframe)
          // previewUrl is the data:image/...;base64,... we generated from
          // the admin's local file pick. Allow data:image/ specifically;
          // attribute-escape so a malformed URL can't break out of src="".
          const raw = String(img.previewUrl || '');
          const safeSrc = /^data:image\//i.test(raw) || /^https?:\/\//i.test(raw)
            ? raw.replace(/"/g, '&quot;').replace(/</g, '&lt;')
            : '';
          if (safeSrc) {
            inner += `<div style="margin:14px 0"><img src="${safeSrc}" alt="${escapeHtml(img.filename || '')}" style="max-width:100%;height:auto;display:block"></div>`;
          }
        }
      } else {
        inner += escapeHtml(part).replace(/\r?\n/g, '<br>');
      }
    });
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#f6f4f0;font-family:'Noto Sans KR','Apple SD Gothic Neo',sans-serif;color:#222;line-height:1.7">
<div style="padding:14px 18px;background:#fff;border-bottom:1px solid #e6e3dd;font-size:13px"><strong>제목:</strong> ${escapeHtml(subject)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f6f4f0">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#fff;border:1px solid #d7d4cf">
    <tr><td style="padding:32px 28px;font-size:14px;line-height:1.7;color:#222">${inner}</td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #e6e3dd;font-size:11px;letter-spacing:.06em;color:#8c867d">
      <strong style="color:#111">대무 (DAEMU)</strong> · 061-335-1239 · daemu_office@naver.com
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
  }

  function saveMail() {
    const subject = document.getElementById('m-subject').value;
    const body = readBody();
    const active = document.getElementById('m-active').value;
    const category = document.getElementById('m-category').value;
    const referenced = new Set();
    body.replace(/\[\[img:([\w-]+)\]\]/g, (_, cid) => { referenced.add(cid); return ''; });
    const images = imagesCache
      .filter((i) => referenced.has(i.contentId))
      .map((i) => ({ contentId: i.contentId, filename: i.filename, url: i.url, previewUrl: i.previewUrl }));
    localStorage.setItem('daemu_mail', JSON.stringify({ subject, body, active, category, images }));
    alert('저장되었습니다.\n이후 신규 문의 발송부터 새 템플릿이 적용됩니다.');
  }

  function resetMail() {
    if (!confirm('초기 템플릿으로 되돌리시겠습니까?')) return;
    localStorage.removeItem('daemu_mail');
    imagesCache = [];
    load();
    alert('초기화되었습니다.');
  }

  function insertVar(name) {
    if (!VARS.includes(name)) return;
    const ed = document.getElementById('m-body');
    if (!ed) return;
    ed.focus();
    insertNodeAtCaret(makeVarToken(name));
    updatePreview();
  }

  async function insertInlineImage(files) {
    if (!files || !files[0]) return;
    try {
      const optimized = await window.uploadImage(files[0]);
      // optimized.url is publicUrl when backend uploaded, else data URL
      const img = {
        contentId: newCid(),
        filename: optimized.name || files[0].name,
        url: optimized.publicUrl || optimized.url,    // public URL preferred for email
        previewUrl: optimized.previewUrl || optimized.url
      };
      imagesCache.push(img);
      const ed = document.getElementById('m-body');
      ed.focus();
      insertNodeAtCaret(makeImgToken(img));
      updatePreview();
      if (!optimized.publicUrl) {
        if (window.siteToast) window.siteToast('백엔드 미연결 — 이미지가 data URL로 임베드됩니다 (Gmail에선 차단될 수 있음). 백엔드 연결 시 자동으로 공개 URL 사용.', { tone: 'warn', duration: 4500 });
      }
    } catch (err) {
      alert('이미지 삽입 실패: ' + (err && err.message ? err.message : err));
    }
    document.getElementById('m-inline-img').value = '';
  }

  function insertNodeAtCaret(node) {
    const ed = document.getElementById('m-body');
    const sel = window.getSelection();
    if (sel && sel.rangeCount && ed.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      ed.appendChild(node);
    }
  }

  async function testSend() {
    const to = prompt('테스트 발송 받을 이메일 주소 (Resend 계정 등록 이메일 권장):');
    if (!to) return;
    if (!window.isEmailEnabled || !window.isEmailEnabled()) {
      alert('백엔드 API가 연결되지 않은 데모 환경입니다.\n발송이 시뮬레이션되어 /admin/outbox에 기록됩니다.');
    }
    // Save current edits so sendAutoReply picks up latest values
    saveMailSilent();
    const r = await window.sendAutoReply({
      to_email: to,
      to_name: '테스트 수신자',
      category: '테스트 카테고리',
      message: '테스트 발송입니다. 변수 {{message}}는 이렇게 들어갑니다.',
      phone: '010-0000-0000',
      email: to
    });
    if (r.ok) alert('테스트 메일 발송 완료\n수신함을 확인해주세요.');
    else if (r.simulated) alert('이메일 API 미설정 — 시뮬레이션만 실행됨.');
    else alert('발송 실패: ' + (r.error || r.reason || ''));
  }

  function saveMailSilent() {
    const subject = document.getElementById('m-subject').value;
    const body = readBody();
    const active = document.getElementById('m-active').value;
    const category = document.getElementById('m-category').value;
    const referenced = new Set();
    body.replace(/\[\[img:([\w-]+)\]\]/g, (_, cid) => { referenced.add(cid); return ''; });
    const images = imagesCache.filter((i) => referenced.has(i.contentId))
      .map((i) => ({ contentId: i.contentId, filename: i.filename, url: i.url, previewUrl: i.previewUrl }));
    localStorage.setItem('daemu_mail', JSON.stringify({ subject, body, active: 'on', category, images }));
  }

  // Live preview (subject + body)
  document.addEventListener('input', (e) => {
    if (!e.target) return;
    if (e.target.id === 'm-subject' || e.target.id === 'm-body') updatePreview();
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
        if (n.classList && (n.classList.contains('adm-var-token') || n.classList.contains('adm-mail-imgtoken'))) return true;
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
    insertInlineImage, updatePreview
  });
})();
