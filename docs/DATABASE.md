# DAEMU 백엔드 — 데이터베이스 문서

> 출처: `backend-py/models.py` (SQLAlchemy 2.0 ORM)
> ERD: `docs/database.dbml` 통째로 https://dbdiagram.io 에 붙여넣어 시각화.

## 환경

| 단계 | DB | 비고 |
|---|---|---|
| **로컬 dev** | `sqlite+aiosqlite:///./daemu.db` | WAL 모드, busy_timeout 10s |
| **Render 데모** | sqlite (휘발) | dyno 슬립 시 데이터 유실 가능 |
| **운영** | `mysql+aiomysql://...` (Aiven for MySQL 8) | SSL `verify-required` |

환경변수:
- `DATABASE_URL` — 연결 문자열. `mysql://` 입력 시 backend 가 자동으로 `mysql+aiomysql://` 또는 `mysql+asyncmy://` 로 정규화 (driver = `MYSQL_DRIVER` 변수, 기본 `asyncmy`).
- `MYSQL_SSL_CA` — Aiven 의 self-signed CA PEM. 설정 시 `verify-required` 모드.
- `MYSQL_DRIVER` — `asyncmy` (기본) 또는 `aiomysql` (caching_sha2_password 호환성 ↑).

## 테이블 분류

### 1) 인증 / 사용자
- **admin_users** — 어드민 콘솔 사용자. role: `admin` / `tester` / `developer`. TOTP 2FA, 백업 코드 8개.
- **admin_email_otp** — 이메일 OTP 코드. bcrypt hash 저장, 10분 만료, 5회 실패 lock.

### 2) 공개 사이트
- **inquiries** — Contact 폼 상담/문의. PIPA 보존 3년.
- **partners** — B2B 파트너 계정.
- **newsletter_subscribers** — 뉴스레터 옵트인 명단.

### 3) 발주 / 상품 / 계약
- **orders** — 파트너 발주. 상태: 접수 → 처리중 → 출고완료.
- **document_templates** — 표준 계약서/발주서 템플릿. `{{변수}}` 치환.
- **documents** — 발급된 문서 인스턴스. e-Sign 토큰 + history (audit trail).
- **document_signatures** — 서명 기록. 한 문서에 여러 서명자 별도 row.

### 4) 콘텐츠 / 미디어
- **works** — `/work` 포트폴리오. slug 기반 URL.
- **content_blocks** — 사이트 텍스트 블록 (회사 소개, 연혁 등).
- **site_popups** — 팝업 배너 + 노출 통계.

### 5) 메일 / 캠페인
- **mail_templates** — 자동회신 + 운영 mail (kind 별 1건).
- **mail_template_lib** — 단체 발송용 템플릿 라이브러리.
- **campaigns** — 이메일/SMS/카카오 캠페인 레코드.
- **outbox** — 모든 발송 이력 (sent/failed/error/simulated).
- **promotions** — 쿠폰 코드.

### 6) CRM
- **crm_customers** — lead → qualified → customer → lost 파이프라인.

### 7) 단축 링크 (UTM 캠페인)
- **short_links** — HMAC 서명된 단축 URL. `expires_at` / `max_clicks` / `revoked_at`.
- **short_link_clicks** — 클릭 이벤트. IP는 hash 형태로만, UA family 만 (PII 최소화).

### 8) 보안 / 감사
- **audit_logs** — 모든 보안 이벤트. PIPA 제29조. **보존 ≥ 1년**, cron 이 sweep 안 함.
- **suspicious_events** — 의심 이벤트 (brute_force_login / token_leak / rate_limit_exceeded / scrape_pattern). login throttle lock 도달 시 자동 기록. 운영자 검토 후 resolve. **자동 sweep cron** 적용 (90일 / evidence=true 365일).

### 9) 커머스 / 재고
- **products** — 발주 카탈로그 상품. SKU 표준 형식 `DAEMU-{CAT}-NNNN-LL` (CAT=BAK/CAF/EQP/PCK/MSC). `stock_count < 10` 시 알림.
- **stock_lots** — LOT 단위 입고 + 유통기한. FIFO 차감 (expires_at 빠른 LOT 부터). 만료 시 자동 `quarantined=true`.
- **announcements** — 공지/프로모션. kind=notice/promo/urgent, target=all/public/partner_portal.
- **partner_brands** — Home 의 "함께하는 파트너사" 로고 카드. Partner (로그인 계정) 와 별도 디스플레이용.

## 외래 키 / 관계

```
admin_users (1) ──< documents.created_by
            (1) ──< short_links.created_by
            (1) ──< audit_logs.actor_user_id
            (1) ──< suspicious_events.resolved_by
            (1) ──< admin_email_otp.user_id

partners    (1) ──< orders.partner_id
            (1) ──< documents.partner_id

document_templates (1) ──< documents.template_id
documents          (1) ──< document_signatures.document_id

short_links (1) ──< short_link_clicks.short_link_id

crm_customers (1) ──< documents.crm_id
orders        (1) ──< documents.order_id
works         (1) ──< documents.work_id

admin_users (1) ──< stock_lots.created_by
admin_users (1) ──< announcements.created_by
```

## SKU 표준

```
DAEMU-{CAT}-NNNN-LL
       │     │    └─ 옵션 (사이즈/맛/색깔). 없으면 00.
       │     └────── 카테고리 내 일련번호 (자동 할당, 4자리).
       └──────────── 카테고리 (BAK 베이커리 / CAF 카페 / EQP 설비 / PCK 패키징 / MSC 기타).
```

`backend-py/skuutil.py` 가 `next_sku(category)` 로 다음 번호 계산. /admin/inventory 에서 신규 등록 시 자동 적용.

## LOT / 유통기한 정책

- **FIFO**: 발주 처리 시 expires_at 가장 이른 LOT 부터 차감.
- **D-3 임박**: 만료 3일 전부터 /admin/inventory 알림 탭 표시 + (V2) 운영자 메일 알림.
- **만료 격리**: cron 이 일 1회 만료 LOT 의 quarantined=true 로 자동 마크 → 발주 불가.
- **추적**: 발주 처리 시 어느 LOT 차감했는지 order.items 의 metadata 에 기록 (food safety / recall 추적).

## PII / 보존 정책

| 테이블 | PII | 정책 |
|---|---|---|
| `inquiries` | 이름·전화·이메일·문의내용 | 보존 3년 (전자상거래법) → 자동 삭제 |
| `partners` | 담당자명·이메일·전화 | 사용자 요청 시 즉시 삭제 |
| `audit_logs` | 행위자 이메일·IP·UA | **보존 ≥ 1년**, 자동 삭제 X |
| `suspicious_events` | IP·UA·detail | high/critical 365일, 그 외 90일 |
| `short_link_clicks` | IP hash + UA family | hash 라 식별 불가 — 보존 무제한 |
| `admin_email_otp` | 이메일 OTP | 만료 30일 후 자동 삭제 |

## 인덱스

성능에 중요한 인덱스 (모델 정의 기준):

```sql
-- 인증
admin_users(email) UNIQUE
admin_users.role
admin_email_otp.user_id

-- 검색·필터
inquiries.status
inquiries.type
documents.status (각 사용자가 자주 필터)
documents.kind
documents.sign_token UNIQUE
documents.created_at

-- 단축 링크
short_links.short_id UNIQUE
short_links.expires_at
short_link_clicks.short_link_id

-- 감사·보안
audit_logs.actor_user_id
audit_logs.actor_email
audit_logs.action
audit_logs.ip
audit_logs.request_id
audit_logs.created_at

-- 콘텐츠
works.slug UNIQUE
works.published
content_blocks.section_key UNIQUE
```

## 마이그레이션 정책

- 첫 부팅 시 `Base.metadata.create_all` 이 새 테이블만 생성.
- 기존 테이블에 컬럼 추가는 `migrations.py` 의 `install_migrations_sync` 가 idempotent SQL 실행 (`ALTER TABLE ADD COLUMN IF NOT EXISTS`).
- 운영 단계 (Aiven MySQL) 로 옮긴 후엔 Alembic 도입 권장.

## 백업

- **Aiven for MySQL 무료 티어**: 자동 백업 2회/일, 보존 2일. paid plan 으로 더 길게.
- **CSV 정기 export**: 어드민 메인의 "CSV 다운로드 폴더" 설정 후 각 페이지 CSV 내보내기. 월 1회 권장.
- **localStorage 캐시**: 일부 어드민 페이지가 backend 휘발 시 localStorage 사본을 보여줌. Aiven 도입 후엔 의존성 낮음.

## ERD 시각화

```bash
# DBML 파일을 dbdiagram.io 에 붙여넣어 시각화
cat docs/database.dbml | pbcopy   # macOS — 클립보드 복사
# 또는 docs/database.dbml 파일 통째로 https://dbdiagram.io/d 에 붙여넣기
```

또는 CLI:

```bash
npm install -g @dbml/cli
dbml2sql docs/database.dbml --mysql > docs/database.sql   # MySQL DDL 생성
dbml2sql docs/database.dbml --postgres > docs/database.pg.sql
```
