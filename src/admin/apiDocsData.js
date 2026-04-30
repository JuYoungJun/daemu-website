// API 문서 페이지의 보조 콘텐츠 — DB 스키마 + 배포/마이그레이션 가이드.
// 별도 모듈로 분리해 AdminApiDocs.jsx 본체가 비대해지지 않게 한다.

// ─────────────────────────────────────────────────────────────────────
// DB 스키마 — backend-py/models.py 기준
//
// 각 테이블에 핵심 컬럼만 적고, 모든 컬럼은 backend GitHub 의 models.py
// 링크로 안내. PII 보존 정책과 사용처를 함께 명시해 운영자가 이 문서만
// 보고도 이해 가능.
// ─────────────────────────────────────────────────────────────────────

export const DB_GROUPS = [
  {
    key: 'auth',
    label: '인증 / 사용자',
    desc: '어드민 콘솔 사용자 + 이메일 OTP. 일반 방문자/파트너와 별도 풀.',
    tables: [
      {
        name: 'admin_users',
        purpose: '어드민 콘솔 로그인 계정. 본 시스템의 모든 권한 결정 단위.',
        columns: [
          { col: 'id', type: 'int PK', note: 'auto-increment' },
          { col: 'email', type: 'varchar(190) UNIQUE', note: '로그인 ID' },
          { col: 'password_hash', type: 'varchar(255)', note: 'bcrypt 12 round' },
          { col: 'role', type: 'varchar(32)', note: 'admin / tester / developer' },
          { col: 'active', type: 'bool', note: '비활성 시 즉시 로그인 차단' },
          { col: 'must_change_password', type: 'bool', note: '첫 로그인 / 관리자 reset 시 true' },
          { col: 'email_verified_at', type: 'datetime?', note: 'null 이면 첫 진입 시 OTP 인증 강제' },
          { col: 'totp_enabled', type: 'bool', note: '2FA 활성 여부' },
          { col: 'totp_secret', type: 'varchar(64)', note: 'pyotp base32 random' },
          { col: 'recovery_codes', type: 'JSON', note: '8개 backup 코드 bcrypt 배열' },
          { col: 'last_login_at', type: 'datetime?', note: '미접속 알림 KPI' },
          { col: 'password_changed_at', type: 'datetime?', note: '비밀번호 회전 정책 추적' },
          { col: 'created_at', type: 'datetime', note: 'server_default now()' },
        ],
        usedBy: ['/admin (모든 페이지의 인증 게이트)', '/admin/users (CRUD)', 'audit_logs.actor_user_id'],
        pii: 'email + password_hash. 보존: 운영 종료 시까지. 비활성·삭제는 audit 로그에 기록.',
      },
      {
        name: 'admin_email_otp',
        purpose: '이메일 인증 / 비밀번호 재설정용 OTP 코드 (6자리).',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'user_id', type: 'int FK→admin_users.id' },
          { col: 'email', type: 'varchar(190)' },
          { col: 'code_hash', type: 'varchar(255)', note: 'bcrypt(6자리 코드)' },
          { col: 'purpose', type: 'varchar(24)', note: 'verify / password_reset' },
          { col: 'attempts', type: 'int', note: '5회 실패 시 lock' },
          { col: 'expires_at', type: 'datetime', note: '발급 후 10분' },
          { col: 'consumed_at', type: 'datetime?', note: '사용 후 timestamp' },
          { col: 'ip', type: 'varchar(45)' },
        ],
        usedBy: ['/api/auth/email-verify/*'],
        pii: '이메일 + IP. 만료 30일 후 cron sweep.',
      },
    ],
  },
  {
    key: 'public',
    label: '공개 사이트',
    desc: 'Contact 폼 / B2B 파트너 / 뉴스레터.',
    tables: [
      {
        name: 'inquiries',
        purpose: 'Contact 폼에서 들어온 상담 문의. 어드민이 응대 + 상태 관리.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'name', type: 'varchar(120)' },
          { col: 'email', type: 'varchar(190) INDEX' },
          { col: 'phone', type: 'varchar(40)' },
          { col: 'brand_name', type: 'varchar(190)', note: '카페·베이커리 브랜드' },
          { col: 'location', type: 'varchar(120)' },
          { col: 'expected_open', type: 'varchar(60)', note: '오픈 예정 시기' },
          { col: 'category', type: 'varchar(60)', note: '신규개설 / 메뉴개발 / etc' },
          { col: 'message', type: 'text' },
          { col: 'status', type: 'varchar(24)', note: '신규 / 처리중 / 답변완료' },
          { col: 'replied_at', type: 'datetime?' },
          { col: 'note', type: 'text', note: '운영자 회신메모' },
          { col: 'privacy_consent_at', type: 'datetime?', note: 'PIPA 동의 시점' },
          { col: 'created_at', type: 'datetime INDEX' },
        ],
        usedBy: ['공개 /contact 폼 → POST /api/inquiries', '/admin/inquiries'],
        pii: '이름 / 전화 / 이메일. 보존 3년 (전자상거래법). cron 자동 sweep.',
      },
      {
        name: 'partners',
        purpose: 'B2B 파트너 가입 신청 + 발급 계정. /partners 포털 로그인 단위.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'company_name', type: 'varchar(190)' },
          { col: 'contact_name', type: 'varchar(120)' },
          { col: 'email', type: 'varchar(190) UNIQUE INDEX' },
          { col: 'phone', type: 'varchar(40)' },
          { col: 'category', type: 'varchar(60)' },
          { col: 'intro', type: 'text', note: '회사 소개' },
          { col: 'status', type: 'varchar(24)', note: '대기 / 승인 / 거절' },
          { col: 'password_hash', type: 'varchar(255)' },
          { col: 'approved_at', type: 'datetime?' },
        ],
        usedBy: ['/partners 가입/로그인', '/admin/partners', 'orders.partner_id'],
        pii: '담당자 + 회사 정보. 사용자 요청 시 즉시 삭제 가능.',
      },
      {
        name: 'newsletter_subscribers',
        purpose: '뉴스레터 옵트인 명단. 캠페인 발송 대상.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'email', type: 'varchar(190) UNIQUE' },
          { col: 'name', type: 'varchar(80)', note: '선택' },
          { col: 'status', type: 'varchar(20)', note: 'active / unsubscribed' },
          { col: 'source', type: 'varchar(40)', note: 'partners_form / footer' },
          { col: 'consent_at', type: 'datetime' },
          { col: 'unsubscribed_at', type: 'datetime?' },
        ],
        usedBy: ['/admin/campaign 의 발송 대상', 'unsubscribe 토큰 링크'],
        pii: '이메일. unsubscribe 후 90일 익명화.',
      },
    ],
  },
  {
    key: 'business',
    label: '발주 / 상품 / 계약',
    desc: '파트너 발주 흐름 + 표준 계약서/PO 템플릿 + e-Sign.',
    tables: [
      {
        name: 'orders',
        purpose: '파트너 발주 — 접수 → 처리중 → 출고완료. 발주번호 자동 부여(DM-PO-YYYY-NNNN).',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'partner_id', type: 'int FK→partners.id' },
          { col: 'title', type: 'varchar(190)' },
          { col: 'status', type: 'varchar(24) INDEX', note: '접수 / 처리중 / 출고완료' },
          { col: 'amount', type: 'int', note: '합계금액 (원)' },
          { col: 'items', type: 'JSON', note: '[{sku, qty, price}]' },
          { col: 'due_date', type: 'datetime?' },
          { col: 'note', type: 'text' },
        ],
        usedBy: ['/admin/orders', 'documents.order_id (계약서 연결)', '메일 템플릿 변수'],
        pii: '없음 (회사명만).',
      },
      {
        name: 'document_templates',
        purpose: '표준 계약서/발주서/NDA 템플릿. 변수 placeholder 정의.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'kind', type: 'varchar(24)', note: 'contract / purchase_order / nda' },
          { col: 'name', type: 'varchar(190)' },
          { col: 'subject', type: 'varchar(255)' },
          { col: 'body', type: 'text' },
          { col: 'variables', type: 'JSON', note: '[{key, label, group, placeholder}]' },
          { col: 'active', type: 'bool' },
        ],
        usedBy: ['/admin/contracts (템플릿 탭)'],
        pii: '없음.',
      },
      {
        name: 'documents',
        purpose: '발급된 문서 인스턴스. 변수 치환된 final body + 서명 토큰 + 상태 흐름.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'template_id', type: 'int FK→document_templates.id' },
          { col: 'kind', type: 'varchar(24)', note: 'contract / purchase_order' },
          { col: 'title', type: 'varchar(255)' },
          { col: 'body', type: 'text', note: '변수 치환 후 final' },
          { col: 'variables', type: 'JSON', note: '입력된 변수 값' },
          { col: 'recipients', type: 'JSON', note: '[{name, email, role}]' },
          { col: 'crm_id / partner_id / order_id / work_id', type: 'int? FK', note: '연결 엔티티 (선택)' },
          { col: 'status', type: 'varchar(24) INDEX', note: 'draft / sent / viewed / signed / canceled' },
          { col: 'sign_token', type: 'varchar(64) UNIQUE', note: 'HMAC 서명 토큰 - /sign/{token}' },
          { col: 'sent_at / first_viewed_at / signed_at / canceled_at', type: 'datetime?' },
          { col: 'history', type: 'JSON', note: 'audit trail [{ts, event, actor, ip}]' },
          { col: 'created_by', type: 'int FK→admin_users.id' },
        ],
        usedBy: ['/admin/contracts', '/sign/{token} 공개 서명 페이지'],
        pii: 'recipients 의 이메일/이름. 서명된 문서는 5년 보존.',
      },
      {
        name: 'document_signatures',
        purpose: '서명 기록 — 한 문서에 여러 서명자(우리 + 고객) 별도 row.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'document_id', type: 'int FK→documents.id' },
          { col: 'signer_email / signer_name / signer_role', type: 'varchar' },
          { col: 'signature_image_url', type: 'text', note: 'data:image/png;base64,... 또는 https://' },
          { col: 'signed_ip / signed_user_agent', type: 'varchar', note: '위변조 검증 자료' },
          { col: 'signed_at', type: 'datetime' },
        ],
        usedBy: ['/sign/{token} → POST /api/documents/sign'],
        pii: 'IP + 서명 이미지. 분쟁 대비 5년 보존.',
      },
    ],
  },
  {
    key: 'content',
    label: '콘텐츠 / 미디어',
    desc: '포트폴리오 / 사이트 텍스트 블록 / 팝업 배너.',
    tables: [
      {
        name: 'works',
        purpose: '/work 포트폴리오 항목. slug 기반 URL.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'slug', type: 'varchar(120) UNIQUE', note: 'URL 식별자. 변경 X 권장' },
          { col: 'title / category / summary', type: 'varchar/text' },
          { col: 'content_md', type: 'text', note: 'Markdown 본문' },
          { col: 'hero_image_url', type: 'varchar(500)' },
          { col: 'gallery / tags', type: 'JSON' },
          { col: 'location / year / size_label / floor_label', type: 'varchar' },
          { col: 'published', type: 'bool INDEX', note: 'false 면 내부 임시 저장' },
          { col: 'sort_order', type: 'int', note: '낮을수록 앞 (작은 수 우선)' },
        ],
        usedBy: ['공개 /work', '/work/{slug}', '/admin/works'],
        pii: '없음.',
      },
      {
        name: 'content_blocks',
        purpose: '사이트 텍스트 블록 (회사 소개, 연혁, FAQ 등). section_key 로 lookup.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'section_key', type: 'varchar(60) UNIQUE', note: 'home_about / service_intro' },
          { col: 'title', type: 'varchar(255)' },
          { col: 'body_md', type: 'text' },
          { col: 'meta', type: 'JSON' },
        ],
        usedBy: ['모든 공개 페이지의 본문', '/admin/content'],
        pii: '없음.',
      },
      {
        name: 'site_popups',
        purpose: '사이트 팝업 배너 + 노출/클릭 통계.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'title / image_url / body / cta_label / cta_url', type: 'varchar/text' },
          { col: 'position', type: 'varchar(20)', note: 'center / bottom-right / top' },
          { col: 'frequency', type: 'varchar(20)', note: 'always / once-per-day / once-forever' },
          { col: 'target_pages', type: 'JSON', note: '["home", "work"] 등' },
          { col: 'status', type: 'varchar(20)', note: 'active / paused / expired' },
          { col: 'date_from / date_to', type: 'date' },
          { col: 'impressions / clicks', type: 'int', note: 'CTR 자동 계산' },
        ],
        usedBy: ['공개 사이트 자동 노출', '/admin/popup'],
        pii: '없음.',
      },
    ],
  },
  {
    key: 'mail',
    label: '메일 / 캠페인',
    desc: '자동회신 / 단체 발송 / 캠페인 / 발송 이력.',
    tables: [
      {
        name: 'mail_templates',
        purpose: '자동회신 / 운영 mail. kind 별 단 1건만 (UNIQUE).',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'kind', type: 'varchar(40) UNIQUE', note: 'auto-reply / admin-reply / document' },
          { col: 'subject / body / html', type: 'varchar/text' },
          { col: 'images', type: 'JSON' },
          { col: 'category', type: 'varchar(60)', note: 'all / 카테고리별 분기' },
          { col: 'active', type: 'bool' },
        ],
        usedBy: ['/admin/mail', '문의 자동회신', '문서 발송'],
        pii: '없음 (템플릿 자체).',
      },
      {
        name: 'mail_template_lib',
        purpose: '단체 발송용 템플릿 라이브러리. 다수 저장 + 재사용.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'name / subject / body', type: 'varchar/text' },
          { col: 'category', type: 'varchar(40)' },
          { col: 'active / uses_count / last_used_at', type: 'misc', note: '활용도 추적' },
        ],
        usedBy: ['/admin/mail-templates', '단체 발송 패널'],
        pii: '없음.',
      },
      {
        name: 'campaigns',
        purpose: '이메일/SMS/카카오 캠페인 레코드 + 통계.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'name / channel / subject / body', type: 'misc' },
          { col: 'status', type: 'varchar(20)', note: 'draft / scheduled / sent / failed' },
          { col: 'target', type: 'JSON', note: '세그먼트 정의 (CRM 단계 / 태그 등)' },
          { col: 'recipients_count / sent_count / opened_count / clicked_count', type: 'int' },
          { col: 'scheduled_at / sent_at', type: 'datetime?' },
        ],
        usedBy: ['/admin/campaign'],
        pii: '없음 (수신자 명단은 별도).',
      },
      {
        name: 'outbox',
        purpose: '모든 메일 발송 이력 (운영 로그). 백엔드 출력 전 단계의 모든 시도 기록.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'ts', type: 'datetime' },
          { col: 'path', type: 'varchar(120)', note: '호출된 endpoint' },
          { col: 'to_email / to_name / subject', type: 'varchar' },
          { col: 'body_preview', type: 'text', note: '500자 까지' },
          { col: 'status', type: 'varchar(20)', note: 'sent / failed / error / simulated' },
          { col: 'error', type: 'varchar(500)' },
        ],
        usedBy: ['/admin/outbox', '/admin/monitoring'],
        pii: '수신자 이메일 + body. 비밀번호/토큰류는 자동 [REDACTED].',
      },
      {
        name: 'promotions',
        purpose: '쿠폰 코드 + 사용량 추적.',
        columns: [
          { col: 'id / code / type / discount', type: 'misc' },
          { col: 'valid_from / valid_until', type: 'date' },
          { col: 'max_uses / used / active', type: 'int / bool' },
        ],
        usedBy: ['/admin/promotion'],
        pii: '없음.',
      },
    ],
  },
  {
    key: 'crm',
    label: 'CRM',
    desc: '리드 → 검토중 → 전환 파이프라인.',
    tables: [
      {
        name: 'crm_customers',
        purpose: '잠재 고객 → 전환 고객까지 파이프라인. 활동 메모 타임라인.',
        columns: [
          { col: 'id / name / company / email / phone', type: 'misc' },
          { col: 'source', type: 'varchar(60)', note: '유입경로' },
          { col: 'status', type: 'varchar(20)', note: 'lead / qualified / customer / lost' },
          { col: 'estimated_value', type: 'int', note: '예상 거래 금액' },
          { col: 'tags', type: 'JSON' },
          { col: 'summary', type: 'text' },
          { col: 'notes', type: 'JSON', note: '활동 메모 [{ts, text}]' },
        ],
        usedBy: ['/admin/crm', '캠페인 세그먼트', 'documents.crm_id'],
        pii: '이름 / 이메일 / 전화 / 활동 메모. 사용자 요청 시 즉시 삭제.',
      },
    ],
  },
  {
    key: 'shortlink',
    label: '단축 링크 (UTM)',
    desc: 'QR_SECURITY.md Stage 2 — HMAC 서명된 단축 URL + 익명화된 클릭 통계.',
    tables: [
      {
        name: 'short_links',
        purpose: 'UTM 캠페인용 단축 URL. HMAC 서명으로 위변조·재사용 차단.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'short_id', type: 'varchar(16) UNIQUE INDEX', note: 'URL safe 8자 random' },
          { col: 'target_url', type: 'text', note: '실제 redirect 대상 (UTM 쿼리 포함)' },
          { col: 'sig', type: 'varchar(64)', note: 'HMAC-SHA256(target_url + short_id, server_secret)' },
          { col: 'expires_at', type: 'datetime?', note: 'null 이면 무기한' },
          { col: 'max_clicks', type: 'int?', note: 'null 이면 무제한' },
          { col: 'click_count / last_clicked_at', type: 'int / datetime?' },
          { col: 'revoked_at / revoked_reason', type: 'datetime / varchar', note: '운영자가 무효화 시 채움' },
          { col: 'label', type: 'varchar(120)', note: '캠페인 식별 라벨' },
          { col: 'created_by', type: 'int FK→admin_users.id' },
        ],
        usedBy: ['/admin/utm-builder', '/r/{short_id} 공개 redirect'],
        pii: '없음 (target URL 만 저장).',
      },
      {
        name: 'short_link_clicks',
        purpose: '클릭 이벤트 — PII 최소화 형태로만 (IP hash + UA family).',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'short_link_id', type: 'int FK→short_links.id' },
          { col: 'clicked_at', type: 'datetime' },
          { col: 'ip_hash', type: 'varchar(64)', note: 'HMAC-SHA256(IP, secret) — 식별 불가' },
          { col: 'ua_family', type: 'varchar(40)', note: 'chrome / safari / mobile-chrome' },
          { col: 'referer_host', type: 'varchar(120)', note: 'host 부분만' },
        ],
        usedBy: ['/admin/utm-builder 의 통계 패널'],
        pii: 'IP는 hash. 식별 불가라 무기한 보존 가능.',
      },
    ],
  },
  {
    key: 'security',
    label: '보안 / 감사',
    desc: 'PIPA 제29조 안전성 확보 — 보존 ≥ 1년.',
    tables: [
      {
        name: 'audit_logs',
        purpose: '모든 인증 / 권한 / CRUD 이벤트 자동 기록. 침해 사고 시 forensic 자료.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'actor_user_id', type: 'int? FK→admin_users.id' },
          { col: 'actor_email', type: 'varchar(190) INDEX' },
          { col: 'action', type: 'varchar(60) INDEX', note: 'login.success / login.failure / password.change / role.change / user.create / inquiry.delete / endpoint.access' },
          { col: 'target_type / target_id', type: 'varchar', note: '대상 엔티티 식별' },
          { col: 'ip / user_agent / request_id', type: 'varchar' },
          { col: 'detail', type: 'JSON', note: '구체 변경 내용 (before / after 등)' },
          { col: 'created_at', type: 'datetime INDEX' },
        ],
        usedBy: ['/admin/security 실시간 이벤트', '/api/audit-logs'],
        pii: 'IP + 이메일. **보존 ≥ 1년**, cron sweep 안 함. 개인정보보호법 제29조.',
      },
      {
        name: 'suspicious_events',
        purpose: '의심 이벤트 — 운영자가 검토 후 resolve 처리.',
        columns: [
          { col: 'id', type: 'int PK' },
          { col: 'ts', type: 'datetime' },
          { col: 'kind', type: 'varchar(40)', note: 'token_leak / brute_force / rate_limit / bot' },
          { col: 'severity', type: 'varchar(12)', note: 'low / medium / high / critical' },
          { col: 'ip / user_agent', type: 'varchar' },
          { col: 'detail', type: 'JSON' },
          { col: 'resolved_at / resolved_by / resolution_note', type: 'datetime / FK / varchar' },
        ],
        usedBy: ['/admin/security 의심 IP 패널', '/admin/monitoring'],
        pii: 'IP + UA. high/critical 365일, 그 외 90일 보존.',
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────
// 권한 매트릭스 — backend/auth.py PERMISSIONS dict 기반
// ─────────────────────────────────────────────────────────────────────

export const PERMISSION_MATRIX = [
  { resource: 'users',           admin: 'ALL', tester: '—',    developer: '—'   },
  { resource: 'inquiries',       admin: 'ALL', tester: 'READ', developer: '—'   },
  { resource: 'partners',        admin: 'ALL', tester: '—',    developer: '—'   },
  { resource: 'orders',          admin: 'ALL', tester: 'READ', developer: '—'   },
  { resource: 'works',           admin: 'ALL', tester: 'READ', developer: 'ALL' },
  { resource: 'popups',          admin: 'ALL', tester: 'ALL',  developer: 'ALL' },
  { resource: 'crm',             admin: 'ALL', tester: '—',    developer: '—'   },
  { resource: 'campaigns',       admin: 'ALL', tester: '—',    developer: '—'   },
  { resource: 'promotions',      admin: 'ALL', tester: '—',    developer: '—'   },
  { resource: 'outbox',          admin: 'ALL', tester: 'READ', developer: 'READ' },
  { resource: 'mail-template',   admin: 'ALL', tester: 'READ', developer: 'ALL' },
  { resource: 'content',         admin: 'ALL', tester: '—',    developer: 'ALL' },
  { resource: 'partner-brands',  admin: 'ALL', tester: 'READ', developer: 'ALL' },
  { resource: 'newsletter',      admin: 'ALL', tester: 'READ', developer: '—'   },
  { resource: 'monitoring',      admin: 'READ',tester: '—',    developer: 'READ' },
  { resource: 'documents',       admin: 'ALL', tester: 'READ', developer: '—'   },
  { resource: 'document-templates', admin: 'ALL', tester: '—', developer: 'READ' },
  { resource: 'products',        admin: 'ALL', tester: 'READ', developer: '—'   },
  { resource: 'audit-logs',      admin: 'READ',tester: '—',    developer: 'READ' },
  { resource: 'analytics',       admin: 'ALL', tester: 'READ', developer: 'READ' },
  { resource: 'contracts',       admin: 'ALL', tester: 'READ', developer: '—'   },
];

// ─────────────────────────────────────────────────────────────────────
// 배포 / 마이그레이션 가이드 — Cafe24 / Aiven / Render 환경별 단계
// ─────────────────────────────────────────────────────────────────────

export const DEPLOY_GROUPS = [
  {
    key: 'env',
    label: '환경 구성 비교',
    sections: [
      {
        title: '현재 (Render free + Aiven MySQL)',
        body: `프론트는 GitHub Pages, 백엔드는 Render free, DB 는 Aiven MySQL 무료. 운영 비용 0원이지만:
- Render free 는 15분 idle 후 슬립 → 첫 요청 cold-start 30초+
- Aiven 무료 1GB / 5 connections / 백업 2일
- 외부 cron(UptimeRobot) 으로 슬립 회피 권장`,
      },
      {
        title: '권장 운영 (Cafe24 VPS + Aiven 또는 Cafe24 자체 MySQL)',
        body: `한국 호스팅 Cafe24 의 VPS / Cloud Server 에 백엔드 self-host.
- VPS 가격: 월 11,000~33,000원 (2vCPU/2GB)
- 슬립 없음 / 한국 IP / 도메인 같이 등록 가능
- DB 옵션 A: Aiven 그대로 유지 (외부) — 부하 분산
- DB 옵션 B: Cafe24 같은 VPS 안에 MySQL 자체 설치 — latency ↓, 단 백업 본인 책임`,
      },
      {
        title: '환경변수 매트릭스',
        table: {
          headers: ['변수', 'Render (현재)', 'Cafe24 (이전 후)', '의미'],
          rows: [
            ['DATABASE_URL',          '필수 (Aiven URL)',     '동일 또는 mysql+aiomysql://localhost', 'DB 연결 문자열'],
            ['MYSQL_DRIVER',          'aiomysql',             'aiomysql',                          'caching_sha2 호환성'],
            ['MYSQL_SSL_CA',          'Aiven CA PEM',         'self-host 면 비움',                 'SSL verify'],
            ['DAEMU_MYSQL_SSL_DISABLE', '미설정',             '1 (self-host MySQL)',               'SSL 자체 끄기'],
            ['JWT_SECRET',            '필수 (32+자 random)',  '동일 (rotate 권장)',                'JWT 서명'],
            ['SHORT_LINK_HMAC_SECRET','필수',                 '동일',                              '단축링크 서명'],
            ['RESEND_API_KEY',        '있음',                 '동일',                              '메일 발송 (Resend)'],
            ['ALLOWED_ORIGINS',       'GitHub Pages URL',     '본인 도메인',                       'CORS allow-list'],
            ['PUBLIC_BASE',           '미설정 (자동)',        '본인 도메인 https://...',           '단축링크 prefix'],
            ['ADMIN_EMAIL/PASSWORD',  '시드 default',         '신규 setup 시 설정',                '첫 부팅 default 어드민'],
            ['ENV',                   '미설정',               'prod',                              '운영 모드 분기'],
            ['VITE_API_BASE_URL (frontend)', 'daemu-py.onrender.com', 'api.본인도메인.kr',         'frontend 가 호출할 backend'],
          ],
        },
      },
    ],
  },
  {
    key: 'cafe24',
    label: 'Cafe24 마이그레이션 (30분)',
    sections: [
      {
        title: '한 번에 끝내는 자동화 키트',
        body: `프로젝트 안에 deploy/cafe24/ 디렉토리가 있고, 그 안에 setup.sh / nginx.conf / daemu-backend.service / .env.example / deploy.sh / backup.sh / README.md 가 모두 들어 있습니다. 처음 해도 30분이면 정상 운영. 요약 흐름:

  1) DNS A record (~5분)
  2) 서버에서  sudo bash deploy/cafe24/setup.sh  (~5분)
  3) /srv/daemu/backend/.env 작성 (~5분)
  4) 로컬에서  bash deploy/cafe24/deploy.sh  (~3분)
  5) sudo certbot --nginx -d <domain>  (~2분)
  6) curl https://<domain>/api/health 검증

전체 단계별 가이드는 deploy/cafe24/README.md 에 있고, 트러블슈팅 표 + 롤백 절차도 같이 들어 있습니다.`,
      },
      {
        title: '1단계 — Cafe24 클라우드 서버 신청',
        body: `https://www.cafe24.com/ → 호스팅 → 클라우드 서버. Ubuntu 22.04 LTS / 1Core·1GB / SSD 50GB 가 데모/초기 운영 권장 (월 ~9,900원). 신청 후 SSH 접속 정보 + 공인 IP 발급.`,
      },
      {
        title: '2단계 — DNS A record + Aiven IP allowlist',
        body: `Cafe24 도메인센터(또는 Cloudflare) 에서 A record:
- @         → 서버 공인 IP
- www       → 서버 공인 IP
DNS 전파 5분~24시간.

⚠ Aiven Console → "Allowed IP addresses" 에 서버 공인 IP 추가 필수. 누락 시 backend 가 DB 에 연결 못 함.`,
      },
      {
        title: '3단계 — 서버 부트스트랩 (자동 스크립트)',
        body: `setup.sh 한 줄로 nginx + python3.11 + node20 + certbot + ufw + fail2ban + systemd + 백업 cron 까지 일괄 설치.`,
        code: `# 서버에서 (root)
ssh root@<서버IP>
cd /tmp && git clone https://github.com/JuYoungJun/daemu-website.git
cd daemu-website
sudo bash deploy/cafe24/setup.sh

# 도메인 placeholder 일괄 치환
DOMAIN="daemu.kr"   # 본인 도메인
sudo sed -i "s/example\\.daemu\\.kr/$DOMAIN/g" /etc/nginx/sites-available/daemu
sudo nginx -t && sudo systemctl reload nginx`,
      },
      {
        title: '4단계 — .env 작성',
        body: `Aiven URL + CA PEM + 시크릿 random 발급 + 시드 어드민. 모든 항목은 deploy/cafe24/.env.example 의 주석에 설명되어 있음.`,
        code: `sudo cp /tmp/daemu-website/deploy/cafe24/.env.example /srv/daemu/backend/.env
sudo nano /srv/daemu/backend/.env
sudo chown daemu:daemu /srv/daemu/backend/.env
sudo chmod 600 /srv/daemu/backend/.env

# 시크릿 발급 1회용
openssl rand -hex 32   # → JWT_SECRET
openssl rand -hex 32   # → SHORT_LINK_HMAC_SECRET`,
      },
      {
        title: '5단계 — 첫 배포 (로컬에서)',
        body: `deploy.sh 가 npm build → rsync → 원격 venv 갱신 + systemctl restart 까지 자동.`,
        code: `# 로컬에서
cat >> ~/.daemu-deploy.env <<EOF
export DEPLOY_HOST=daemu.kr
export DEPLOY_USER=daemu
export DEPLOY_KEY_PATH=$HOME/.ssh/id_ed25519
EOF

# daemu 가 sudo restart 가능하게 (서버에서 1회)
ssh root@daemu.kr 'cat > /etc/sudoers.d/daemu-deploy <<EOL
daemu ALL=(root) NOPASSWD: /bin/systemctl restart daemu-backend, /bin/systemctl reload nginx
EOL
chmod 440 /etc/sudoers.d/daemu-deploy'

bash deploy/cafe24/deploy.sh   # 첫 배포`,
      },
      {
        title: '6단계 — HTTPS (Let\'s Encrypt)',
        body: `DNS 가 서버 IP 가리키는 게 확인되면 한 줄.`,
        code: `sudo certbot --nginx \\
  -d daemu.kr -d www.daemu.kr \\
  --non-interactive --agree-tos -m admin@daemu.kr --redirect

# 자동 갱신 cron 도 자동 등록.  systemctl status certbot.timer  로 확인.`,
      },
      {
        title: '7단계 — 검증',
        code: `# 1) backend health
curl -fsS https://daemu.kr/api/health | jq '{ok, databaseConnected, emailProvider}'
# → {"ok":true, "databaseConnected":true, "emailProvider":"resend"}

# 2) admin
# 브라우저 → https://daemu.kr/admin

# 3) systemd 상태
ssh daemu@daemu.kr 'sudo systemctl status daemu-backend'

# 4) journalctl
ssh daemu@daemu.kr 'sudo journalctl -u daemu-backend -n 20'

# 5) 백업 cron
ssh daemu@daemu.kr 'cat /etc/cron.d/daemu-backup'`,
      },
      {
        title: '재배포 / 롤백',
        body: `이후 코드 변경 시:`,
        code: `# 재배포 (원격에서 매번 push 한 효과)
bash deploy/cafe24/deploy.sh

# 롤백 (직전 커밋으로)
git checkout HEAD~1 -- backend-py/
bash deploy/cafe24/deploy.sh

# DB 복원 (재해 복구)
ssh daemu@daemu.kr
gunzip < /srv/daemu/backups/db/daemu-YYYYMMDD-HHMM.sql.gz | mysql ...`,
      },
      {
        title: '트러블슈팅 (자주 발생)',
        table: {
          headers: ['증상', '원인 / 조치'],
          rows: [
            ['databaseConnected: false', 'Aiven IP allowlist 에 서버 공인 IP 누락. Aiven Console 에 추가.'],
            ['Access denied for user', '비밀번호 url-unsafe 문자. logs 의 자동 url-encode 메시지 확인 또는 Aiven 에서 reset.'],
            ['caching_sha2_password 핸드셰이크 실패', '.env 의 MYSQL_DRIVER=aiomysql 로 변경 + restart.'],
            ['502 Bad Gateway', 'uvicorn 죽음. journalctl -u daemu-backend -n 50 으로 traceback 확인.'],
            ['admin 새로고침 시 자동 로그아웃', 'JWT_SECRET 미설정 → 재배포마다 secret 갱신. 고정값 set.'],
            ['QR redirect 만 500', 'logs 의 [short-links] rid=... 검색. tz-aware 비교 또는 DB 단절 가능.'],
            ['nginx connect() failed', 'systemd unit port (8001) 와 nginx proxy_pass port 일치 확인.'],
            ['인증서 만료 알림', 'systemctl status certbot.timer  + sudo certbot renew --dry-run.'],
          ],
        },
      },
    ],
  },
  {
    key: 'security-ops',
    label: '운영 보안 체크리스트',
    sections: [
      {
        title: '필수',
        bullets: [
          'JWT_SECRET / SHORT_LINK_HMAC_SECRET 은 32자+ random. .env 에만 저장. git 절대 X.',
          'ENV=prod 설정. TEST_ADMIN_EMAIL/PASSWORD 는 자동으로 거부됨.',
          'ALLOWED_ORIGINS 에 본인 도메인만. * 절대 X.',
          'fail2ban + ufw 활성. SSH 비밀번호 로그인 차단(키 인증만).',
          'mysqldump 일별 백업. 30일 보존.',
          'cryptography / aiomysql 등 의존성 정기 업그레이드 (Snyk 자동).',
        ],
      },
      {
        title: '운영자 단계 (점진적 강화)',
        bullets: [
          'Cloudflare Free WAF — DNS CNAME 변경만으로 적용. DDoS / Bot 차단.',
          'UptimeRobot — Render 슬립 차단 + 다운타임 알림 (5분 ping).',
          'Wazuh / OSSEC — 호스트 IDS. 파일 무결성 + 로그 분석.',
          'Trivy / OWASP ZAP — 이미 GitHub Actions 자동.',
          '90일마다 admin 비밀번호 회전, 2FA 점검.',
        ],
      },
    ],
  },
];
