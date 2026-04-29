// 계약서 / 발주서 관리 사용 가이드.

import AdminGuideModal, { GuideSection, GuideTable, guideListStyle } from './AdminGuideModal.jsx';

export default function ContractsGuide({ onClose }) {
  return (
    <AdminGuideModal title="계약서 / 발주서 — 사용 가이드" onClose={onClose}>

      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          표준 계약서·발주서·NDA 등 문서를 템플릿으로 등록하고, 고객·프로젝트별로 변수를 채워 PDF로 발급합니다.
          이메일로 서명 링크를 보내 고객이 캔버스 e-Sign 으로 서명하면 감사 이력과 함께 보관됩니다.
        </p>
      </GuideSection>

      <GuideSection title="3가지 작업 흐름">
        <ol style={guideListStyle}>
          <li><strong>표준 양식에서 만들기</strong> — 등록된 템플릿(NDA / 발주계약 / 컨설팅계약 / 메뉴개발계약 / 운영자문계약 등) 중 선택 → 변수 입력 → 미리보기 → 저장.</li>
          <li><strong>PDF 직접 업로드</strong> — 외부에서 만든 PDF 를 그대로 업로드. 페이지 위에 서명 영역만 지정해 e-Sign 가능.</li>
          <li><strong>이메일 발송</strong> — 고객 메일 주소 입력 후 발송. 고유 서명 링크가 포함된 메일이 전달됩니다.</li>
        </ol>
      </GuideSection>

      <GuideSection title="변수 시스템 — 한 번 만들면 재사용">
        <p>
          템플릿 본문에 <code>{`{{고객사명}}`}</code> <code>{`{{프로젝트명}}`}</code> <code>{`{{계약금액}}`}</code> 같은 placeholder 를 넣으면,
          문서 발급 화면에서 한 번에 채울 수 있습니다. 같은 템플릿을 여러 고객에게 재사용하기 편합니다.
        </p>
        <ul style={guideListStyle}>
          <li>금액 변수는 자동으로 한국 통화(₩) 포맷이 적용됩니다.</li>
          <li>날짜는 YYYY-MM-DD 또는 한국식(2026년 4월 29일) 둘 다 인식.</li>
          <li>전화번호는 02-/010-/1588- 등 자동 하이픈.</li>
          <li>사업자등록번호는 000-00-00000 형식 자동 검증.</li>
        </ul>
      </GuideSection>

      <GuideSection title="문서 상태 흐름">
        <GuideTable
          headers={['상태', '의미', '다음 액션']}
          rows={[
            ['draft', '작성 중 — 미발송', '내용 검토 후 발송'],
            ['sent', '고객에게 메일 발송됨, 서명 대기', '고객 응답 대기 / 필요시 재발송'],
            ['signed', '고객이 서명 완료', 'PDF 다운로드 후 보관'],
            ['archived', '아카이브됨 — 더 이상 활성 처리 안 함', '필요시 unarchive'],
          ]}
        />
      </GuideSection>

      <GuideSection title="e-Sign 보안">
        <ul style={guideListStyle}>
          <li><strong>고유 서명 링크</strong> — HMAC 서명된 토큰으로, 추측·재사용 불가.</li>
          <li><strong>서명 시 IP / UA / 시각 기록</strong> — 분쟁 시 위변조 여부 검증 자료.</li>
          <li><strong>서명 후 잠금</strong> — 서명된 문서는 어드민도 수정할 수 없음. 변경이 필요하면 새 버전 발행.</li>
          <li><strong>PDF 출력</strong> — 브라우저 인쇄 → PDF 저장. 출력에는 감사 이력(서명 시각·IP)이 마지막 페이지에 포함됩니다.</li>
        </ul>
      </GuideSection>

      <GuideSection title="표준 템플릿 5종">
        <p>본 사이트에서 자주 쓰는 양식이 미리 등록되어 있습니다:</p>
        <ul style={guideListStyle}>
          <li><strong>NDA (비밀유지계약)</strong> — 신규 파트너/외주 시 1순위.</li>
          <li><strong>컨설팅 계약서</strong> — 메뉴 개발/공간 컨설팅 등.</li>
          <li><strong>발주서 (Purchase Order)</strong> — 파트너사에 발주 시.</li>
          <li><strong>메뉴 개발 계약</strong> — 카페/베이커리 메뉴 개발 프로젝트 전용.</li>
          <li><strong>운영 자문 계약</strong> — 정기 운영 컨설팅(월별 자문).</li>
        </ul>
        <p style={{ fontSize: 12.5, color: '#5a4a2a' }}>
          모두 표준 양식 기준이며, 필요시 변수로 조항을 추가/수정할 수 있습니다.
        </p>
      </GuideSection>

      <GuideSection title="PDF 직접 업로드 (외부 양식 사용 시)">
        <p>
          이미 외부 도구(아래아한글·Word·법무팀 양식)로 만든 PDF 가 있다면 그대로 업로드해서 e-Sign 만 받을 수 있습니다.
          업로드 후 페이지 위에 서명 영역(드래그) 만 지정하면 같은 흐름으로 발송 가능.
        </p>
      </GuideSection>

      <GuideSection title="검색 / 필터 / CSV 내보내기">
        <ul style={guideListStyle}>
          <li>제목·고객사·프로젝트명 검색.</li>
          <li>상태 필터 + 기간 필터(작성일 / 서명일).</li>
          <li>CSV 내보내기 — 분기 보고용 통계 자료. 미리보기 모달에서 컬럼·행 확인 후 다운로드.</li>
        </ul>
      </GuideSection>

    </AdminGuideModal>
  );
}
