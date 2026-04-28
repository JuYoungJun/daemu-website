"""DB 부팅 시 자동 시드되는 표준 데이터.

- DocumentTemplate (계약서·발주서 표준 양식 4종)
- ensure_demo_superadmin (ENV != prod일 때 매 부팅 시 슈퍼관리자 복원)
- 추가 시드는 본 모듈에 함수 단위로 추가하면 main.py lifespan에서 자동 실행됩니다.

각 시드 함수는 idempotent — 이미 같은 이름의 행이 있으면 건드리지 않습니다.
"""
from __future__ import annotations

import os
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

    res = await session.execute(select(AdminUser).where(AdminUser.email == DEMO_EMAIL))
    existing = res.scalar_one_or_none()
    if existing:
        # 이미 존재 — 비번이나 이름은 절대 덮어쓰지 않음. 비활성화 상태만 복구.
        if not existing.active:
            existing.active = True
            await session.commit()
            print(f"[seeds] demo superadmin {DEMO_EMAIL} reactivated")
        return

    session.add(AdminUser(
        email=DEMO_EMAIL,
        password_hash=hash_password(DEMO_PASSWORD),
        name="Demo Super-Admin (auto-seeded; remove when going prod)",
        role=ROLE_ADMIN,
        active=True,
        must_change_password=False,
    ))
    await session.commit()
    print(f"[seeds] demo superadmin auto-seeded: {DEMO_EMAIL} (ENV != prod fallback)")
    print("[seeds] ⚠️ Set ENV=prod and remove this seed before going live.")


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
