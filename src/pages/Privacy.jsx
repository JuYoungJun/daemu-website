// Privacy policy / 개인정보처리방침 — 한국 산업 표준 (PIPA + 정보통신망법 준수).
// 한국인터넷진흥원(KISA)의 표준 개인정보처리방침 작성 지침에 따라 14개 항목 + 부칙으로 구성.
import { useSeo } from '../hooks/useSeo.js';
import { breadcrumbLd } from '../lib/seo.js';

export default function Privacy() {
  useSeo({
    title: '개인정보처리방침',
    description: '대무 (DAEMU) 의 개인정보 수집·이용·보유·제3자 제공·정보주체 권리에 대한 PIPA·정보통신망법 준수 방침.',
    path: '/privacy',
    noindex: false,
    jsonLd: [breadcrumbLd([{ name: '홈', path: '/' }, { name: '개인정보처리방침', path: '/privacy' }])],
  });

  return (
    <main className="page" style={{ padding: '32px 0 64px' }}>
      <section className="narrow" style={{ maxWidth: 820, margin: '0 auto', padding: '0 24px' }}>
        <h1 className="page-title" style={{ marginBottom: 18 }}>개인정보처리방침</h1>
        <p style={{ fontSize: 13, color: '#5f5b57', marginBottom: 20 }}>
          시행일: <strong>2026-04-28</strong> (Ver. 1.0) · 최종 개정: 2026-04-28
        </p>
        <p style={{ fontSize: 13, color: '#444', lineHeight: 1.85, marginBottom: 32, padding: '14px 18px', background: '#f4f1eb', borderLeft: '3px solid #2a2724' }}>
          대무 (이하 "회사" 또는 "대무") 는 「개인정보 보호법」(이하 'PIPA') 제30조에 따라
          정보주체의 개인정보를 보호하고 관련 고충을 신속·원활하게 처리하기 위하여 다음과 같은
          처리방침을 수립·공개합니다. 본 방침은 카페24 · 네이버 등 한국 주요 SaaS 사업자가
          따르는 산업 표준 양식을 기준으로 작성되었습니다.
        </p>

        <article style={{ fontSize: 14, lineHeight: 1.9, color: '#222' }}>
          <Section title="제1조 (개인정보의 처리 목적)">
            회사는 다음의 목적을 위하여 개인정보를 처리합니다. 처리한 개인정보는 다음의 목적
            이외의 용도로는 이용되지 않으며, 이용 목적이 변경되는 경우에는 PIPA 제18조에 따라
            별도의 동의를 받는 등 필요한 조치를 이행할 예정입니다.
            <ol>
              <li>홈페이지 회원가입 및 관리 (해당 시)</li>
              <li>상담·문의 접수, 본인 확인 및 안내 회신</li>
              <li>창업 컨설팅·메뉴 개발·브랜드 디자인·공간 설계·매장 운영 등 서비스 제공</li>
              <li>계약의 체결·이행을 위한 연락, 발주서·계약서 발송</li>
              <li>마케팅 및 광고에의 활용 — 별도 동의를 받은 경우에 한함</li>
              <li>법령상 의무 이행 및 분쟁 시 권리·의무관계의 확인</li>
            </ol>
          </Section>

          <Section title="제2조 (처리하는 개인정보 항목)">
            회사는 다음의 개인정보 항목을 처리하고 있습니다.
            <p style={{ marginTop: 8 }}><strong>1. 홈페이지 상담·문의</strong></p>
            <ul>
              <li>필수항목: 이름(또는 회사명), 이메일</li>
              <li>선택항목: 연락처(전화번호), 브랜드명, 매장 위치(예정 지역), 예상 오픈 시기, 문의 내용</li>
            </ul>
            <p style={{ marginTop: 12 }}><strong>2. 자동수집 (스팸·악용 방지)</strong></p>
            <ul>
              <li>접속 IP 주소, 접수 일시, 브라우저 종류 및 OS, 쿠키, User-Agent</li>
              <li>이용자가 동의한 경우에 한해 Google Analytics 4 (익명화·IP 마스킹 적용)</li>
            </ul>
            <p style={{ marginTop: 12 }}><strong>3. 관리자 / 파트너 계정 (해당 시)</strong></p>
            <ul>
              <li>이메일, 비밀번호(bcrypt 해시 저장), 권한 등급, 접속 일시 및 IP</li>
            </ul>
          </Section>

          <Section title="제3조 (개인정보의 보유 및 이용 기간)">
            회사는 법령에 따른 보유·이용 기간 또는 정보주체로부터 개인정보를 수집 시에 동의받은
            보유·이용 기간 내에서 개인정보를 처리·보유합니다.
            <ul>
              <li>상담/문의 데이터: 접수일로부터 <strong>3년</strong> 보유 후 파기</li>
              <li>관리자 발송 이력 (Outbox): 발송일로부터 <strong>1년</strong> 보유 후 파기</li>
              <li>접속기록 (audit log, PIPA §29 §6): <strong>1년 이상</strong> 보유</li>
              <li>관리자 / 파트너 계정 정보: 탈퇴·계약 종료 시 즉시 파기</li>
              <li>이용자가 삭제를 요청하면 즉시 파기 (단, 법령상 보존 의무가 있는 경우 해당 기간까지 보유)</li>
            </ul>
          </Section>

          <Section title="제4조 (개인정보의 제3자 제공)">
            회사는 정보주체의 개인정보를 제1조(개인정보의 처리 목적) 에서 명시한 범위 내에서만
            처리하며, 정보주체의 사전 동의·법률의 특별한 규정 등 PIPA 제17조 및 제18조에 해당하는
            경우에만 개인정보를 제3자에게 제공합니다.
            <p style={{ marginTop: 8, fontSize: 13, color: '#5f5b57' }}>
              현재 마케팅·광고 목적의 제3자 제공은 없습니다.
            </p>
          </Section>

          <Section title="제5조 (개인정보 처리의 위탁 및 국외이전)">
            회사는 원활한 서비스 운영을 위하여 다음과 같이 개인정보 처리 업무를 위탁하고 있으며,
            PIPA 제28-8조 (국외이전) 에 따라 5요소 (이전 국가 / 일시·방법 / 항목 / 목적 / 보유기간) 를 모두 고지합니다.
            <ul>
              <li>
                <strong>Resend, Inc. (이메일 발송)</strong>
                <ul style={{ marginTop: 4, paddingLeft: 18, fontSize: 13 }}>
                  <li>이전국가: 미국</li>
                  <li>이전일시 / 방법: 회신 메일 발송 시점, HTTPS API 호출</li>
                  <li>이전 항목: 수신자 이메일 주소, 회신 본문</li>
                  <li>처리 목적: 자동회신 / 관리자 회신 메일 발송</li>
                  <li>보유 기간: Resend 발송 로그 30일 / 본 서비스 Outbox 1년</li>
                </ul>
              </li>
              <li><strong>Render Services, Inc.</strong> · 미국 · 백엔드 / DB 호스팅 · 데이터 저장 기간 동안</li>
              <li><strong>Cafe24 (예정)</strong> · 한국 · 본 운영 시점 호스팅 · 데이터 저장 기간 동안</li>
              <li><strong>GitHub, Inc.</strong> · 미국 · 정적 페이지 호스팅 (개인정보 저장 없음)</li>
              <li><strong>Google LLC (Google Analytics 4)</strong> · 미국 · 익명 이용통계 · 14개월 (이용자가 동의한 경우)</li>
            </ul>
            그 외 어떠한 제3자에게도 개인정보를 제공하지 않으며, 광고/마케팅 목적의 자동 데이터 매매를 하지 않습니다.
          </Section>

          <Section title="제6조 (정보주체와 법정대리인의 권리·의무 및 행사 방법)">
            정보주체는 회사에 대해 언제든지 다음 각 호의 개인정보 보호 관련 권리를 행사할 수 있습니다.
            <ol>
              <li>개인정보 열람 요구 (PIPA §35)</li>
              <li>오류 등이 있을 경우 정정 요구 (PIPA §36)</li>
              <li>삭제 요구 (PIPA §36)</li>
              <li>처리정지 요구 (PIPA §37)</li>
              <li>개인정보의 이동 요구 (PIPA §35-2, 시행 시)</li>
            </ol>
            <p style={{ marginTop: 8 }}>
              권리 행사는 <a href="mailto:daemu_office@naver.com" style={{ textDecoration: 'underline' }}>daemu_office@naver.com</a> 또는 061-335-1239 로 접수하시면 지체 없이 (영업일 기준 5일 이내) 처리합니다.
              만 14세 미만 아동의 경우 법정대리인이 권리를 행사할 수 있으며, 이 경우 별도의 본인 확인 절차가 필요합니다.
            </p>
          </Section>

          <Section title="제7조 (개인정보의 파기)">
            회사는 개인정보 보유기간의 경과, 처리 목적의 달성 등 개인정보가 불필요하게 되었을 때에는
            지체 없이 해당 개인정보를 파기합니다.
            <p style={{ marginTop: 8 }}><strong>파기 절차</strong>: 파기 사유가 발생한 개인정보를 선정하고, 회사의 개인정보 보호책임자 승인을 받아 파기합니다.</p>
            <p><strong>파기 방법</strong>: 전자적 파일 형태는 복구·재생할 수 없도록 안전하게 삭제하며 (DELETE + 백업 매체 wipe), 종이 문서는 분쇄 또는 소각합니다.</p>
            <p style={{ fontSize: 13, color: '#5f5b57', marginTop: 6 }}>
              자동화 파기: 6시간마다 retention cron 실행 — inquiries 3년 / outbox 1년 초과 시 자동 삭제.
            </p>
          </Section>

          <Section title="제8조 (개인정보의 안전성 확보 조치)">
            회사는 PIPA 제29조에 따라 다음과 같이 안전성 확보에 필요한 기술적·관리적 및 물리적 조치를 하고 있습니다.
            <ol>
              <li><strong>관리적 조치</strong>: 내부관리계획 수립·시행, 정기적 직원 교육, 접근 권한 분리(관리자 / 테스트 / 개발 3단계)</li>
              <li>
                <strong>기술적 조치</strong>: 개인정보처리시스템 등의 접근 권한 관리,
                <ul>
                  <li>비밀번호 bcrypt 해싱 + 강도 검증 (8자 이상 / 영·숫·특 2종 이상)</li>
                  <li>JWT 토큰 12시간 만료</li>
                  <li>로그인 IP당 5회 실패 시 15분 잠금 (brute-force 방어)</li>
                  <li>고유식별정보 등의 암호화 (TLS / HTTPS)</li>
                  <li>접속기록의 보관 및 위·변조 방지 (audit_logs 테이블)</li>
                  <li>개인정보의 안전한 저장을 위한 백업·복구 절차</li>
                  <li>X-Content-Type-Options · X-Frame-Options · CSP · HSTS 헤더 적용</li>
                </ul>
              </li>
              <li><strong>물리적 조치</strong>: 데이터센터 출입통제 (Render / Cafe24 IDC 표준 적용)</li>
            </ol>
          </Section>

          <Section title="제9조 (개인정보 자동 수집 장치의 설치·운영 및 거부에 관한 사항)">
            <p><strong>1. 쿠키의 사용 목적</strong></p>
            회사는 이용자에게 개별적인 맞춤서비스를 제공하기 위해 이용 정보를 저장하고 수시로 불러오는
            '쿠키(cookie)'를 사용할 수 있습니다.
            <ul>
              <li><strong>필수 쿠키</strong>: 로그인 세션 유지 (관리자 로그인 시 JWT 저장 — localStorage 사용)</li>
              <li><strong>분석 쿠키</strong>: Google Analytics 4 — 이용자가 동의한 경우에만 설치</li>
            </ul>
            <p style={{ marginTop: 12 }}><strong>2. 쿠키 거부 방법</strong></p>
            이용자는 쿠키 설치에 대한 선택권을 가지고 있습니다. 본 사이트 하단의 동의 배너에서
            "거부" 를 선택하거나, 브라우저 설정에서 쿠키 저장을 거부할 수 있습니다.
            <ul style={{ fontSize: 13, color: '#5f5b57' }}>
              <li>Chrome: 설정 → 개인정보 보호 및 보안 → 쿠키 및 기타 사이트 데이터</li>
              <li>Edge: 설정 → 쿠키 및 사이트 권한</li>
              <li>Safari: 환경설정 → 개인정보 보호</li>
            </ul>
            ※ 쿠키 저장을 거부할 경우 일부 서비스 이용에 어려움이 있을 수 있습니다.
          </Section>

          <Section title="제10조 (행태정보의 수집·이용·제공 및 거부 등에 관한 사항)">
            회사는 온라인 맞춤형 광고 등을 위한 행태정보를 직접 수집하지 않습니다. Google Analytics 4 의
            이용자 행태 분석 기능은 사이트 분석 목적으로만 사용되며, 광고 식별자와 연결되지 않습니다.
            행태정보 수집·이용 거부는 위 제9조의 쿠키 거부 절차와 동일합니다.
          </Section>

          <Section title="제11조 (가명정보의 처리에 관한 사항)">
            회사는 현재 가명정보를 별도로 처리하고 있지 않습니다. 향후 통계작성·과학적 연구·공익적
            기록보존 등의 목적으로 가명정보를 처리하게 될 경우 PIPA 제28-2조 ~ 제28-7조 에 따라 별도로
            안내하고 본 방침을 개정할 예정입니다.
          </Section>

          <Section title="제12조 (만 14세 미만 아동의 개인정보 처리)">
            회사의 서비스는 B2B (사업자·법인) 대상이며, 만 14세 미만 아동을 직접 대상으로 하지 않습니다.
            만약 만 14세 미만 아동의 개인정보가 수집된 사실이 확인되면, 법정대리인의 동의 없이 즉시
            파기합니다 (PIPA §22-2).
          </Section>

          <Section title="제13조 (개인정보 보호책임자)">
            회사는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 개인정보 처리와 관련한 정보주체의
            불만처리 및 피해구제 등을 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.
            <ul style={{ marginTop: 8 }}>
              <li><strong>개인정보 보호책임자</strong></li>
              <li>· 직책: 대무 운영팀 책임자</li>
              <li>· 연락처: <a href="tel:0613351239" style={{ textDecoration: 'underline' }}>061-335-1239</a> · <a href="mailto:daemu_office@naver.com" style={{ textDecoration: 'underline' }}>daemu_office@naver.com</a></li>
            </ul>
          </Section>

          <Section title="제14조 (권익침해 구제방법)">
            정보주체는 개인정보침해로 인한 구제를 받기 위하여 개인정보분쟁조정위원회, 한국인터넷진흥원
            개인정보침해신고센터 등에 분쟁해결이나 상담 등을 신청할 수 있습니다.
            <ul style={{ marginTop: 8, fontSize: 13 }}>
              <li>개인정보분쟁조정위원회: <a href="https://kopico.go.kr" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>kopico.go.kr</a> · <a href="tel:1833-6972" style={{ textDecoration: 'underline' }}>1833-6972</a></li>
              <li>개인정보침해신고센터 (KISA): <a href="https://privacy.kisa.or.kr" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>privacy.kisa.or.kr</a> · <a href="tel:118" style={{ textDecoration: 'underline' }}>118</a></li>
              <li>대검찰청 사이버수사과: <a href="https://www.spo.go.kr" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>spo.go.kr</a> · <a href="tel:1301" style={{ textDecoration: 'underline' }}>1301</a></li>
              <li>경찰청 사이버수사국: <a href="https://ecrm.police.go.kr" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>ecrm.police.go.kr</a> · <a href="tel:182" style={{ textDecoration: 'underline' }}>182</a></li>
            </ul>
          </Section>

          <Section title="제15조 (개인정보처리방침의 변경)">
            본 방침은 시행일로부터 적용되며, 법령 및 방침에 따른 변경내용의 추가·삭제 및 정정이 있는
            경우에는 변경사항의 시행 7일 전부터 본 페이지의 상단 '시행일' 및 '버전' 을 통하여
            공지합니다. 단, 이용자 권리에 중요한 변경이 있는 경우 최소 30일 전에 공지합니다.
          </Section>

          <section style={{ marginTop: 40, padding: '18px 22px', background: '#f4f1eb', fontSize: 12, color: '#5f5b57', lineHeight: 1.7 }}>
            <strong style={{ color: '#222' }}>부칙</strong><br />
            본 방침은 2026년 4월 28일부터 시행됩니다.
          </section>
        </article>
      </section>
    </main>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: 17, marginBottom: 10, color: '#111', borderBottom: '1px solid #d7d4cf', paddingBottom: 6 }}>{title}</h2>
      <div style={{ paddingLeft: 4 }}>{children}</div>
    </section>
  );
}
