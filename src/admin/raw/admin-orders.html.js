export default `<main class="page fade-up">
    <section class="wide">
      <a href="admin.html" class="adm-back">← Dashboard</a>
      <h1 class="page-title">Orders</h1>
      <p class="adm-section-desc">파트너 발주를 등록·수정하고 출고 상태와 정산 금액을 관리합니다.<br>발주서·계약서 본문과 파일(PDF/이미지)을 함께 작성해 파트너 이메일로 발송할 수 있습니다.</p>

      <div class="adm-stat-row">
        <div class="adm-stat"><b id="s-total">0</b><span>전체 건수</span></div>
        <div class="adm-stat"><b id="s-new">0</b><span>접수</span></div>
        <div class="adm-stat"><b id="s-pending">0</b><span>처리중</span></div>
        <div class="adm-stat"><b id="s-amount">0</b><span>총 금액 (KRW)</span></div>
      </div>

      <div class="adm-section">
        <div class="adm-section-head">
          <div>
            <h3>발주 목록 <span class="adm-section-sub">Order Workflow</span></h3>
          </div>
          <button class="btn" type="button" onclick="openAdd()">+ 발주 등록</button>
        </div>

        <div class="adm-toolbar">
          <input type="search" id="q" placeholder="파트너 / 상품 검색" oninput="render()">
          <select id="filter-status" onchange="render()">
            <option value="">전체 상태</option>
            <option>접수</option><option>처리중</option><option>출고완료</option>
          </select>
          <span class="spacer"></span>
          <span style="font-size:11px;color:#8c867d;letter-spacing:.08em" id="count">0건</span>
        </div>

        <div class="adm-form-panel" id="form-area">
          <div class="adm-form">
            <div><label>파트너</label><select id="f-partner-pick" onchange="onPickPartner()"><option value="">— 등록된 파트너 선택 —</option></select></div>
            <div><label>파트너명 (직접 입력)</label><input id="f-partner" type="text" placeholder="자유 입력 가능"></div>
            <div><label>상품</label><select id="f-product"><option>생지 (냉동)</option><option>스페셜티 원두</option><option>시럽/소스</option><option>포장재</option><option>기타</option></select></div>
            <div><label>수량</label><input id="f-qty" type="text" placeholder="수량"></div>
            <div><label>단가 (원)</label><input id="f-price" type="number" placeholder="0"></div>
            <div><label>상태</label><select id="f-status"><option>접수</option><option>처리중</option><option>출고완료</option></select></div>
            <div class="full"><label>비고/메모</label><textarea id="f-note" placeholder="배송 메모, 특이사항"></textarea></div>

            <div class="full" style="border-top:1px solid #e6e3dd;padding-top:18px;margin-top:6px">
              <h4 style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8c867d;margin:0 0 12px;font-weight:500">📑 발주서 / 계약서 / 명세서</h4>
            </div>

            <div class="full"><label>계약서 본문 <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">계약 조건, 단가 명세, 결제·배송 일정 등</span></label><textarea id="f-contract" rows="6" placeholder="발주 계약 조건을 작성하세요. '계약서 발송' 버튼으로 파트너 이메일에 본문 + 첨부 파일을 함께 전송합니다."></textarea></div>

            <div class="full"><label>발주서 본문 <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">정식 발주서로 보낼 별도 본문 (선택)</span></label><textarea id="f-purchaseorder" rows="5" placeholder="발주 항목 요약, 납기, 정산 조건. 비워두면 위 계약서 본문이 사용됩니다."></textarea></div>

            <div class="full">
              <label>첨부 파일 <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">PDF·이미지 파일 첨부 가능 (이미지는 자동 최적화)</span></label>
              <input type="file" id="f-doc-files" accept="image/*,application/pdf" multiple onchange="addOrderAttachments(this.files)">
              <div id="f-doc-thumbs" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px"></div>
            </div>

            <div class="adm-form-actions">
              <button class="btn" type="button" onclick="save()" id="save-btn">저장</button>
              <button class="adm-btn-sm" type="button" onclick="resetForm()">취소</button>
              <span class="spacer" style="flex:1"></span>
              <span id="form-mode" style="font-size:11px;color:#8c867d;letter-spacing:.12em;text-transform:uppercase">신규 등록</span>
            </div>
          </div>
        </div>

        <table class="adm-table">
          <thead>
            <tr>
              <th>주문번호</th>
              <th>파트너</th>
              <th>상품</th>
              <th>수량</th>
              <th>금액</th>
              <th>접수일</th>
              <th>상태</th>
              <th class="col-actions">관리</th>
            </tr>
          </thead>
          <tbody id="list"></tbody>
        </table>
      </div>
    </section>
  </main>`;
