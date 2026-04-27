export default `<main class="page fade-up">
    <section class="wide">
      <a href="admin.html" class="adm-back">← Dashboard</a>
      <h1 class="page-title">Auto-Reply</h1>
      <p class="adm-section-desc">Contact 폼 / 상담 신규 등록 시 자동으로 발송되는 회신 메일을 관리합니다.<br>본문에 삽입한 이미지는 <strong>메일 본문 안에 그대로 박혀</strong> 발송됩니다 (파일 첨부 형태가 아님).</p>

      <div class="adm-section">
        <div class="adm-section-head">
          <div>
            <h3>자동회신 템플릿 <span class="adm-section-sub">Reply Template</span></h3>
          </div>
        </div>

        <div class="adm-mail-vars" aria-label="시스템 정의 변수">
          <div class="adm-mail-vars-head">
            <span class="adm-mail-vars-lock" aria-hidden="true">🔒</span>
            <div>
              <div class="adm-mail-vars-title">사용 가능한 변수</div>
              <div class="adm-mail-vars-sub">본문/제목에 그대로 입력하면 발송 시 자동 치환됩니다 · 시스템 정의 (편집 불가)</div>
            </div>
          </div>
          <div class="adm-mail-vars-grid">
            <button type="button" class="adm-mail-var-item" onclick="insertVar('name')"><code>{{name}}</code><span>수신자 이름</span></button>
            <button type="button" class="adm-mail-var-item" onclick="insertVar('category')"><code>{{category}}</code><span>문의 카테고리</span></button>
            <button type="button" class="adm-mail-var-item" onclick="insertVar('message')"><code>{{message}}</code><span>원본 문의 내용</span></button>
            <button type="button" class="adm-mail-var-item" onclick="insertVar('phone')"><code>{{phone}}</code><span>연락처</span></button>
            <button type="button" class="adm-mail-var-item" onclick="insertVar('email')"><code>{{email}}</code><span>이메일</span></button>
          </div>
          <p style="margin:14px 0 0;font-size:11px;color:#8c867d;line-height:1.6">↑ 변수를 클릭하면 본문 커서 위치에 삽입됩니다. 본문에 들어간 변수는 잠긴 토큰으로 표시되며 직접 수정·삭제할 수 없습니다.</p>
        </div>

        <div class="adm-form">
          <div class="full"><label>제목</label><input id="m-subject" type="text" placeholder="[대무] 문의가 접수되었습니다"></div>
          <div class="full">
            <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:8px;flex-wrap:wrap;gap:8px">
              <label style="margin:0">본문 <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">변수 토큰 잠금 · 이미지 본문 인라인 삽입</span></label>
              <label class="adm-btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px">
                <input type="file" accept="image/*" id="m-inline-img" onchange="insertInlineImage(this.files)" style="display:none">
                + 이미지 삽입
              </label>
            </div>
            <div id="m-body" class="adm-body-editor" contenteditable="true" spellcheck="false"></div>
          </div>
          <div><label>자동회신</label><select id="m-active"><option value="on">활성 (ON)</option><option value="off">비활성 (OFF)</option></select></div>
          <div><label>회신 정책</label><select id="m-category"><option value="all">전체 동일 적용</option><option value="each">카테고리별 적용</option></select></div>
          <div class="full"><label>HTML 미리보기 <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">실제 발송 메일과 동일</span></label>
            <iframe id="m-preview" style="width:100%;min-height:380px;border:1px solid #d7d4cf;background:#fff;border-radius:0"></iframe>
          </div>
          <div class="adm-form-actions">
            <button class="btn" type="button" onclick="saveMail()">저장</button>
            <button class="adm-btn-sm" type="button" onclick="testSend()">테스트 발송</button>
            <button class="adm-btn-sm" type="button" onclick="resetMail()">초기값으로</button>
          </div>
        </div>
      </div>
    </section>
  </main>`;
