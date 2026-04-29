// 유지보수 모니터링 사용 가이드.

import AdminGuideModal, { GuideSection, GuideTable, guideListStyle } from './AdminGuideModal.jsx';

export default function MonitoringGuide({ onClose }) {
  return (
    <AdminGuideModal title="유지보수 모니터링 — 사용 가이드" onClose={onClose}>

      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          사이트 전체의 운영 상태를 한 화면에서 점검합니다. 백엔드 헬스, API 가용성, 발송 실패, 보안 이상 징후,
          비즈니스 데이터 KPI, 콘텐츠 누락, 스토리지 사용량, 백업 상태 등을 자동으로 집계해 보여줍니다.
        </p>
        <p style={{ background: '#fafaf6', padding: '10px 14px', borderLeft: '3px solid #1f5e7c', fontSize: 12.5 }}>
          모든 지표는 자동 갱신됩니다 — 백엔드 헬스/API probe 는 1분 주기, 나머지는 페이지 진입 시 + 이벤트 발생 시 즉시.
        </p>
      </GuideSection>

      <GuideSection title="패널 구성 (위에서 아래로)">
        <GuideTable
          headers={['패널', '용도', '확인 포인트']}
          rows={[
            ['백엔드 상태 카드', 'DB 응답시간 / 이메일 provider', 'DB 응답 100ms 이하 정상, 500ms+ 콜드 또는 부하'],
            ['보안 위험도', '의심 IP / 인증 실패 빈도', 'high 면 즉시 fail2ban / rate limit 점검'],
            ['API 엔드포인트 상태', '12개 핵심 GET 라우트 1분 probe', 'AUTH 는 권한 없을 때 정상 / 5xx 는 진짜 장애'],
            ['API 호출 에러율', 'outbox 1h/24h/7d 윈도우', '3% 이상이면 점검, 10%+ 면 critical'],
            ['실패 빈도 상위 endpoint', '24h 가장 자주 실패한 라우트 top 5', '특정 라우트에 몰려있다면 코드/DB 점검'],
            ['최근 24시간', '이메일 발송/문의/실패 카운트', '발송 실패 0 유지가 운영 목표'],
            ['비즈니스 데이터', '활성 파트너 / 뉴스레터 / 누적 발송', '주간 추이 추적'],
            ['문의 응답 KPI (30d)', '신규/처리중/답변완료 + 응답률', '응답률 80%+ 유지'],
            ['콘텐츠 건강도', '히어로 누락·이미지 없는 상품 등', '0 유지가 콘텐츠 완성도'],
            ['스토리지 사용량', 'localStorage daemu_* 키 합계', '4MB 이상이면 정리 권장'],
            ['데이터 백업 상태', '마지막 CSV 내보내기 시각', '2주 이상 안 했으면 실시 권장'],
            ['최근 활동 타임라인', 'outbox + analytics 30건', '운영 흐름 한눈에 파악'],
            ['이슈 피드 (graded)', 'critical/high/medium/low/info', '클릭하면 상세 모달 + 해결 표시'],
          ]}
        />
      </GuideSection>

      <GuideSection title="API 엔드포인트 상태 — 색상 의미">
        <ul style={guideListStyle}>
          <li><span style={{ color: '#2e7d32', fontWeight: 600 }}>녹색 (200ms 이하)</span> — 정상.</li>
          <li><span style={{ color: '#b87333', fontWeight: 600 }}>주황 (200~1000ms / AUTH / 4xx)</span> — 느림 또는 권한 부족. AUTH 는 슈퍼 관리자 아닐 때 자연스러운 표시.</li>
          <li><span style={{ color: '#c0392b', fontWeight: 600 }}>빨강 (1초+/ERR/5xx)</span> — 장애 신호. 즉시 백엔드 로그 확인.</li>
        </ul>
        <p style={{ fontSize: 12.5, color: '#5a4a2a' }}>
          최근 10회 평균 latency 와 실패율도 같이 표시됩니다 — 일시적 지연인지 지속 문제인지 판별.
        </p>
      </GuideSection>

      <GuideSection title="이슈 피드 (Issue Feed) 다루기">
        <ul style={guideListStyle}>
          <li><strong>severity 분류</strong> — outbox 발송 실패는 medium, login/payment 경로 실패는 critical, runtime error 는 메시지 기반 자동 판정.</li>
          <li><strong>severity 필터</strong> 칩 클릭 → 해당 등급만.</li>
          <li><strong>검색</strong> — 제목/요약 동시 검사.</li>
          <li><strong>해결 표시</strong> — 처리한 이슈는 토글로 숨김 → 신규/미해결만 보기 좋아짐. 다시 보고 싶으면 "해결 표시 항목 포함" 체크.</li>
          <li><strong>이슈 CSV</strong> — 미리보기로 컬럼/행 확인 후 다운로드. 보고/장애 사후분석 자료. 비밀번호/토큰류는 자동 [REDACTED].</li>
        </ul>
      </GuideSection>

      <GuideSection title="보안 이상 징후 — 어떻게 대응하나">
        <ul style={guideListStyle}>
          <li><strong>의심 IP (1시간 인증 실패 3건+)</strong> — 무차별 대입 시도 가능성.</li>
          <li><strong>5분 인증 실패 폭증</strong> — DDoS 또는 분산 공격 신호.</li>
          <li><strong>위험도 high</strong> 가 뜨면: ① 카페24 운영자 패널에서 fail2ban 정책 확인 ② backend ALLOWED_ORIGINS 점검 ③ rate limit 강화.</li>
          <li>위험도 medium 은 모니터링만으로 충분 — 사용자 본인이 비밀번호 잊어 여러 번 시도한 케이스도 포함.</li>
        </ul>
      </GuideSection>

      <GuideSection title="Render free tier 슬립 / cold-start">
        <p>
          백엔드(daemu-py.onrender.com) 는 free tier 라 15분간 트래픽이 없으면 슬립으로 들어갑니다.
          첫 요청은 cold-start 로 30초+ 걸릴 수 있습니다. GitHub Actions cron + 5분 동안 30초 ping 으로 슬립 회피 중이지만,
          실제 차이는 외부 무료 ping 서비스(UptimeRobot 등) 등록을 강하게 권장합니다.
        </p>
      </GuideSection>

      <GuideSection title="권장 일일 체크리스트">
        <ol style={guideListStyle}>
          <li>이슈 피드에 critical/high 가 없는지.</li>
          <li>API 엔드포인트 상태 모두 녹색인지(AUTH 는 무시).</li>
          <li>24시간 발송 실패 0 인지.</li>
          <li>보안 위험도 정상인지.</li>
          <li>신규 문의에 미응답이 5건 넘지 않는지.</li>
        </ol>
      </GuideSection>

    </AdminGuideModal>
  );
}
