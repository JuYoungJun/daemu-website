// 어드민 페이지별 사용 가이드 — 짧고 핵심만 (3~5 섹션).
//
// 큰 페이지(MailTemplates / UtmBuilder / Inquiries / Users / Contracts /
// Monitoring) 는 별도 파일로 분리되어 있고, 본 파일은 비교적 단순한 페이지
// (RawPage 기반 + Outbox/PartnerBrands/Products/Analytics) 의 가이드를
// 한 곳에 묶어 관리한다.

import { useState } from 'react';
import AdminGuideModal, { GuideSection, GuideTable, guideListStyle } from './AdminGuideModal.jsx';

// 가이드 버튼 + 모달 상태를 한 컴포넌트로 묶음. 각 어드민 페이지에서
// <GuideButton GuideComponent={WorksGuide} /> 한 줄만 호출하면 우하단에
// floating 으로 가이드 버튼이 표시된다. 모든 페이지에서 동일한 위치라
// 사용자 학습 비용이 0.
export function GuideButton({ GuideComponent }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="adm-floating-guide-btn"
        title="현재 페이지 사용 가이드 보기">
        <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>?</span>
        <span>사용 가이드</span>
      </button>
      {open && <GuideComponent onClose={() => setOpen(false)} />}
    </>
  );
}

// ───────── 콘텐츠 / 작업사례 / 미디어 ─────────

export function ContentGuide({ onClose }) {
  return (
    <AdminGuideModal title="콘텐츠 관리 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          홈·소개·서비스·연혁·프로세스 등 <strong>사이트 전반의 텍스트 콘텐츠</strong>를 코드 수정 없이 바꿀 수 있는 페이지입니다.
          저장 즉시 사이트에 반영됩니다.
        </p>
      </GuideSection>
      <GuideSection title="3단계 흐름">
        <ol style={guideListStyle}>
          <li>좌측 영역에서 수정할 섹션을 선택 (예: <em>회사 소개</em>, <em>연혁</em>).</li>
          <li>본문/제목을 직접 편집. 줄바꿈은 그대로 반영됩니다.</li>
          <li><em>저장</em> → 사이트의 해당 섹션이 즉시 갱신.</li>
        </ol>
      </GuideSection>
      <GuideSection title="자주 하는 실수">
        <ul style={guideListStyle}>
          <li>이미지 변경은 본 페이지가 아니라 <code>/admin/media</code> 에서. 미디어 라이브러리 → 사용처 연결 형태.</li>
          <li>회사 소개·연혁은 SEO 영향 큼. 핵심 키워드(베이커리·카페 컨설팅) 유지 권장.</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function WorksGuide({ onClose }) {
  return (
    <AdminGuideModal title="작업사례 관리 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          <code>/work</code> 포트폴리오에 노출되는 작업사례를 등록·수정·정렬합니다.
          브랜드(Beclassy/Pumjang/Morif/기타) 별로 그룹화되어 표시됩니다.
        </p>
      </GuideSection>
      <GuideSection title="등록 시 필수 항목">
        <ul style={guideListStyle}>
          <li><strong>제목 / slug</strong> — slug 는 URL(<code>/work/&#123;slug&#125;</code>)에 들어가는 영문 식별자. 한 번 설정 후엔 SEO 영향 때문에 가급적 변경 금지.</li>
          <li><strong>카테고리</strong> — 브랜드 또는 BRANCHES/EXECUTION 분류.</li>
          <li><strong>히어로 이미지</strong> — 모바일에서도 잘 보이는 가로형 권장.</li>
          <li><strong>요약 (summary)</strong> — 메타 description 으로도 사용. 100자 내외.</li>
        </ul>
      </GuideSection>
      <GuideSection title="발행/숨김 + 정렬">
        <ul style={guideListStyle}>
          <li><em>published</em> 토글 — 저장만 해두고 나중에 공개할 수도.</li>
          <li><em>sort_order</em> — 작은 수가 먼저. 같으면 최신 등록 우선.</li>
          <li>비공개/임시 사례는 <em>published=false</em> 로 보존하면 운영자만 볼 수 있습니다.</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function MediaGuide({ onClose }) {
  return (
    <AdminGuideModal title="미디어 관리 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          이미지·영상을 한 곳에 업로드해 두고 작업사례·팝업·이벤트·메일 템플릿 등에서 재사용합니다.
          브라우저에서 자동 압축 후 base64 또는 백엔드 업로드 경로를 통해 저장됩니다.
        </p>
      </GuideSection>
      <GuideSection title="업로드 가이드">
        <ul style={guideListStyle}>
          <li><strong>이미지</strong>: JPG/PNG/WebP. 5MB 초과 시 자동 압축. 가로 1200~1600px 권장.</li>
          <li><strong>영상</strong>: MP4 권장. 30MB 초과는 외부 호스팅(YouTube/Vimeo) 권장.</li>
          <li>업로드 후 어디든 <em>미디어 선택</em> 다이얼로그에서 즉시 사용 가능.</li>
        </ul>
      </GuideSection>
      <GuideSection title="저장 위치 / 보안">
        <ul style={guideListStyle}>
          <li>현재는 base64 인코딩 후 localStorage 또는 백엔드 DB 에 저장.</li>
          <li>외부 CDN 으로 마이그레이션 시 <code>safeMediaUrl()</code> 가 src 검증을 자동 수행.</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}

// ───────── 파트너 / 발주 ─────────

export function PartnersGuide({ onClose }) {
  return (
    <AdminGuideModal title="파트너 계정 관리 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          B2B 파트너사 계정을 발급/승인/비활성화합니다. 파트너 포털(<code>/partners</code>) 로그인에 사용됩니다.
        </p>
      </GuideSection>
      <GuideSection title="역할 (role)">
        <GuideTable
          headers={['역할', '의미']}
          rows={[
            ['발주 전용', '발주 페이지에서 주문/내역 조회만 가능'],
            ['관리', '파트너 본인 회사 정보 수정 가능'],
            ['협력업체', '특정 카테고리 발주 권한'],
          ]}
        />
      </GuideSection>
      <GuideSection title="활성/비활성">
        <ul style={guideListStyle}>
          <li>비활성 = 즉시 로그인 차단. 데이터는 보존.</li>
          <li>해지 의심 / 결제 누락 시 비활성화 후 협의.</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function PartnerBrandsGuide({ onClose }) {
  return (
    <AdminGuideModal title="함께하는 파트너사 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          홈페이지 하단의 <em>"함께하는 파트너사"</em> 섹션에 노출되는 협업 파트너 로고를 관리합니다.
          파트너 계정(<code>/admin/partners</code>) 과는 다른 — 사이트 표시용 로고 관리 페이지입니다.
        </p>
      </GuideSection>
      <GuideSection title="등록 시">
        <ul style={guideListStyle}>
          <li>로고 — 투명 PNG/SVG 권장. 흰 배경 위에서도 잘 보이는 대비.</li>
          <li>외부 링크 — 파트너 홈페이지 URL. <code>safeUrl</code> 통과 후 <code>rel=noopener</code> 적용.</li>
          <li>노출 토글 + 순서 조정 — 즉시 사이트 반영.</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function OrdersGuide({ onClose }) {
  return (
    <AdminGuideModal title="발주 관리 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          파트너의 발주를 접수·처리·출고완료 상태로 관리합니다. 신규 발주 저장 시 <strong>발주번호(PO)</strong>가 자동 생성됩니다.
        </p>
      </GuideSection>
      <GuideSection title="발주번호 / 재고 차감 자동화">
        <ul style={guideListStyle}>
          <li>신규 발주 저장 시 <code>DM-PO-2026-0042</code> 형식으로 PO 가 자동 부여됩니다.</li>
          <li>상품 필드에 SKU 형식(<code>BAKERY-001</code> 등) 이 들어 있으면 입력한 수량만큼 재고가 자동 차감됩니다.</li>
          <li>재고 부족 시: 발주는 저장되지만 차감은 실패. 알림이 표시됩니다.</li>
        </ul>
      </GuideSection>
      <GuideSection title="상태 흐름">
        <ol style={guideListStyle}>
          <li><strong>접수</strong> — 신규 발주, 검토 전.</li>
          <li><strong>처리중</strong> — 발주서 발송·생산·포장 중.</li>
          <li><strong>출고완료</strong> — 배송이 출발한 시점.</li>
        </ol>
      </GuideSection>
      <GuideSection title="문서 발송 (계약서·발주서)">
        <p>
          발주에 계약서/발주서 첨부가 있으면 <em>계약서 발송 / 발주서 발송</em> 버튼이 보입니다. 클릭 시
          파트너 이메일로 PDF + 서명 링크가 전송됩니다.
        </p>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function ProductsGuide({ onClose }) {
  return (
    <AdminGuideModal title="발주 상품 관리 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          파트너 포털에 노출되는 발주 카탈로그(카테고리·상품·가격·이미지·재고)를 관리합니다.
        </p>
      </GuideSection>
      <GuideSection title="SKU 자동 생성">
        <ul style={guideListStyle}>
          <li>신규 등록 모달에서 <em>자동 생성</em> 버튼 → 카테고리별 다음 SKU 부여 (예: <code>BAKERY-001</code>, <code>EVENT-005</code>).</li>
          <li>SKU 는 등록 후 변경 불가 — 발주/재고 추적이 SKU 기준이라 일관성 유지 필수.</li>
        </ul>
      </GuideSection>
      <GuideSection title="재고 추적">
        <ul style={guideListStyle}>
          <li>등록 시 초기 재고 입력 → 발주 페이지에서 주문 수량만큼 자동 차감.</li>
          <li>재고 10 미만 = <span style={{ color: '#b87333' }}><strong>부족</strong></span> · 0 = <span style={{ color: '#c0392b' }}><strong>품절</strong></span> 컬러 표시.</li>
          <li>재입고는 상품 수정 → 재고 칸 직접 변경 (이력은 <code>daemu_stock_ledger</code> 에 자동 기록).</li>
          <li>모니터링 페이지의 <em>재고 현황</em> 패널에서 부족·품절 SKU 한눈에 확인.</li>
        </ul>
      </GuideSection>
      <GuideSection title="이미지 / 단위 / 가격">
        <ul style={guideListStyle}>
          <li>이미지 없으면 이모지로 대체 표시 (기본 📦). 미디어 라이브러리에서 선택.</li>
          <li>단위 표기 — <em>100g · 1kg · 500ea</em> 같은 명확한 단위.</li>
          <li>가격은 자동 통화 포맷 — 원화 표기.</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}

// ───────── 통계 / 분석 / 발송 ─────────

export function StatsGuide({ onClose }) {
  return (
    <AdminGuideModal title="통계 / 리포트 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          방문자·문의·발주 등 주요 운영 지표를 한눈에 보는 페이지입니다. 자체 분석 데이터(localStorage)와
          백엔드 집계 데이터를 병합해 표시합니다.
        </p>
      </GuideSection>
      <GuideSection title="더 자세한 분석은">
        <ul style={guideListStyle}>
          <li><code>/admin/analytics</code> — 마케팅 분석(UTM·유입경로·세션) 전용. CSV 내보내기 가능.</li>
          <li><code>/admin/monitoring</code> — 운영(API 가용성·에러율·재고·이슈) 전용.</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function AnalyticsGuide({ onClose }) {
  return (
    <AdminGuideModal title="마케팅 분석 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          페이지뷰·체류시간·UTM 캠페인·기기·유입 채널을 자동 집계합니다. 외부 도구(GA4 등) 없이
          브라우저 자체 트래킹(<code>lib/marketingAnalytics.js</code>) 로 동작 → 무료·개인정보 안전.
        </p>
      </GuideSection>
      <GuideSection title="UTM 캠페인 추적">
        <p>
          <code>/admin/utm-builder</code> 에서 만든 UTM 링크로 들어온 방문자가 자동 집계됩니다. utm_source·
          utm_campaign 별 카운트 + 전환율(CTA 클릭·폼 제출).
        </p>
      </GuideSection>
      <GuideSection title="KPI 비교">
        <ul style={guideListStyle}>
          <li>전 기간 vs 직전 기간 대비 % 변동을 자동 표시.</li>
          <li>Insight strip — 가장 큰 변화·주목할 채널을 자동으로 강조.</li>
          <li>CSV 내보내기로 월간 리포트 만들기 좋습니다.</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function MailGuide({ onClose }) {
  return (
    <AdminGuideModal title="메일 자동회신 설정 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          상담 폼에서 문의 접수 시 <strong>즉시 자동 발송</strong>되는 회신 메일을 관리합니다. 사람이
          직접 응대하기 전 단계의 "접수 확인" 역할.
        </p>
      </GuideSection>
      <GuideSection title="자동회신 vs 직접 회신">
        <ul style={guideListStyle}>
          <li>자동회신 = 1개 템플릿, 즉시 발송, 카테고리별 분기 가능.</li>
          <li>직접 회신 = <code>/admin/inquiries</code> 에서 운영자가 본문을 작성해 발송.</li>
          <li>두 가지를 함께 — 빠른 응답성 + 정성스러운 응대.</li>
        </ul>
      </GuideSection>
      <GuideSection title="발송 활성화">
        <p>
          백엔드 환경변수 <code>RESEND_API_KEY</code> 가 설정되면 실발송, 미설정이면 simulated(Outbox 에 기록만).
          모니터링 페이지의 "이메일 발송" 카드로 현재 상태 확인.
        </p>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function OutboxGuide({ onClose }) {
  return (
    <AdminGuideModal title="Outbox — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          이메일·캠페인·계약서 등 모든 발송 이력을 시간 역순으로 보여줍니다. 백엔드 + localStorage
          기록을 병합 — Render 휘발 시에도 운영자 디바이스에 사본이 남아 있습니다.
        </p>
      </GuideSection>
      <GuideSection title="상태 분류">
        <GuideTable
          headers={['상태', '의미']}
          rows={[
            ['sent', '백엔드가 정상 발송 처리'],
            ['simulated', 'RESEND_API_KEY 미설정 — 실발송 없이 기록만'],
            ['failed', '발송 실패 (백엔드 응답 받음, 거부됨)'],
            ['error', 'API 호출 자체가 실패 (네트워크 등)'],
          ]}
        />
      </GuideSection>
      <GuideSection title="검색 / CSV">
        <ul style={guideListStyle}>
          <li>수신자·제목·본문 검색.</li>
          <li>CSV 내보내기 — 분기 발송 보고서. 비밀번호/토큰류는 자동 [REDACTED].</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}

// ───────── 마케팅 / CRM ─────────

export function CRMGuide({ onClose }) {
  return (
    <AdminGuideModal title="CRM — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          잠재 고객(lead)부터 전환 고객(customer)까지 파이프라인 단계로 관리합니다. 태그·세그먼트·
          활동 메모·예상 거래 금액을 한 행에서 추적.
        </p>
      </GuideSection>
      <GuideSection title="단계 흐름">
        <ol style={guideListStyle}>
          <li><strong>lead</strong> — 첫 접점이 발생한 잠재 고객.</li>
          <li><strong>qualified</strong> — 예산·시기 검증된 단계.</li>
          <li><strong>customer</strong> — 실제 거래/계약이 진행된 고객.</li>
          <li><strong>lost</strong> — 이탈 또는 거절된 케이스(이유 메모 권장).</li>
        </ol>
      </GuideSection>
      <GuideSection title="캠페인 발송 연동">
        <p>
          <code>/admin/campaign</code> 에서 CRM 단계·태그 기반 세그먼트로 메일을 발송할 수 있습니다.
          예: <em>"customer 전환 + 태그=리브랜딩"</em> 만 골라 메뉴 개편 안내 발송.
        </p>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function CampaignGuide({ onClose }) {
  return (
    <AdminGuideModal title="캠페인 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          이메일·SMS·카카오 캠페인을 작성·예약·발송하고 결과를 분석합니다. 일회성 발송과 시리즈
          (drip) 모두 지원.
        </p>
      </GuideSection>
      <GuideSection title="대상 추출 (segment)">
        <ul style={guideListStyle}>
          <li>CRM 단계 (lead/qualified/customer) + 태그 조합.</li>
          <li>발주/계약 이력 기반 (예: 최근 90일 발주 없는 고객).</li>
          <li>뉴스레터 구독자 — 옵트인 받은 명단만.</li>
        </ul>
      </GuideSection>
      <GuideSection title="발송 옵션">
        <ul style={guideListStyle}>
          <li><strong>즉시</strong> — 검토 후 바로 발송.</li>
          <li><strong>예약</strong> — 일시 지정. 백엔드 cron 이 자동 트리거.</li>
          <li><strong>초안 저장</strong> — 검토 라운드용. 발송 안 함.</li>
        </ul>
      </GuideSection>
      <GuideSection title="분석">
        <p>
          오픈율·클릭률 추적(이메일 픽셀 + 단축링크). 모든 캠페인은 Outbox 와 동일하게 기록됩니다.
        </p>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function PromotionGuide({ onClose }) {
  return (
    <AdminGuideModal title="프로모션 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          쿠폰 코드·이벤트·공지 배너를 한 곳에서 관리합니다. 본 시스템은 결제 처리는 하지 않으므로
          쿠폰은 <em>표시·검증·집계</em> 단계까지 다룹니다.
        </p>
      </GuideSection>
      <GuideSection title="쿠폰 타입">
        <ul style={guideListStyle}>
          <li><strong>정률</strong> — 10% 할인 같은 비율형.</li>
          <li><strong>정액</strong> — 5,000원 할인.</li>
          <li><strong>1+1 / N+M</strong> — 수량 보너스.</li>
        </ul>
      </GuideSection>
      <GuideSection title="유효기간 / 사용 횟수">
        <ul style={guideListStyle}>
          <li>유효기간 자동 만료 — 만료된 쿠폰은 자동 비활성.</li>
          <li>최대 사용 횟수 — 도달 시 자동 종료. 실시간 사용량 추적.</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}

export function PopupGuide({ onClose }) {
  return (
    <AdminGuideModal title="팝업 — 사용 가이드" onClose={onClose}>
      <GuideSection title="이 페이지는 어떤 곳인가요?">
        <p>
          사이트 방문자에게 보여줄 팝업 배너를 등록·노출 규칙·타겟 페이지를 관리합니다.
        </p>
      </GuideSection>
      <GuideSection title="위치 / 노출 빈도">
        <GuideTable
          headers={['옵션', '설명']}
          rows={[
            ['중앙', '큰 알림용 — 이벤트·공지'],
            ['우하단', '비방해형 — 채널 안내·CTA'],
            ['상단', '얇은 띠 — 운영 변동·점검 공지'],
            ['매번', '페이지 진입마다'],
            ['일 1회', '하루 첫 진입 시만'],
            ['영구 1회', '한 번 보면 끝'],
          ]}
        />
      </GuideSection>
      <GuideSection title="타겟팅 / 추적">
        <ul style={guideListStyle}>
          <li>특정 경로(/, /work 등)에서만 표시.</li>
          <li>노출/클릭/닫기 카운트 자동 집계 — 모니터링 페이지에서 확인.</li>
        </ul>
      </GuideSection>
    </AdminGuideModal>
  );
}
