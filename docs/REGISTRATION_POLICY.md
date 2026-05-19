# 등록 권한 정책

> 어떤 데이터를 누가 등록하나? 클라이언트 직접 vs 운영자 받아서 입력 vs admin only.
> 클라이언트 인도 시 혼선 회피 + 권한 경계 명확화.

---

## 매트릭스

| 데이터 | 등록 주체 | 등록 진입점 | 비고 |
|---|---|---|---|
| **문의 (Inquiry)** | 누구나 (공개) | `/contact` 폼 | 자동 회신 메일 발송. /admin/inquiries 에 노출. |
| **파트너 가입 신청** | 클라이언트 직접 | `/partners` 회원가입 | 운영자 승인 필요 (status='대기'). 승인 시 자동 안내 메일. |
| **파트너 로그인** | 파트너 본인 | `/partners` 로그인 | 휴대폰 끝 4자리 초기 비번 → 강제 변경. |
| **발주 (Order)** | 파트너 본인 (포털) | `/partners` 로그인 후 발주 | 운영자가 /admin/orders 에서 검토/승인. |
| **계약서 / 발주서 발행** | 운영자 only | `/admin/contracts` | 파트너/CRM 에 e-Sign 링크 메일 발송. |
| **계약 서명** | 발송 대상자 (외부 사인) | 메일로 받은 `/sign/<token>` URL | 토큰 5분 TTL. IP/UA 감사 기록. |
| **뉴스레터 구독 신청** | 누구나 | Footer 또는 별도 | unsubscribe 90일 후 자동 익명화. |
| **뉴스레터 unsubscribe** | 구독자 본인 | 메일 풋터의 `/unsubscribe` 링크 | 한 번에 처리, 즉시 발송 중단. |
| **작업사례 (Work)** | 운영자 only | `/admin/works` | 공개 사이트 노출 (sort_order ASC). |
| **파트너 브랜드 (Home 노출용)** | 운영자 only | `/admin/partner-brands` | 로고 + 외부 URL. |
| **공지사항 / 팝업** | 운영자 only | `/admin/announcements`, `/admin/popup` | 파트너 포털 / 사이트 공지. |
| **사이트 콘텐츠 (Home/About/Service 카피)** | 운영자 only | `/admin/content` | 카피만 (구조는 코드). |
| **메일 템플릿** | 운영자 only | `/admin/mail`, `/admin/mail-templates` | 자동회신 + 캠페인용. |
| **CRM 고객** | 운영자 only | `/admin/crm` | 잠재 고객 / 미가입 lead 관리. |
| **재고 / 상품** | 운영자 only | `/admin/inventory`, `/admin/products` | FIFO LOT 트래킹. |
| **어드민 계정** | 슈퍼관리자 only | `/admin/users` | role: admin / developer / tester. |
| **IP allowlist** | 슈퍼관리자 only | `/admin/users` Account 탭 | 모니터링/analytics 응답에서 본인 IP 자동 제외용. |

---

## 권한 등급 (role)

- **admin** — 전체 CRUD + 운영. 슈퍼관리자.
- **developer** — 읽기 중심 + 운영 도구. 외주 개발자 위탁용 임시 계정.
- **tester** — 읽기 only + 시뮬레이션 발송 (실 메일 X). QA 위탁용.
- **partner** — 파트너 포털 only. 본인 발주 이력 + 자료 다운로드.

상세 매트릭스: `backend-py/auth.py:188-200` 의 `PERMISSIONS` dict.

---

## 클라이언트 인도 후 운영 동선

### 클라이언트가 자주 직접 하게 될 작업
- 문의 답변 (운영자가 / admin/inquiries 에서 직접 회신 또는 이메일)
- 작업사례 등록 (`/admin/works` — 슬러그 + 카테고리 + 사진 업로드)
- 파트너사 로고 추가 (`/admin/partner-brands` — Home 노출)
- 공지사항 / 팝업 작성 (`/admin/announcements`, `/admin/popup`)
- 캠페인 메일 발송 (`/admin/campaign` + `/admin/mail-templates`)

### 클라이언트가 직접 만지지 않는 작업 (운영자 또는 개발자)
- 어드민 계정 추가/삭제 (`/admin/users` — 슈퍼관리자만)
- DB 백업/복구 (Aiven console 또는 Cafe24 cron)
- 환경변수 (`/Render dashboard` / `.env`)
- 코드 배포 (git push → CI/CD)

### 슈퍼관리자가 부득이하게 처리해야 할 클라이언트 요청
- 회사 연락처 변경 → `src/lib/companyInfo.js` 또는 `VITE_COMPANY_*` 환경변수 (재빌드 필요)
- 푸터 텍스트 변경 → `src/components/Footer.jsx` (코드 수정 필요)
- 메인 통계 숫자 (40+ / 6년) → `src/lib/companyInfo.js` 의 `STATS` 객체

**중기 개선 후보**: 위 3개 항목을 `/admin/content` 로 옮기면 클라이언트 직접
편집 가능. 현재는 일부러 코드 source 에 묶어 둠 (잘못된 입력 회피).

---

## 첫 어드민 셋업 (운영자 인수인계 시점)

1. 운영자 `/admin` 진입 → 초기 비번 (ADMIN_PASSWORD env) 으로 로그인.
2. 강제 비번 변경 화면 → 강한 비번 (12자 이상, 영문 + 숫자 + 특수문자) 입력.
3. **2FA (TOTP) 등록 즉시 진행** — `/admin/users` → 본인 account → 2FA 활성.
4. 백업 코드 8자리 8개 발급 → 종이 출력 또는 password manager 에 보관.
5. ADMIN_PASSWORD env 삭제 (Render dashboard 또는 .env 라인 제거).
6. 클라이언트 인도 시 슈퍼관리자 계정 신규 발급 → 본인 계정은 `developer` 로 강등 (선택).

---

## 데이터 삭제 요청 (개인정보보호법 제36조)

회원/문의자가 자기 데이터 삭제 요청 시:

1. 본인 확인 — 메일/전화로 검증.
2. 운영자 `/admin/inquiries` 또는 `/admin/partners` 에서 해당 row 삭제.
3. Document / Order 의 partner_id / crm_id 는 자동으로 NULL 처리 (ON DELETE SET NULL).
4. AuditLog 는 보존 (사고 조사 의무 — 5년).
5. 처리 후 회신 메일 발송.

⚠ Newsletter unsubscribe 는 자동 — 별도 요청 불필요.
⚠ Inquiry 3년 / Outbox 1년 / SuspiciousEvent 90일/365일 / AdminEmailOtp 만료
즉시 / NewsletterSubscriber unsubscribe 후 90일 자동 익명화는 backend
`_retention_cron` 이 6시간 주기로 자동 처리.
