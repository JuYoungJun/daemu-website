export default `<main class="page fade-up">
    <section class="wide">
      <a href="admin.html" class="adm-back">← Dashboard</a>
      <h1 class="page-title">Works</h1>
      <p class="adm-section-desc">프로젝트(작업사례)를 등록·수정합니다. 구조형 모드는 work-detail 페이지의 슬롯에 정확히 매핑되어 즉시 반영됩니다.<br>등록한 프로젝트는 /work/&lt;슬러그&gt; 상세 페이지에 노출됩니다.</p>

      <div class="adm-section">
        <div class="adm-section-head">
          <div>
            <h3>프로젝트 목록 <span class="adm-section-sub">Project Registry</span></h3>
          </div>
          <button class="btn" type="button" onclick="openAdd()">+ 신규 등록</button>
        </div>

        <div class="adm-toolbar">
          <input type="search" id="q" placeholder="브랜드 / 지점명 검색" oninput="render()">
          <select id="filter-brand" onchange="render()">
            <option value="">전체 브랜드</option>
            <option>Beclassy</option><option>Pumjang</option><option>Morif</option><option>기타</option>
          </select>
          <select id="filter-status" onchange="render()">
            <option value="">전체 상태</option>
            <option>운영중</option><option>준비중</option><option>NEW</option>
          </select>
          <span class="spacer"></span>
          <span style="font-size:11px;color:#8c867d;letter-spacing:.08em" id="count">0건</span>
        </div>

        <div class="adm-form-panel" id="form-area">
          <div style="display:flex;gap:0;border-bottom:1px solid #d7d4cf;margin-bottom:24px">
            <button type="button" id="mode-structured-btn" onclick="setMode('structured')" style="flex:1;padding:12px 0;background:none;border:none;border-bottom:2px solid #111;cursor:pointer;font-family:inherit;font-size:13px;color:#111;font-weight:500">구조형 (work-detail 슬롯 매핑)</button>
            <button type="button" id="mode-free-btn" onclick="setMode('free')" style="flex:1;padding:12px 0;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;font-family:inherit;font-size:13px;color:#8c867d">자유형 (이미지만)</button>
          </div>

          <h4 style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8c867d;margin:0 0 14px;font-weight:500">기본 정보</h4>
          <div class="adm-form" style="margin-bottom:32px">
            <div><label>브랜드</label><select id="f-brand"><option>Beclassy</option><option>Pumjang</option><option>Morif</option><option>기타</option></select></div>
            <div><label>지점명</label><input id="f-name" type="text" placeholder="나주점"></div>
            <div><label>슬러그 <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">URL: /work/이값</span></label><input id="f-slug" type="text" placeholder="beclassy-naju" pattern="[a-z0-9-]+"></div>
            <div><label>규모</label><input id="f-size" type="text" placeholder="170평"></div>
            <div><label>연도</label><input id="f-year" type="text" placeholder="2024"></div>
            <div><label>상태</label><select id="f-status"><option>운영중</option><option>준비중</option><option>NEW</option></select></div>
            <div class="full"><label>주소</label><input id="f-addr" type="text" placeholder="전라남도 나주시 노안면 건재로 524-11"></div>
          </div>

          <div id="structured-fields">
            <h4 style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8c867d;margin:0 0 14px;font-weight:500">상세 콘텐츠</h4>
            <div class="adm-form" style="margin-bottom:32px">
              <div class="full"><label>표시 제목 <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">HTML 허용 (이탤릭은 &lt;em&gt; 사용)</span></label><input id="f-title" type="text" placeholder="Beclassy &lt;em&gt;나주점&lt;/em&gt;"></div>
              <div class="full"><label>한 줄 카테고리 / 서브 브랜드</label><input id="f-brand-line" type="text" placeholder="BECLASSY · COFFEE & BAKERY"></div>
              <div class="full"><label>개요 (Overview)</label><textarea id="f-overview" rows="4" placeholder="프로젝트 개요와 컨텍스트를 작성하세요."></textarea></div>
              <div class="full"><label>태그 <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">쉼표로 구분</span></label><input id="f-tags" type="text" placeholder="브랜드 런칭, 메뉴 개발, 운영 설계"></div>
            </div>

            <h4 style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8c867d;margin:0 0 14px;font-weight:500">통계 슬롯 (최대 3개)</h4>
            <div class="adm-form" style="margin-bottom:32px">
              <div><label>슬롯 1 라벨</label><input id="f-stat1-label" type="text" placeholder="SIZE"></div>
              <div><label>슬롯 1 값</label><input id="f-stat1-val" type="text" placeholder="170평"></div>
              <div><label>슬롯 2 라벨</label><input id="f-stat2-label" type="text" placeholder="YEAR"></div>
              <div><label>슬롯 2 값</label><input id="f-stat2-val" type="text" placeholder="2018"></div>
              <div><label>슬롯 3 라벨</label><input id="f-stat3-label" type="text" placeholder="FLOORS"></div>
              <div><label>슬롯 3 값</label><input id="f-stat3-val" type="text" placeholder="4층"></div>
            </div>

            <h4 style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8c867d;margin:0 0 14px;font-weight:500">프로세스 단계 (최대 4개)</h4>
            <div id="process-rows" style="margin-bottom:32px"></div>
          </div>

          <h4 style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8c867d;margin:0 0 14px;font-weight:500">미디어</h4>
          <div class="adm-form" style="margin-bottom:32px">
            <div class="full" id="hero-slot-wrap">
              <label>히어로 이미지 (1장) <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">work-detail 상단 메인 이미지</span></label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
                <button type="button" class="adm-btn-sm" onclick="pickHeroFromLibrary()">미디어 라이브러리에서 선택</button>
                <span style="font-size:11px;color:#8c867d">또는 파일 업로드</span>
                <input type="file" id="f-hero-file" accept="image/*" onchange="addHeroImage(this.files)">
              </div>
              <div class="adm-thumb-row" id="f-hero-thumb"></div>
            </div>
            <div class="full">
              <label>갤러리 이미지 <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">여러 장 (자동 최적화 · 1920px 캡)</span></label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
                <button type="button" class="adm-btn-sm" onclick="pickGalleryFromLibrary()">미디어 라이브러리에서 선택</button>
                <span style="font-size:11px;color:#8c867d">또는 파일 업로드</span>
                <input type="file" id="f-files" accept="image/*" multiple onchange="addImages(this.files)">
              </div>
              <div class="adm-thumb-row" id="f-thumbs"></div>
            </div>
            <div class="full"><label>설명 <span style="text-transform:none;letter-spacing:0;color:#8c867d;font-size:11px">Work 카드 노출용 짧은 설명</span></label><textarea id="f-desc" placeholder="프로젝트 카드 노출용 짧은 설명"></textarea></div>
          </div>

          <div class="adm-form-actions">
            <button class="btn" type="button" onclick="save()" id="save-btn">저장</button>
            <button class="adm-btn-sm" type="button" onclick="previewProject()">미리보기 (새 탭)</button>
            <button class="adm-btn-sm" type="button" onclick="resetForm()">취소</button>
            <span class="spacer" style="flex:1"></span>
            <span id="form-mode" style="font-size:11px;color:#8c867d;letter-spacing:.12em;text-transform:uppercase">신규 등록</span>
          </div>
        </div>

        <table class="adm-table">
          <thead>
            <tr>
              <th>이미지</th>
              <th>브랜드</th>
              <th>지점</th>
              <th>슬러그</th>
              <th>연도</th>
              <th>상태</th>
              <th class="col-actions">관리</th>
            </tr>
          </thead>
          <tbody id="list"></tbody>
        </table>
      </div>
    </section>
  </main>`;
