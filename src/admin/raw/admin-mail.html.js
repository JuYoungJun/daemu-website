export default `<main class="page fade-up">
    <section class="wide">
      <a href="admin.html" class="adm-back">← Dashboard</a>
      <h1 class="page-title">Auto-Reply</h1>
      <p class="adm-section-desc">Contact 폼 / 상담 신규 등록 시 자동으로 발송되는 회신 메일을 관리합니다.<br>여기 저장된 제목·본문이 백엔드(Resend)를 통해 그대로 발송됩니다.</p>

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
            <div class="adm-mail-var-item"><code>{{name}}</code><span>수신자 이름</span></div>
            <div class="adm-mail-var-item"><code>{{category}}</code><span>문의 카테고리</span></div>
            <div class="adm-mail-var-item"><code>{{message}}</code><span>원본 문의 내용</span></div>
            <div class="adm-mail-var-item"><code>{{phone}}</code><span>연락처</span></div>
            <div class="adm-mail-var-item"><code>{{email}}</code><span>이메일</span></div>
          </div>
        </div>

        <div class="adm-form">
          <div class="full"><label>제목</label><input id="m-subject" type="text" placeholder="[대무] 문의가 접수되었습니다"></div>
          <div class="full"><label>본문</label><textarea id="m-body" rows="12" placeholder="{{name}} 님,&#10;&#10;대무에 문의해 주셔서 감사합니다..."></textarea></div>
          <div><label>자동회신</label><select id="m-active"><option value="on">활성 (ON)</option><option value="off">비활성 (OFF)</option></select></div>
          <div><label>회신 정책</label><select id="m-category"><option value="all">전체 동일 적용</option><option value="each">카테고리별 적용</option></select></div>
          <div class="full"><label>미리보기 (변수 미치환 원본)</label>
            <div id="m-preview" style="white-space:pre-wrap;background:#f6f4f0;border:1px solid #d7d4cf;padding:18px;font-family:'Noto Sans KR',sans-serif;font-size:13px;color:#4a4744;line-height:1.7;min-height:120px"></div>
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
