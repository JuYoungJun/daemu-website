// 관리자 메인(/admin) 전체 가이드 — 사이트 전체 어드민 흐름을 한 화면에서 안내.

import AdminGuideModal, { GuideSection, GuideTable, guideListStyle } from './AdminGuideModal.jsx';

export default function AdminMainGuide({ onClose }) {
  return (
    <AdminGuideModal title="대무 어드민 — 전체 사용 가이드" onClose={onClose}>

      <GuideSection title="이 콘솔은 무엇인가요?">
        <p>
          대무(DAEMU) 베이커리·카페 컨설팅 사이트의 운영 콘솔입니다. 콘텐츠·문의·발주·계약·캠페인·
          모니터링·사용자 권한까지 사이트 전체를 한 곳에서 관리합니다.
        </p>
        <p style={{ background: '#fafaf6', padding: '10px 14px', borderLeft: '3px solid #1f5e7c', fontSize: 12.5 }}>
          모든 페이지에는 우측 상단의 <strong>"사용 가이드 보기"</strong> 버튼이 있어 그 페이지의 자세한 사용법을 확인할 수 있습니다.
          본 가이드는 콘솔 전체의 큰 그림과 일일 운영 흐름을 다룹니다.
        </p>
      </GuideSection>

      <GuideSection title="역할(role)과 권한">
        <GuideTable
          headers={['역할', '한국어 라벨', '접근 가능한 메뉴']}
          rows={[
            ['admin', '슈퍼 관리자', '전체 — 모든 메뉴 + 사용자 권한 관리'],
            ['developer', '개발자', '콘텐츠/모니터링/메일/CRM 등. 사용자 관리 차단.'],
            ['tester', '서브 관리자', '대부분 읽기 전용. 팝업·문의·통계 등 운영 조회 권한.'],
          ]}
        />
        <p style={{ fontSize: 12.5, color: '#5a4a2a' }}>
          역할 변경은 <code>/admin/users</code> 에서 슈퍼 관리자만 가능합니다.
        </p>
      </GuideSection>

      <GuideSection title="메뉴 구조 — 어떤 일을 어디서 하나">
        <GuideTable
          headers={['업무', '메뉴']}
          rows={[
            ['사이트 본문 / 회사 소개 / 연혁 수정', '콘텐츠 관리'],
            ['포트폴리오(작업사례) 등록 / 정렬', '작업사례 관리'],
            ['Home 페이지의 협업 파트너사 로고', '함께하는 파트너사'],
            ['이미지 / 영상 업로드 + 라이브러리', '미디어 관리'],
            ['홈/소개/서비스 등 표시 팝업 배너', '팝업'],
            ['들어온 상담 문의 응대', '상담/문의 관리'],
            ['B2B 파트너 계정 발급 / 승인', '파트너 계정 관리'],
            ['파트너 발주 처리 + 상태 관리', '발주 관리'],
            ['파트너 포털 발주 카탈로그 + 재고', '발주 상품 관리'],
            ['이메일 자동회신 1개 템플릿', '메일 자동회신 설정'],
            ['여러 메일 템플릿 + 단체 발송', '메일 템플릿 라이브러리'],
            ['UTM 캠페인 URL + 단축 링크 + QR', 'UTM 빌더'],
            ['이메일 / SMS / 카카오 캠페인 발송', '캠페인'],
            ['쿠폰 / 이벤트 / 공지', '프로모션'],
            ['리드 → 고객 파이프라인 추적', 'CRM'],
            ['계약서 / 발주서 + e-Sign', '계약서 / 발주서'],
            ['모든 발송 이력 (이메일·SMS)', 'Outbox'],
            ['방문자 / UTM / 유입 채널 분석', '마케팅 분석'],
            ['백엔드 헬스 / API / 재고 / 이슈', '유지보수 모니터링'],
            ['어드민 계정 발급 / 권한', '사용자 권한 관리 (시스템)'],
            ['백엔드 API 문서', 'API 문서 (시스템)'],
          ]}
        />
      </GuideSection>

      <GuideSection title="권장 일일 운영 흐름">
        <ol style={guideListStyle}>
          <li><strong>모니터링</strong>(<code>/admin/monitoring</code>) — 백엔드 정상 / API 가용성 / 보안 위험도 / 재고 현황 / 이슈 0건 확인.</li>
          <li><strong>상담/문의</strong> — 신규 응대 (응답률 80% 유지가 목표).</li>
          <li><strong>발주</strong> — 신규/처리중 건 검토. 출고 완료 표시.</li>
          <li><strong>Outbox</strong> — 자동회신·캠페인 발송 정상 여부.</li>
          <li>(주 1회) <strong>마케팅 분석</strong> — UTM 캠페인 성과 + CSV 백업.</li>
        </ol>
      </GuideSection>

      <GuideSection title="CSV / 데이터 백업">
        <p>
          모든 어드민 페이지의 <strong>"CSV 내보내기"</strong> 버튼은 클릭 시 미리보기 모달을 띄워 컬럼/행/총 건수
          를 확인 후 다운로드합니다. UTF-8 BOM 포함이라 Excel/Numbers 한국어 정상 표시.
        </p>
        <ul style={guideListStyle}>
          <li><strong>저장 위치</strong> — 브라우저 기본 다운로드 폴더(보통 <code>~/Downloads</code>).
            변경하려면 브라우저 설정 →
            <ul style={{ paddingLeft: 22 }}>
              <li>Chrome/Edge: 설정 → 다운로드 → 위치</li>
              <li>Safari: 환경설정 → 일반 → 파일 다운로드 위치</li>
              <li>Firefox: 환경설정 → 일반 → 파일 및 응용 프로그램 → 다운로드</li>
            </ul>
          </li>
          <li><strong>파일명 prefix</strong> — 어드민 메인의 "CSV 파일명 설정" 칸에서 변경 가능.
            기본 <code>daemu-</code> 가 모든 export 파일 앞에 붙습니다.</li>
          <li><strong>백업 주기</strong> — 운영자 PC 가 단일 백업이라면 2주 이상 백업 안 하면 모니터링이 경고합니다.</li>
        </ul>
      </GuideSection>

      <GuideSection title="보안 운영 원칙">
        <ul style={guideListStyle}>
          <li>슈퍼 관리자 계정은 2FA 필수 활성화 — <em>2단계 인증</em> 버튼.</li>
          <li>비밀번호는 분기마다 변경 권장. 60분 미사용 시 자동 로그아웃.</li>
          <li>의심 IP(인증 실패 3회+) 가 모니터링에 표시되면 즉시 점검.</li>
          <li>모든 사용자/권한 변경은 백엔드 audit_logs 에 자동 기록.</li>
          <li>외부 PC 에서 로그인 했다면 작업 후 반드시 명시적 로그아웃.</li>
        </ul>
      </GuideSection>

      <GuideSection title="문제가 생겼을 때">
        <ol style={guideListStyle}>
          <li>어드민 페이지가 500 — 새 빌드 deploy 직후 옛 chunk 캐시일 가능성. <strong>Cmd+Shift+R(맥)/Ctrl+Shift+R(윈)</strong> 로 강제 새로고침.</li>
          <li>모니터링에 발송 실패가 누적 — Resend API 키 / 도메인 인증 점검.</li>
          <li>백엔드 응답이 느림 — Render free tier cold-start. 첫 요청은 30초 가능. 외부 cron(UptimeRobot 등) 등록 권장.</li>
          <li>그 외 — 모니터링의 운영자 진단 정보(<code>window.__daemu_lastError</code>) + 이슈 피드 CSV 를 daemu_office@naver.com 으로 전달.</li>
        </ol>
      </GuideSection>

    </AdminGuideModal>
  );
}
