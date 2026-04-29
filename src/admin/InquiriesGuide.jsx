// 상담/문의 관리 사용 가이드.

import AdminGuideModal, { GuideSection, GuideTable, guideListStyle } from './AdminGuideModal.jsx';

export default function InquiriesGuide({ onClose }) {
  return (
    <AdminGuideModal title="상담 / 문의 관리 — 사용 가이드" onClose={onClose}>

      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          홈페이지 <code>/contact</code> 폼과 사이트 곳곳의 상담 신청 폼을 통해 들어온 모든 문의를 한 곳에서 관리합니다.
          백엔드 DB(<code>/api/inquiries</code>) 와 동기화되며, Render free tier 가 슬립으로 휘발됐을 때를 대비해
          브라우저 localStorage 에도 캐시 사본을 보관합니다.
        </p>
      </GuideSection>

      <GuideSection title="상태 흐름 — 신규 → 처리중 → 답변완료">
        <GuideTable
          headers={['상태', '의미', '다음 액션']}
          rows={[
            ['신규', '아직 한 번도 응대하지 않은 문의', '내용 확인 → 답변 작성 또는 처리중 표시'],
            ['처리중', '내부에서 검토 중 / 추가 자료 요청 등', '확인이 끝나면 답변완료'],
            ['답변완료', '회신 메일까지 발송 완료된 문의', '아카이브 (삭제는 권장하지 않음)'],
          ]}
        />
        <p style={{ fontSize: 12.5, color: '#5a4a2a', background: '#fff8ec', padding: '10px 14px', borderLeft: '3px solid #c9a25a' }}>
          <strong>응답률 KPI</strong> 는 모니터링 페이지에서 자동 집계됩니다. 80% 이상 유지가 운영 목표.
        </p>
      </GuideSection>

      <GuideSection title="3단계 응대 절차">
        <ol style={guideListStyle}>
          <li><strong>신규 필터</strong>로 미응대 문의를 빠르게 추리고, 행 클릭으로 상세 내용을 확인합니다.</li>
          <li><strong>회신 작성</strong> — 메일 자동회신과는 별개로, 운영자가 개인화된 답변을 직접 작성해 발송할 수 있습니다.</li>
          <li><strong>상태 변경</strong> — 발송 후 "답변완료"로 전환. 회신메모(<code>reply</code>) 칸에 내부 메모도 남길 수 있습니다.</li>
        </ol>
      </GuideSection>

      <GuideSection title="자동회신과의 차이">
        <ul style={guideListStyle}>
          <li><strong>자동회신</strong>(<code>/admin/mail</code>) — 문의 접수 즉시 시스템이 자동 발송. 1개의 템플릿만 사용. 카테고리별 분기 가능.</li>
          <li><strong>본 페이지 회신</strong> — 사람이 직접 검토 후 발송. 자동회신 후의 후속 응대.</li>
          <li>두 가지를 함께 운영하면 빠른 응답성(자동회신) + 정성스러운 응대(직접 회신) 두 가지를 모두 잡을 수 있습니다.</li>
        </ul>
      </GuideSection>

      <GuideSection title="검색 / 필터 / CSV 내보내기">
        <ul style={guideListStyle}>
          <li><strong>검색</strong> — 이름·이메일·전화·카테고리·내용 등 모든 필드를 동시에 검사.</li>
          <li><strong>상태 필터</strong> — 신규 / 처리중 / 답변완료 토글.</li>
          <li><strong>CSV 내보내기</strong> — 미리보기로 컬럼/행 확인 후 다운로드. 월간 보고서·정리에 활용.</li>
        </ul>
      </GuideSection>

      <GuideSection title="개인정보 처리 (PIPA)">
        <p>
          문의자의 이름·연락처·이메일은 PIPA(개인정보보호법) 처리 대상입니다.
          본 사이트는 다음 정책으로 운영합니다:
        </p>
        <ul style={guideListStyle}>
          <li>수집 목적: 상담 응대 + 발주 연결.</li>
          <li>보관 기간: <strong>3년</strong> (전자상거래법 — 소비자 불만/분쟁 처리 의무 기간).</li>
          <li>삭제: 보관기간 경과 또는 본인 요청 시. 본 페이지에서 즉시 삭제 가능.</li>
          <li>제3자 제공: 없음. 백엔드(Render) 에만 저장되며, 외부 마케팅 도구로 흘러가지 않습니다.</li>
        </ul>
      </GuideSection>

      <GuideSection title="Render 휘발 대비 캐시">
        <p>
          백엔드(<code>daemu-py.onrender.com</code>) 가 free tier 라 일정 기간 트래픽이 없으면 SQLite 가 휘발될 수 있습니다.
          본 페이지는 백엔드 응답이 빈 배열일 때 localStorage 캐시를 보여주고 상단에 안내 배너를 표시합니다 — 가짜 비어있음으로
          오인하지 않도록 디자인되어 있습니다. 운영 단계 이전 시 카페24 VPS / paid 백엔드로 옮기는 것을 권장합니다.
        </p>
      </GuideSection>

    </AdminGuideModal>
  );
}
