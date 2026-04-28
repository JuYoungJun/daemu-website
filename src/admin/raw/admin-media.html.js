export default `<main class="page fade-up">
    <section class="wide">
      <a href="admin.html" class="adm-back">← Dashboard</a>
      <h1 class="page-title">Media</h1>
      <p class="adm-section-desc">이미지·영상을 업로드하고 라이브러리를 관리합니다. 다른 어드민 페이지에서도 이 라이브러리에서 자산을 선택해 재사용할 수 있습니다.</p>

      <div class="adm-section">
        <div class="adm-section-head" style="flex-wrap:wrap;gap:12px">
          <div>
            <h3>미디어 라이브러리 <span class="adm-section-sub">Media Library</span></h3>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <select id="media-filter" onchange="setFilter(this.value)" style="padding:6px 10px;border:1px solid #d7d4cf;background:#fff;font-size:13px">
              <option value="all">전체</option>
              <option value="image">이미지만</option>
              <option value="video">영상만</option>
            </select>
            <label class="btn adm-upload-btn">
              <input type="file" accept="image/*" multiple onchange="uploadFilesAs(this.files,'image');this.value=''">
              + 이미지
            </label>
            <label class="btn adm-upload-btn">
              <input type="file" accept="video/mp4,video/webm" multiple onchange="uploadFilesAs(this.files,'video');this.value=''">
              + 영상
            </label>
          </div>
        </div>
        <div id="media-stats" style="margin:6px 0 16px;font-size:12px;color:#6f6b68;display:flex;gap:18px;flex-wrap:wrap"></div>
        <div class="adm-media-grid" id="media-grid"></div>
      </div>
    </section>
  </main>`;
