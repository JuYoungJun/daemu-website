// Privacy policy / 개인정보처리방침 — PIPA-compliant disclosure (F-08).
// Updated whenever the data flow changes (new processor, retention, etc).
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd } from '../lib/seo.js';

export default function Privacy() {
  useSeo({
    title: '개인정보처리방침',
    description: '대무 (DAEMU)의 개인정보 수집·이용·보유·제3자 제공·정보주체 권리에 대한 PIPA 준수 방침.',
    path: '/privacy',
    noindex: false,
    jsonLd: [breadcrumbLd([{ name: '홈', path: '/' }, { name: '개인정보처리방침', path: '/privacy' }])],
  });
  return (
    <main className="page" style={{ padding: '32px 0 64px' }}>
      <section className="narrow" style={{ maxWidth: 820, margin: '0 auto', padding: '0 24px' }}>
        <h1 className="page-title" style={{ marginBottom: 18 }}>개인정보처리방침</h1>
        <p style={{ fontSize: 13, color: '#5f5b57', marginBottom: 28 }}>
          시행일: 2026-04-27 · 최종 개정: 2026-04-27
        </p>

        <article style={{ fontSize: 14, lineHeight: 1.9, color: '#222' }}>
          <Section title="1. 처리 목적">
            대무 (이하 '회사')는 다음의 목적을 위하여 최소한의 개인정보를 수집·이용합니다.
            <ol>
              <li>상담/문의 접수, 본인 확인 및 안내 회신</li>
              <li>창업 컨설팅·메뉴 개발·브랜드 디자인·공간 설계 등 서비스 제공</li>
              <li>법령에 따른 의무 이행 및 분쟁 시 권리 보호</li>
            </ol>
          </Section>

          <Section title="2. 수집하는 개인정보 항목">
            <ul>
              <li><strong>필수</strong>: 이름(또는 회사명), 이메일</li>
              <li><strong>선택</strong>: 연락처(전화번호), 브랜드명, 매장 위치, 예상 오픈 시기, 문의 내용</li>
              <li><strong>자동 수집</strong>: 접속 IP (스팸 방지 목적), 접수 일시</li>
            </ul>
          </Section>

          <Section title="3. 보유 및 이용 기간">
            <ul>
              <li>상담/문의 데이터: 접수일로부터 <strong>3년</strong> 보유 후 파기</li>
              <li>관리자 발송 이력 (Outbox): 발송일로부터 <strong>1년</strong> 보유 후 파기</li>
              <li>이용자가 삭제를 요청하면 즉시 파기 (단, 법령상 보존 의무가 있는 경우 제외)</li>
            </ul>
          </Section>

          <Section title="4. 제3자 제공 및 처리 위탁">
            서비스 제공을 위해 다음 처리자를 이용합니다.
            <ul>
              <li><strong>Resend (이메일 발송)</strong> · 미국 · 자동회신 / 관리자 회신 메일 처리 — 회사 도메인 인증 후에는 SPF/DKIM 정렬을 적용하여 발송됩니다.</li>
              <li><strong>Render / 카페24 (서버 호스팅)</strong> · 데이터베이스 보관 및 API 호출 처리</li>
              <li><strong>GitHub Pages</strong> · 정적 페이지 호스팅 (개인정보 저장 없음)</li>
            </ul>
            그 외 어떠한 제3자에게도 개인정보를 제공하지 않으며, 광고/마케팅 목적으로 활용하지 않습니다.
          </Section>

          <Section title="5. 정보주체의 권리">
            이용자는 언제든지 다음 권리를 행사할 수 있습니다.
            <ul>
              <li>개인정보 열람·정정·삭제·처리정지 요청</li>
              <li>동의 철회</li>
            </ul>
            요청은 <a href="mailto:daemu_office@naver.com" style={{ textDecoration: 'underline' }}>daemu_office@naver.com</a> 또는 061-335-1239 로 접수하시면 지체 없이(영업일 기준 5일 이내) 처리됩니다.
          </Section>

          <Section title="6. 안전성 확보 조치">
            <ul>
              <li>관리자 계정은 역할 기반 권한 분리(관리자 / 테스트 / 개발) + JWT 만료 12시간 + bcrypt 비밀번호 해싱</li>
              <li>임시 비밀번호 강제 변경 + 비밀번호 강도 검증 (8자 이상, 영문·숫자·특수문자 중 2종 이상)</li>
              <li>API 응답에 X-Content-Type-Options / X-Frame-Options / CSP / HSTS 적용</li>
              <li>로그인 실패 시 IP 기반 잠금 (15분 / 5회)</li>
              <li>업로드 파일은 매직 바이트 검증을 거친 이미지(.jpg, .png, .gif, .webp) 만 허용</li>
            </ul>
          </Section>

          <Section title="7. 개인정보 보호책임자">
            <ul>
              <li>성명: 대무 운영팀 책임자</li>
              <li>이메일: daemu_office@naver.com</li>
              <li>전화: 061-335-1239</li>
            </ul>
            개인정보 침해 신고는 다음 기관에서도 도움받을 수 있습니다.
            <ul>
              <li>개인정보분쟁조정위원회 (kopico.go.kr · 1833-6972)</li>
              <li>한국인터넷진흥원 개인정보침해신고센터 (privacy.kisa.or.kr · 118)</li>
              <li>대검찰청 사이버수사과 (cybercid.spo.go.kr · 1301)</li>
            </ul>
          </Section>

          <Section title="8. 방침 변경">
            본 방침이 변경되는 경우 최소 7일 전에 본 페이지 상단 '시행일' 을 업데이트하여 공지합니다.
          </Section>
        </article>
      </section>
    </main>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 18, marginBottom: 10, color: '#111' }}>{title}</h2>
      <div style={{ paddingLeft: 4 }}>{children}</div>
    </section>
  );
}
