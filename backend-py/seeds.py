"""DB 부팅 시 자동 시드되는 표준 데이터.

- DocumentTemplate (계약서·발주서 표준 양식 4종)
- ensure_demo_superadmin (ENV != prod일 때 매 부팅 시 슈퍼관리자 복원)
- 추가 시드는 본 모듈에 함수 단위로 추가하면 main.py lifespan에서 자동 실행됩니다.

각 시드 함수는 idempotent — 이미 같은 이름의 행이 있으면 건드리지 않습니다.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import AdminUser, DocumentTemplate


# ---------------------------------------------------------------------------
# DAEMU 베이커리/카페 컨설팅 맥락에 맞춘 표준 양식

_VARS_FULL = [
    "clientName", "clientAddress", "clientCEO", "clientBizNo",
    "projectName", "amount", "amountWithTax",
    "startDate", "endDate", "deliveryDate",
    "companyName", "companyAddress", "companyCEO", "companyBizNo",
    "managerName", "managerEmail", "managerPhone",
    "scope", "terms", "paymentTerms", "warrantyPeriod", "today",
]


T_SERVICE_CONSULTING = """카페·베이커리 컨설팅 용역 계약서

본 계약은 아래 당사자 간에 체결되며, "{{projectName}}" 프로젝트에 관한
컨설팅 용역의 제공 및 그에 따른 권리·의무를 다음과 같이 정한다.

────────────────────────────────────────────
■ 갑 (의뢰인 / 클라이언트)
  · 회사명: {{clientName}}
  · 주    소: {{clientAddress}}
  · 대 표 자: {{clientCEO}}
  · 사업자등록번호: {{clientBizNo}}

■ 을 (수임인 / 컨설팅사)
  · 회사명: {{companyName}}
  · 주    소: {{companyAddress}}
  · 대 표 자: {{companyCEO}}
  · 사업자등록번호: {{companyBizNo}}
────────────────────────────────────────────

제 1 조 (계약 목적)
본 계약은 갑이 운영하고자 하는 카페·베이커리 사업에 관하여 을이 브랜드 전략,
메뉴 개발, 공간 설계, 운영 시스템 등 통합 컨설팅을 제공함으로써 갑의 사업
목표 달성에 기여함을 목적으로 한다.

제 2 조 (용역 범위)
{{scope}}

제 3 조 (계약 기간)
{{startDate}} ~ {{endDate}}, 다만 양 당사자 합의에 따라 연장할 수 있다.

제 4 조 (단계별 산출물)
1) Phase 1 — 사전 분석·전략: 시장 조사, 경쟁 분석, 브랜드 포지셔닝 보고서.
2) Phase 2 — 디자인·R&D: 메뉴 R&D, 공간 컨셉, BI/CI, 운영 매뉴얼.
3) Phase 3 — 오픈 지원: 시공 감리, 직원 교육, 오픈 운영 컨설팅.
4) Phase 4 — 사후 운영: 오픈 후 4주간 운영 모니터링 및 개선 권고.

제 5 조 (계약 금액 — 표기)
계약 금액은 금 {{amount}} 원 (부가세 포함 {{amountWithTax}} 원)으로 표기한다.
단, 본 문서는 대금 수납·청구 시스템이 아니며, 실제 정산은 별도 절차
(세금계산서 발행 등)에 따라 진행된다.

제 6 조 (대금 지급 조건 — 참고)
{{paymentTerms}}

제 7 조 (산출물의 인도 및 검수)
을은 약정된 산출물을 {{deliveryDate}} 까지 갑에게 인도하며, 갑은 인도일로부터
14일 이내에 서면으로 이의를 제기하지 아니하면 검수가 완료된 것으로 본다.

제 8 조 (하자보수)
산출물의 하자에 대해 을은 인도일로부터 {{warrantyPeriod}} 동안 무상 보수의
의무를 진다.

제 9 조 (비밀유지)
양 당사자는 본 계약 이행 과정에서 알게 된 상대방의 영업비밀, 기술정보,
고객정보, 메뉴 레시피 등을 계약 종료 후 3년간 제3자에게 누설하거나 본 계약
목적 외로 사용해서는 아니 된다.

제 10 조 (지식재산권)
본 계약 수행 과정에서 도출된 산출물(브랜드 디자인, 레시피, 매뉴얼 등)의
저작권 및 지식재산권은 잔금 지급 완료 시 갑에게 이전되며, 그 전까지는 을의
소유로 한다. 다만, 을은 본 프로젝트를 자사 포트폴리오로 사용할 권리를
보유한다.

제 11 조 (계약 해지)
어느 일방이 본 계약상 의무를 중대하게 위반하고 30일의 시정 통지에도 시정하지
아니할 경우, 상대방은 서면 통지로 본 계약을 해지할 수 있다.

제 12 조 (분쟁 해결)
본 계약과 관련된 분쟁은 양 당사자가 우선 협의하여 해결하며, 협의가 불성립할
경우 대한상사중재원의 중재 규칙에 따른다.

제 13 조 (특약사항)
{{terms}}

본 계약의 성립을 증명하기 위하여 본 계약서를 2부 작성하여 각 당사자가
서명·날인 후 각 1부씩 보관한다.

계약 체결일: {{today}}

담당 매니저: {{managerName}} ({{managerEmail}} · {{managerPhone}})"""


T_MENU_RND = """메뉴 개발 (R&D) 위탁 계약서

본 계약은 {{clientName}}(이하 "갑")과 {{companyName}}(이하 "을") 간
"{{projectName}}" 프로젝트의 메뉴 개발 위탁에 관해 다음과 같이 정한다.

제 1 조 (계약 목적)
갑이 운영하는 매장 컨셉에 맞는 베이커리/디저트/음료 메뉴를 을이 R&D하여
시그니처 라인업과 표준 레시피·SOP를 제공한다.

제 2 조 (개발 범위)
{{scope}}
  - 시그니처 메뉴 개발 (시제품 시연 포함)
  - 표준 레시피북 작성 (재료·계량·공정·플레이팅)
  - 원가율 산정 및 판매가 권장
  - 직원 교육용 SOP 매뉴얼

제 3 조 (개발 기간)
{{startDate}} ~ {{endDate}}, 시연 횟수 최대 3회.

제 4 조 (계약 금액 — 표기)
{{amount}} 원 (부가세 포함 {{amountWithTax}} 원). 식자재·시제품 비용은 별도.

제 5 조 (대금 지급 조건 — 참고)
{{paymentTerms}}

제 6 조 (지식재산권)
완성된 레시피의 저작권은 잔금 지급 완료 시 갑에게 이전되며, 을은 본 레시피를
타 매장에 동일하게 제공하지 아니한다. 단, 일반화된 기법·아이디어 단계는 본
조항의 적용 대상이 아니다.

제 7 조 (특약사항)
{{terms}}

계약 체결일: {{today}} · 담당자: {{managerName}}"""


T_SUPPLY = """원두 / 베이커리 공급 계약서

본 계약은 갑 {{clientName}} (이하 "발주처")이 을 {{companyName}} (이하
"공급사")로부터 "{{projectName}}" 관련 원두·베이커리 제품을 정기 공급받음에
있어 그 거래 조건을 다음과 같이 정한다.

제 1 조 (공급 품목)
{{scope}}
  - 원두 (블렌드 종류·로스팅 단계·1회 공급량)
  - 베이커리 완제품 / 반제품
  - 시즌 한정 메뉴 (해당 시)

제 2 조 (공급 기간)
{{startDate}} ~ {{endDate}}, 정기 공급 — 자동 1년 갱신 조항 적용.

제 3 조 (납품 / 검수)
공급사는 매주 정해진 요일에 {{deliveryDate}} 기준으로 발주처가 지정한 매장에
납품하며, 발주처는 납품 후 1일 이내 검수를 완료한다.

제 4 조 (단가 및 정산 — 표기)
계약 단가는 별첨 명세서에 따르며, 월 누계 표기 {{amount}} 원
(부가세 포함 {{amountWithTax}} 원). 실제 정산은 별도 합의에 따라 매월 말일
세금계산서 발행으로 처리한다.

제 5 조 (품질 보증)
공급사는 납품 물품의 품질 불량에 대해 인도일로부터 {{warrantyPeriod}} 동안
무상 교환 또는 보수의 의무를 진다.

제 6 조 (특약사항)
{{terms}}

계약 체결일: {{today}}
당사 담당자: {{managerName}} ({{managerEmail}})"""


T_NDA = """비밀유지 계약서 (NDA)

본 계약은 아래 당사자 간 "{{projectName}}" 검토·협의 과정에서 교환되는
비밀 정보의 보호에 관한 사항을 정한다.

당사자
  · 갑: {{clientName}} (대표자 {{clientCEO}})
  · 을: {{companyName}} (대표자 {{companyCEO}})

제 1 조 (비밀정보의 정의)
본 계약에서 "비밀정보"란 일방 당사자가 상대방에게 서면·구두·전자적 방법으로
공개한 모든 기술·영업·재무·고객 정보 중 비밀로 표시되었거나 그 성질상 비밀로
간주되어야 하는 정보(메뉴 레시피, 매장 운영 노하우, 고객 데이터 등 포함)를
말한다.

제 2 조 (비밀유지 의무)
양 당사자는 비밀정보를 본 계약 목적 외로 사용하지 아니하며, 사전 서면 동의
없이 제3자에게 누설하지 아니한다.

제 3 조 (유지 기간)
비밀유지 의무는 본 계약 체결일부터 3년간 또는 {{endDate}}까지 중 더 늦게
도래하는 시점까지로 한다.

제 4 조 (반환 및 폐기)
계약 종료 또는 일방의 요청 시, 수령자는 보유 중인 비밀정보 일체를 즉시
반환하거나 검증 가능한 방법으로 폐기한다.

제 5 조 (특약사항)
{{terms}}

계약 체결일: {{today}}"""


T_PO_BAKERY = """베이커리 / 원두 발주서 (Purchase Order)

발 주 일: {{today}}
발주번호: PO-자동발급

발주처 (당사)
  · 회사명: {{companyName}}
  · 사업자등록번호: {{companyBizNo}}
  · 담당자: {{managerName}} ({{managerEmail}} · {{managerPhone}})

공급처
  · 회사명: {{clientName}}
  · 대표자: {{clientCEO}}
  · 사업자등록번호: {{clientBizNo}}
  · 주    소: {{clientAddress}}

────────────────────────────────────────────
프로젝트 : {{projectName}}
납    기 : {{deliveryDate}}
계약 기간: {{startDate}} ~ {{endDate}}

발주 항목 / 사양:
{{scope}}

총 금액 (표기): {{amount}} 원 (부가세 포함 {{amountWithTax}} 원)
※ 실제 대금 정산·세금계산서 발행은 별도 절차로 진행됩니다.

대금 지급 조건 (참고): {{paymentTerms}}
하자/품질 보증 기간: {{warrantyPeriod}}
────────────────────────────────────────────

특약사항:
{{terms}}

수령 확인 시 본 발주서 하단에 서명하여 회신해 주시기 바랍니다.

발주처 담당자: {{managerName}}"""


T_PO_INTERIOR = """매장 인테리어 / 시공 발주서

발 주 일: {{today}}
발주처: {{companyName}} ({{managerName}})
공급처(시공사): {{clientName}} (대표 {{clientCEO}})
사업자번호: {{clientBizNo}}

프로젝트: {{projectName}}
시공 기간: {{startDate}} ~ {{endDate}} (완공 예정 {{deliveryDate}})

시공 범위:
{{scope}}

총 시공비 (표기): {{amount}} 원 (부가세 포함 {{amountWithTax}} 원)
지급 조건 (참고): {{paymentTerms}}
하자보수 기간: {{warrantyPeriod}}

특약사항:
{{terms}}

발주처 담당자: {{managerName}} ({{managerEmail}} · {{managerPhone}})"""


T_BRAND_DESIGN = """브랜드 디자인 위탁 계약서

본 계약은 {{clientName}}(이하 "갑")과 {{companyName}}(이하 "을") 간
"{{projectName}}" 프로젝트의 브랜드 디자인 위탁에 관해 다음과 같이 정한다.

제 1 조 (계약 목적)
을은 갑이 운영(또는 신규 오픈)할 매장의 브랜드 아이덴티티를 정립하기 위한
디자인 작업물 일체를 갑에게 제공하며, 갑은 이에 대한 대가를 지급한다.

제 2 조 (작업 범위)
{{scope}}
  - 로고 디자인 (메인 1안 + 응용 2안)
  - 컬러 팔레트 / 타이포그래피 시스템
  - 패키지 디자인 (포장지·박스·스티커 등 표준 3종)
  - 메뉴판 / 가격표 디자인
  - 명함·간판 디자인 가이드
  - 브랜드 매뉴얼 PDF 1부

제 3 조 (작업 기간)
{{startDate}} ~ {{endDate}}, 수정 횟수 단계별 최대 3회.

제 4 조 (계약 금액 — 표기)
{{amount}} 원 (부가세 포함 {{amountWithTax}} 원). 외주 인쇄·실물 제작 비용은
별도 청구.

제 5 조 (대금 지급 조건 — 참고)
{{paymentTerms}}

제 6 조 (저작권 및 사용 권리)
1. 최종 납품된 로고 등 본 계약의 결과물 저작권은 잔금 지급 완료 시 갑에게
   이전된다.
2. 을은 본 작업물을 포트폴리오·홍보 자료에 자유롭게 사용할 수 있으며, 갑은
   이를 사전에 동의한 것으로 본다 (단, 매장 운영 데이터 등 비밀 정보 제외).
3. 갑은 작업 완료 후 디자인 원본 파일(AI/PSD 등)을 함께 인도받는다.

제 7 조 (수정 한도 및 추가 작업)
단계별 수정 횟수 초과 시 추가 비용은 별도 합의로 정한다 (시간당 또는
건당). 본질적 컨셉 변경은 새 작업으로 간주.

제 8 조 (특약사항)
{{terms}}

계약 체결일: {{today}} · 담당자: {{managerName}} ({{managerEmail}})"""


T_SPACE_DESIGN = """매장 공간 설계 계약서

본 계약은 {{clientName}}(이하 "갑")과 {{companyName}}(이하 "을") 간
"{{projectName}}" 매장의 공간 설계(인테리어 디자인·도면) 위탁에 관해
다음과 같이 정한다. 본 계약은 시공 발주(별도)와 구별된다.

제 1 조 (계약 목적)
을은 갑이 신규 오픈하는 매장의 운영 동선·고객 동선·주방 효율을 고려한
공간 설계와 시공용 도면 일체를 작성·제공한다.

제 2 조 (설계 범위)
{{scope}}
  - 현장 실측 + 사이트 분석 (1회)
  - 평면도·입면도·전개도 (시공용 표준)
  - 가구·집기 배치도
  - 주방 동선 다이어그램
  - 조명·전기·급배수 위치 가이드 (시공사 협업)
  - 3D 공간 시뮬레이션 (옵션)
  - 시방서 (자재·마감 사양)

제 3 조 (설계 기간)
{{startDate}} ~ {{endDate}}, 수정 단계별 최대 3회. 시공 단계의 도면 수정은
별도 위탁.

제 4 조 (계약 금액 — 표기)
{{amount}} 원 (부가세 포함 {{amountWithTax}} 원). 외부 컨설팅(주방·조명
전문가) 의뢰 비용은 별도.

제 5 조 (대금 지급 조건 — 참고)
{{paymentTerms}}

제 6 조 (도면 사용권)
완성된 도면은 본 매장의 시공 목적으로만 사용된다. 동일 도면을 타 매장에
복제 사용할 경우 사전 서면 동의를 얻고 별도 라이선스료를 지불한다.

제 7 조 (시공 단계 협력)
을은 시공사 선정 자문 + 시공 중 도면 수정 검토(2회) 까지 본 계약에
포함된다. 그 외 시공 감리는 별도 위탁.

제 8 조 (특약사항)
{{terms}}

계약 체결일: {{today}}
설계 책임자: {{managerName}} ({{managerEmail}} · {{managerPhone}})"""


T_OJT_TRAINING = """매장 운영 교육·OJT 위탁 계약서

본 계약은 {{clientName}}(이하 "갑")과 {{companyName}}(이하 "을") 간
"{{projectName}}" 매장의 직원 운영 교육 위탁에 관해 다음과 같이 정한다.

제 1 조 (계약 목적)
을은 갑의 매장 직원이 정상 운영에 필요한 베이커리 제조·바리스타·
서비스·마감 매뉴얼을 숙지하도록 교육 프로그램을 운영한다.

제 2 조 (교육 범위)
{{scope}}
  - 베이커리 제조 OJT ({{trainingDays}}일)
  - 바리스타 음료 추출 OJT
  - POS·결제 시스템 운영
  - 매장 청소·위생 표준 SOP
  - 고객 응대·서비스 매뉴얼
  - 마감·재고·발주 워크플로
  - 오픈 후 1개월 내 사후 점검 1회

제 3 조 (교육 일정)
{{startDate}} ~ {{endDate}}, 일 평균 {{dailyHours}}시간 (협의 가능).
오픈 전 집중 교육 + 오픈 후 안정화 점검 분리 운영.

제 4 조 (계약 금액 — 표기)
{{amount}} 원 (부가세 포함 {{amountWithTax}} 원). 식자재·소모품 비용은
갑이 부담.

제 5 조 (대금 지급 조건 — 참고)
{{paymentTerms}}

제 6 조 (교재·동영상 자료)
교육에 사용된 매뉴얼 PDF·동영상 자료는 갑의 매장 내부 운영 목적으로만
사용 가능하며, 외부 공유·복제·재판매는 금지된다.

제 7 조 (교육 결과 평가)
교육 종료 시 직원별 평가 시트를 작성하여 갑에게 제출. 평가 미달 직원에
대한 추가 교육은 별도 합의.

제 8 조 (특약사항)
{{terms}}

계약 체결일: {{today}}
교육 책임자: {{managerName}}"""


T_PHOTO_USE_CONSENT = """이미지·사진 사용 동의서

본 동의서는 {{clientName}}(이하 "갑")이 운영(또는 협업)하는 매장의
공간·메뉴·운영 사진 등을 {{companyName}}(이하 "을")이 작업 사례·홍보·
포트폴리오 등에 사용함에 관해 동의를 명시한다.

제 1 조 (대상 이미지)
{{scope}}
  - 매장 공간 사진 (인테리어·외관)
  - 메뉴·디저트·음료 사진
  - 운영 장면 (얼굴 식별 가능 사진은 별도 동의)
  - 브랜드 디자인 적용 사례

제 2 조 (사용 범위)
다음 용도로 무상·무기한 사용을 동의한다:
  - 회사 웹사이트 (Work / Portfolio 섹션)
  - SNS 채널 (Instagram·Facebook·YouTube 등)
  - 컨설팅 제안서·교육 자료
  - 인쇄·출판 매체 (월간지·전문지 인터뷰 등)

제 3 조 (제외 항목)
다음은 본 동의에 포함되지 않으며 별도 서면 동의가 필요하다:
  - 직원·고객 등 식별 가능한 인물 사진
  - 매출·거래처 등 운영 비밀 정보
  - 타 브랜드와의 협업 사진

제 4 조 (회수·삭제 권한)
갑이 매장을 폐업·이전하거나 사정 변경이 발생한 경우, 서면 통지로
이미지의 즉시 비공개·삭제를 요청할 수 있다. 을은 통지 후 영업일 7일
이내 처리한다.

제 5 조 (소유권)
원본 이미지의 소유권은 갑에게 있으며, 을은 사용권만 보유한다.
을이 자체 촬영한 이미지의 저작권은 을에게 귀속되되, 본 조항에 따라
갑도 사용 가능하다.

제 6 조 (특약사항)
{{terms}}

동의일: {{today}}
갑 측 책임자: {{clientCEO}} (서명)
을 측 책임자: {{managerName}} ({{managerEmail}})"""


T_PO_EQUIPMENT = """매장 장비·집기 일괄 발주서

발주처: {{clientName}} (이하 "발주처")
공급처: {{companyName}} (이하 "공급처")
프로젝트: {{projectName}}
발주일: {{today}}

▣ 발주 품목 (별첨 명세서 참조)
{{scope}}
  - 주방 대형 장비 (오븐·냉장고·반죽기·커피머신 등)
  - 주방 소형 도구 (저울·계량·트레이·믹싱볼 등)
  - 매장 가구 (테이블·의자·진열장)
  - POS·결제 단말기·프린터
  - 청소·위생 도구

▣ 합계 금액 (표기)
{{amount}} 원 (부가세 포함 {{amountWithTax}} 원).
실제 정산은 세부 품목 명세서 + 세금계산서 발행으로 진행.

▣ 납품 일정 및 장소
납품 예정일: {{deliveryDate}}
납품 장소: {{clientAddress}}
설치·시운전: 납품 후 영업일 3일 이내 완료. 매장 동선·전기·급배수 사정에
따라 일정 협의 가능.

▣ 검수
발주처는 납품 후 영업일 5일 이내 다음 항목을 검수한다:
  - 외관 손상 여부
  - 정상 동작 여부 (시운전 포함)
  - 명세서 수량 일치
  - 안전·위생 인증 표시 (해당 품목)
검수 합격 후 잔금 지급 절차 진행.

▣ 보증 기간
모든 장비는 납품일로부터 {{warrantyPeriod}} 무상 A/S. 사용자 과실은 제외.

▣ 결제 조건 (표기)
{{paymentTerms}}

▣ 특약사항
{{terms}}

발주처 담당자: {{managerName}} ({{managerEmail}} · {{managerPhone}})"""


SEED_TEMPLATES = [
    {
        "name": "[표준] 카페·베이커리 컨설팅 용역 계약서",
        "kind": "contract",
        "subject": "[대무] 컨설팅 용역 계약서 — {{projectName}}",
        "body": T_SERVICE_CONSULTING,
    },
    {
        "name": "[표준] 메뉴 개발(R&D) 위탁 계약서",
        "kind": "contract",
        "subject": "[대무] 메뉴 개발 위탁 계약 — {{projectName}}",
        "body": T_MENU_RND,
    },
    {
        "name": "[표준] 원두/베이커리 공급 계약서",
        "kind": "contract",
        "subject": "[대무] 공급 계약 — {{projectName}}",
        "body": T_SUPPLY,
    },
    {
        "name": "[표준] 비밀유지 계약서 (NDA)",
        "kind": "contract",
        "subject": "[대무] NDA — {{projectName}}",
        "body": T_NDA,
    },
    {
        "name": "[표준] 브랜드 디자인 위탁 계약서",
        "kind": "contract",
        "subject": "[대무] 브랜드 디자인 위탁 — {{projectName}}",
        "body": T_BRAND_DESIGN,
    },
    {
        "name": "[표준] 매장 공간 설계 계약서",
        "kind": "contract",
        "subject": "[대무] 공간 설계 계약 — {{projectName}}",
        "body": T_SPACE_DESIGN,
    },
    {
        "name": "[표준] 매장 운영 교육·OJT 위탁 계약서",
        "kind": "contract",
        "subject": "[대무] 운영 교육 위탁 — {{projectName}}",
        "body": T_OJT_TRAINING,
    },
    {
        "name": "[표준] 이미지·사진 사용 동의서",
        "kind": "contract",
        "subject": "[대무] 이미지·사진 사용 동의서 — {{projectName}}",
        "body": T_PHOTO_USE_CONSENT,
    },
    {
        "name": "[표준] 베이커리/원두 발주서",
        "kind": "purchase_order",
        "subject": "[대무] 발주서 — {{projectName}}",
        "body": T_PO_BAKERY,
    },
    {
        "name": "[표준] 매장 인테리어 시공 발주서",
        "kind": "purchase_order",
        "subject": "[대무] 시공 발주서 — {{projectName}}",
        "body": T_PO_INTERIOR,
    },
    {
        "name": "[표준] 매장 장비·집기 일괄 발주서",
        "kind": "purchase_order",
        "subject": "[대무] 장비·집기 발주서 — {{projectName}}",
        "body": T_PO_EQUIPMENT,
    },
]


async def ensure_demo_superadmin(session: AsyncSession) -> None:
    """데모/개발 환경에서 SQLite 휘발 후에도 슈퍼관리자가 매 부팅 시 자동
    복원되도록 하는 fallback 시드.

    ENV=prod에서는 동작하지 않습니다 (실수로 운영 DB에 하드코딩 비번이
    들어가는 사고 방지). 사용자가 비밀번호를 변경한 후라면 비번은
    절대 덮어쓰지 않고, 행이 사라진 케이스만 다시 만듭니다.

    이 fallback은 TEST_ADMIN_EMAIL/PASSWORD env를 등록하지 않은 사용자도
    superadmin@daemu.kr / Daemu@Test2026Final! 로 즉시 로그인할 수 있게
    합니다.
    """
    if os.environ.get("ENV", "").lower() in {"prod", "production"}:
        return

    # auth 모듈을 lazy import해 순환 import 방지
    from auth import hash_password, ROLE_ADMIN

    DEMO_EMAIL = os.environ.get("DEMO_SUPERADMIN_EMAIL", "superadmin@daemu.kr")
    DEMO_PASSWORD = os.environ.get("DEMO_SUPERADMIN_PASSWORD", "Daemu@Test2026Final!")

    DISPLAY_NAME = "슈퍼 관리자"
    LEGACY_NAMES = {
        "Demo Super-Admin (auto-seeded; remove when going prod)",
        "Super Admin (test)",
        "Test Super-Admin (TEMPORARY — REMOVE AFTER TESTING)",
    }

    res = await session.execute(select(AdminUser).where(AdminUser.email == DEMO_EMAIL))
    existing = res.scalar_one_or_none()
    if existing:
        # 이미 존재 — 비번은 절대 덮어쓰지 않음. 다음만 정상화:
        #   1) 비활성 상태 복구
        #   2) 옛 자동 시드의 영문 디버그 라벨이 그대로면 깔끔한 한국어 이름으로 교체
        #   3) 데모 슈퍼관리자는 첫 접속 이메일 인증을 면제 (테스트 계정이므로)
        changed = False
        if not existing.active:
            existing.active = True
            changed = True
            print(f"[seeds] demo superadmin {DEMO_EMAIL} reactivated")
        if existing.name in LEGACY_NAMES or not (existing.name or "").strip():
            existing.name = DISPLAY_NAME
            changed = True
            print(f"[seeds] demo superadmin display name normalised → '{DISPLAY_NAME}'")
        # 슈퍼관리자는 데모 계정이므로 인증 면제. 컬럼이 NULL 이면 채워준다.
        if existing.email_verified_at is None:
            existing.email_verified_at = datetime.now(timezone.utc)
            changed = True
            print(f"[seeds] demo superadmin email verification bypassed")
        if existing.must_change_password:
            existing.must_change_password = False
            changed = True
        if changed:
            await session.commit()
        return

    session.add(AdminUser(
        email=DEMO_EMAIL,
        password_hash=hash_password(DEMO_PASSWORD),
        name=DISPLAY_NAME,
        role=ROLE_ADMIN,
        active=True,
        must_change_password=False,
        # 데모 슈퍼관리자는 시드 시점에 이메일 인증 완료 상태로 시작.
        # (실제 신규 어드민 계정은 email_verified_at=NULL 로 시작해 첫
        # 접속 시 본인의 진짜 이메일을 입력 → 인증 후 그 이메일로 갱신.)
        email_verified_at=datetime.now(timezone.utc),
    ))
    await session.commit()
    print(f"[seeds] demo superadmin auto-seeded: {DEMO_EMAIL} (ENV != prod fallback)")
    print("[seeds] Set ENV=prod and remove this seed before going live.")


async def ensure_default_templates(session: AsyncSession) -> None:
    """Idempotent — 이미 같은 이름의 템플릿이 있으면 손대지 않습니다."""
    res = await session.execute(select(DocumentTemplate.name))
    existing_names = {row[0] for row in res.all()}
    added = 0
    for t in SEED_TEMPLATES:
        if t["name"] in existing_names:
            continue
        session.add(DocumentTemplate(
            name=t["name"],
            kind=t["kind"],
            subject=t["subject"],
            body=t["body"],
            variables=_VARS_FULL,
            active=True,
        ))
        added += 1
    if added:
        await session.commit()
        print(f"[seeds] {added} default contract templates inserted")
