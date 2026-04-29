// 사용자 권한 관리 사용 가이드.

import AdminGuideModal, { GuideSection, GuideTable, guideListStyle } from './AdminGuideModal.jsx';

export default function UsersGuide({ onClose }) {
  return (
    <AdminGuideModal title="사용자 권한 관리 — 사용 가이드" onClose={onClose}>

      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          어드민 콘솔에 접근할 수 있는 계정을 발급/수정/삭제합니다. 일반 방문자(고객·파트너)와는 분리된 별도의 사용자 풀이며,
          여기 등록된 계정만 <code>/admin</code> 진입이 가능합니다.
        </p>
        <p style={{ background: '#fff0ec', padding: '10px 14px', borderLeft: '3px solid #c0392b', fontSize: 12.5 }}>
          <strong>슈퍼 관리자만 접근 가능</strong> — 본 페이지는 시스템 권한이 변경되는 곳이라 admin 역할만 들어올 수 있습니다.
        </p>
      </GuideSection>

      <GuideSection title="역할(role) 3종">
        <GuideTable
          headers={['역할', '한국어 라벨', '권한']}
          rows={[
            ['admin', '슈퍼 관리자', '전체 — 사용자/시스템 설정/시크릿 포함 모든 메뉴'],
            ['developer', '개발자', '콘텐츠/모니터링/메일 템플릿 등. 사용자 관리 차단.'],
            ['tester', '서브 관리자', '대부분 읽기 전용. 팝업 등록/문의 모니터링 가능.'],
          ]}
        />
      </GuideSection>

      <GuideSection title="신규 계정 발급">
        <ol style={guideListStyle}>
          <li>우측 상단 <em>+ 신규 사용자</em> 클릭.</li>
          <li>이메일·이름·역할·임시 비밀번호 입력. <code>must_change_password</code> 가 기본 ON 으로, 첫 로그인 시 강제 변경 화면이 뜹니다.</li>
          <li>저장 후 사용자에게 임시 비밀번호를 별도 채널(전화·SMS)로 전달. 이메일에 비밀번호를 적어 보내지 마세요.</li>
        </ol>
      </GuideSection>

      <GuideSection title="보안 운영 액션 (행 클릭 → 상세 모달)">
        <ul style={guideListStyle}>
          <li><strong>비밀번호 리셋</strong> — 새 임시 비밀번호 발급 + must_change_password=true. 분실/유출 의심 시.</li>
          <li><strong>이메일 인증 재요구</strong> — email_verified_at 을 null 로 만들어 다음 로그인 때 인증 메일 재발송.</li>
          <li><strong>2FA 강제 해제</strong> — TOTP 디바이스 분실 시. 사용자가 다시 등록하도록 처리.</li>
          <li><strong>계정 비활성화 / 삭제</strong> — 퇴사·해지 시. 활성=false 면 로그인 즉시 거부.</li>
        </ul>
        <p style={{ fontSize: 12.5, color: '#5a4a2a', background: '#fff8ec', padding: '10px 14px', borderLeft: '3px solid #c9a25a' }}>
          <strong>자기 계정 보호</strong> — 본인이 본인의 권한을 강등하거나 본인을 삭제할 수 없습니다(셀프 록아웃 방지).
        </p>
      </GuideSection>

      <GuideSection title="KPI 카드 7종">
        <ul style={guideListStyle}>
          <li>전체 사용자 수 / 활성 / 슈퍼 관리자 / 비밀번호 변경 대기 / 이메일 미인증 / 2FA 활성 / 최근 7일 신규.</li>
          <li>대기 항목이 많으면 운영 점검 필요 — 비밀번호 변경 대기 자가 많으면 신규 계정 발급 후 안내 누락 의심.</li>
        </ul>
      </GuideSection>

      <GuideSection title="bulk 액션">
        <ul style={guideListStyle}>
          <li>행 체크박스 → 다중 선택 → 우상단 <em>선택 비활성화 / 삭제</em>.</li>
          <li>대량 정리 시 유용. 삭제는 되돌릴 수 없으니 비활성화부터 먼저 시도하는 것을 권장.</li>
        </ul>
      </GuideSection>

      <GuideSection title="감사 로그 (audit log)">
        <p>
          모든 사용자 변경(생성/수정/삭제/권한 변경/비밀번호 리셋)은 백엔드 <code>audit_logs</code> 테이블에 자동 기록됩니다.
          누가 언제 어떤 사용자에 대해 어떤 변경을 했는지 추적 가능. 보안 사고 발생 시 forensic 자료.
        </p>
      </GuideSection>

    </AdminGuideModal>
  );
}
