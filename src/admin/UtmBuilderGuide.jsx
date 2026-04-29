// UTM 빌더 사용 가이드 모달.
//
// 운영자가 처음 열어도 단독으로 활용할 수 있도록 "UTM 이 무엇이고, 어떤
// 순서로 쓰며, 분석 페이지에서 어떻게 집계되는지" 를 한 화면에 정리한다.
// AdminUtmBuilder 상단의 "사용 가이드" 버튼으로 열림.

export default function UtmBuilderGuide({ onClose }) {
  return (
    <div className="adm-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="adm-modal-box is-wide" style={{ maxWidth: 920 }}>
        <div className="adm-modal-head">
          <h2>UTM 빌더 — 사용 가이드</h2>
          <button type="button" className="adm-modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <div style={{ fontSize: 13.5, color: '#2a2724', lineHeight: 1.85, wordBreak: 'keep-all' }}>

          <Section title="이 페이지는 어떤 곳인가요?">
            <p>
              마케팅 캠페인용 URL 의 끝에 붙이는 <strong>UTM 파라미터</strong>를 자동으로 조립해주는 도구입니다.
              만든 URL 은 메일 템플릿, SNS 광고, 카카오 채널, 배너, 종이 전단지 QR 등 어디든 그대로 사용할 수 있고,
              <code>/admin/analytics</code> 마케팅 분석 페이지가 <code>utm_source</code>·<code>utm_campaign</code> 을 자동 집계합니다.
            </p>
            <p style={{ background: '#fafaf6', padding: '10px 14px', borderLeft: '3px solid #1f5e7c', fontSize: 12.5 }}>
              외부 API 호출 없이 100% 브라우저 안에서 동작합니다 — 데이터는 본 컴퓨터의 localStorage 에만 저장되고,
              네트워크로 나가지 않습니다.
            </p>
          </Section>

          <Section title="UTM 파라미터 5종의 의미">
            <table style={tableStyle}>
              <thead>
                <tr><Th>파라미터</Th><Th>뜻</Th><Th>예시</Th></tr>
              </thead>
              <tbody>
                <tr><Td><code>utm_source</code></Td><Td>어디서 왔는지 (출처)</Td><Td><code>naver</code>, <code>google</code>, <code>instagram</code>, <code>kakao</code></Td></tr>
                <tr><Td><code>utm_medium</code></Td><Td>어떻게 왔는지 (매체 종류)</Td><Td><code>cpc</code>(검색광고), <code>email</code>, <code>social</code>, <code>qr</code></Td></tr>
                <tr><Td><code>utm_campaign</code></Td><Td>어떤 캠페인 이름인지</Td><Td><code>2026_spring_open</code>, <code>nov_promo</code></Td></tr>
                <tr><Td><code>utm_term</code></Td><Td>(선택) 검색 키워드</Td><Td><code>나주_카페</code>, <code>베이커리_컨설팅</code></Td></tr>
                <tr><Td><code>utm_content</code></Td><Td>(선택) 동일 캠페인의 변형 식별</Td><Td><code>banner_a</code>, <code>banner_b</code>(A/B 테스트)</Td></tr>
              </tbody>
            </table>
            <p style={{ fontSize: 12.5, color: '#5a4a2a', background: '#fff8ec', padding: '10px 14px', borderLeft: '3px solid #c9a25a' }}>
              <strong>필수</strong> 3종(source · medium · campaign)만 잘 채워도 분석에는 충분합니다. term/content 는 검색광고나 A/B 테스트할 때만 추가하세요.
            </p>
          </Section>

          <Section title="3단계 빠른 시작">
            <ol style={listStyle}>
              <li><strong>Base URL</strong> 입력 — 예: <code>https://daemu.co.kr/contact</code> (UTM 이 붙을 사이트의 페이지 주소).</li>
              <li><strong>source / medium</strong> 프리셋 chip 클릭 — 자주 쓰는 조합은 한 번에 지정. 직접 입력도 가능.</li>
              <li><strong>campaign 이름</strong>은 영문 소문자 + 숫자 + <code>_</code> 권장. 예: <code>2026_grand_open</code>.</li>
              <li>완성된 URL 을 <em>복사</em> 또는 <em>이력에 저장</em>(최근 50건 보관, 같은 조합은 dedup).</li>
            </ol>
          </Section>

          <Section title="Source / Medium 매트릭스 — 어떤 조합을 쓸지">
            <table style={tableStyle}>
              <thead><tr><Th>채널</Th><Th>source</Th><Th>medium</Th></tr></thead>
              <tbody>
                <tr><Td>네이버 검색광고</Td><Td><code>naver</code></Td><Td><code>cpc</code></Td></tr>
                <tr><Td>구글 검색광고</Td><Td><code>google</code></Td><Td><code>cpc</code></Td></tr>
                <tr><Td>네이버 블로그</Td><Td><code>naver</code></Td><Td><code>blog</code></Td></tr>
                <tr><Td>카카오톡 채널</Td><Td><code>kakao</code></Td><Td><code>messenger</code></Td></tr>
                <tr><Td>인스타그램 광고</Td><Td><code>instagram</code></Td><Td><code>social</code> 또는 <code>cpc</code></Td></tr>
                <tr><Td>이메일 뉴스레터</Td><Td><code>newsletter</code></Td><Td><code>email</code></Td></tr>
                <tr><Td>오프라인 QR (전단·명함)</Td><Td><code>print_qr</code></Td><Td><code>qr</code></Td></tr>
                <tr><Td>유튜브 영상 설명</Td><Td><code>youtube</code></Td><Td><code>video</code></Td></tr>
              </tbody>
            </table>
          </Section>

          <Section title="단축 링크 + QR 코드 (보안)">
            <p>
              긴 UTM 링크를 <strong>단축 링크</strong>로 변환하면 <code>https://daemu-py.onrender.com/r/abc12</code> 처럼
              짧은 형태로 사용할 수 있습니다. 카드·전단지·명함 QR 에 적합합니다.
            </p>
            <ul style={listStyle}>
              <li><strong>HMAC 서명</strong>으로 위·변조 방지 — 누군가 short_id 를 추측해 다른 곳으로 리다이렉트시킬 수 없습니다.</li>
              <li><strong>만료 일자</strong> 설정 가능 — 캠페인 종료 후 자동 비활성. 필요시 즉시 revoke.</li>
              <li><strong>클릭 통계</strong> — 시간대·referer host·UA family 별 카운트. IP 는 hash 로 저장(PIPA 준수).</li>
              <li><strong>QR 코드</strong> — 단축 링크에서 즉시 생성, PNG/SVG 다운로드.</li>
            </ul>
          </Section>

          <Section title="분석 페이지(/admin/analytics)에서의 집계">
            <p>
              본 사이트 방문자가 UTM 이 붙은 URL 로 들어오면, 자체 트래킹 코드(<code>lib/marketingAnalytics.js</code>)가
              브라우저 localStorage 에 첫 진입 정보를 저장합니다. 이후 마케팅 분석 페이지에서 다음을 볼 수 있습니다:
            </p>
            <ul style={listStyle}>
              <li>일자별 방문 추이 (전체·신규)</li>
              <li>UTM 캠페인별 유입 카운트 + 전환율</li>
              <li>유입 채널 분포 (검색·SNS·이메일·QR·직접)</li>
              <li>CTA 클릭·폼 제출 카운트 (UTM 별)</li>
              <li>모든 통계는 CSV 로 내보내 외부 보고서 작성</li>
            </ul>
          </Section>

          <Section title="외부 도구와의 연동 (도메인 확정 후)">
            <p>도메인이 확정되면 다음 무료 도구들에 등록해 더 풍부한 분석이 가능합니다:</p>
            <ul style={listStyle}>
              <li><strong>Google Analytics 4 (GA4)</strong> — UTM 을 자동 인식해 캠페인 보고서 생성. utm_source/medium/campaign 을 dimension 으로 사용.</li>
              <li><strong>Google Search Console</strong> — 검색 노출·클릭 키워드. UTM 과 별개지만 같이 보면 인지/획득 단계 모두 이해 가능.</li>
              <li><strong>네이버 서치어드바이저</strong> — 네이버 검색 결과에서의 노출/클릭. 한국 시장 필수.</li>
              <li><strong>네이버 애널리틱스</strong> — 네이버 검색·블로그·카페 등 한국 채널의 유입을 더 정확히 분류.</li>
            </ul>
            <p style={{ fontSize: 12.5, color: '#5a4a2a' }}>
              위 도구들도 모두 <code>?utm_source=...</code> 형태를 표준으로 인식하므로, 이 페이지에서 만든 URL 을 그대로 사용하면 됩니다.
            </p>
          </Section>

          <Section title="자주 하는 실수">
            <ul style={listStyle}>
              <li><strong>대소문자 불일치</strong> — <code>Naver</code> 와 <code>naver</code> 가 다른 채널로 집계됩니다. 항상 소문자로 통일.</li>
              <li><strong>공백 / 한글 / 특수문자</strong> — campaign 이름에는 영문/숫자/<code>_</code>/<code>-</code> 만 사용 권장.</li>
              <li><strong>같은 캠페인에 다른 source 할당</strong> — campaign 은 의도(예: 봄 오픈), source 는 채널(예: naver)이라는 구조를 지켜야 GA 가 캠페인 단위로 통합 집계합니다.</li>
              <li><strong>홈페이지 자체 링크에 UTM 추가</strong> — 사이트 내부 이동에 UTM 을 붙이면 세션이 끊겨 통계가 왜곡됩니다. 외부에서 들어오는 입구에만 붙이세요.</li>
            </ul>
          </Section>

          <Section title="모니터링 — 캠페인이 잘 굴러가는지">
            <p>
              본 페이지 상단의 <strong>모니터링 KPI 패널</strong>이 단축 링크 전체의 활성/만료/클릭/24시간 활동을 보여줍니다.
              개별 단축 링크의 클릭 통계는 행 우측의 <em>통계</em> 버튼에서 시간대별 분포까지 확인할 수 있습니다.
            </p>
          </Section>

        </div>

        <div className="adm-modal-foot">
          <button type="button" className="adm-btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{
        fontSize: 14, color: '#231815', margin: '0 0 8px',
        paddingBottom: 6, borderBottom: '1px solid #e6e3dd',
        letterSpacing: '.02em', fontWeight: 600,
      }}>{title}</h3>
      {children}
    </div>
  );
}

const listStyle = { paddingLeft: 22, margin: '6px 0', display: 'flex', flexDirection: 'column', gap: 4 };
const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5, marginTop: 6, marginBottom: 8 };

function Th({ children }) {
  return <th style={{ background: '#f4f1ea', padding: '7px 10px', textAlign: 'left', fontWeight: 600, color: '#5a534b', fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid #d7d4cf' }}>{children}</th>;
}
function Td({ children }) {
  return <td style={{ padding: '7px 10px', borderBottom: '1px solid #f0ede7', verticalAlign: 'top' }}>{children}</td>;
}
