# DEMO_LIMITATIONS — 현재 데모 단계 운영 한계 (2026-05-04)

> **이 문서는 현재 데모 단계의 범위와 운영 전환 전 결정해야 할 사항을 정리한 안내서입니다.**
> 운영 전환 시에는 별도의 내부 운영 체크리스트를 기준으로 서버, 도메인, 데이터베이스,
> 보안 설정, 백업, 모니터링 등을 점검합니다.
>
> 작성 시점 가정: 클라이언트에게 **무상 데모**를 보여주는 단계.
> 결제·계약·도메인·운영 DB 모두 미확정.

---

## 1. 프로젝트 단계 정의

| 단계 | 설명 | 현재 위치 |
|---|---|---|
| 0. 데모 | 클라이언트 시연 + 피드백 수집 | ✅ **현재 단계** |
| 1. 결제·계약 | 클라이언트 결제 후 운영 의사 결정 | ⏳ 대기 |
| 2. 운영 전환 | 도메인 / 서버 / 운영 DB / 시크릿 재발급 | ⏳ 대기 |
| 3. 운영 가동 | 실제 고객 데이터 입력 시작 | ⏳ 대기 |
| 4. 장기 유지보수 | 보안 패치 / 콘텐츠 관리 / 백업 점검 | ⏳ 대기 |

본 문서가 다루는 범위는 **0단계 (데모)** 의 정상 한계입니다.
이 한계는 단계 0 의 *결함*이 아니라 *정상 상태*입니다 — 단계가 올라갈 때 자연스럽게 해소됩니다.

---

## 2. 현재 호스팅 구성 (데모 한정)

| 컴포넌트 | 위치 | 비용 | 운영 적합도 |
|---|---|---|---|
| 정적 프론트 (React 빌드 산출물) | GitHub Pages (`/daemu-website/`) | 무료 | 단순 정적 사이트는 적합. 단, GH Pages 는 SPA fallback 미지원이라 `public/404.html` 의 sessionStorage 트릭으로 보완 중. |
| 백엔드 API (`backend-py/` FastAPI) | Render Free Plan | 무료 | **데모 한정**. 운영에는 부적합. |
| 데이터베이스 | Aiven MySQL Free / 또는 SQLite | 무료 / 0 | **데모 한정**. 운영 DB 미정. |
| 메일 발송 | Resend | 무료 한도 내 | 운영도 가능하나 발신 도메인 인증 필요. |
| 파일 업로드 | Render 인스턴스 로컬 디스크 | 무료 | **휘발성** — 인스턴스 재시작 시 소실. 운영 부적합. |

### 2.1 Render Free Plan 의 알려진 제약

다음은 *버그가 아니라 무료 티어의 사양*입니다. 클라이언트 데모 중 발생해도 정상입니다.

- **15분 idle → 자동 sleep**: 처음 요청은 콜드 스타트로 30~60초 지연.
- 사이트 코드(`src/lib/keepAlive.js`) 가 사이트 방문자가 있을 때 5분 간격으로 백엔드를 ping 해 슬립을 늦추지만, 24시간 무 트래픽 시 결국 sleep 됩니다.
- 외부 cron(UptimeRobot 등) + GitHub Actions cron 으로 보강 가능 — 그러나 **750시간/월 무료 한도** 안에서만 깨어 있습니다.
- **로컬 디스크 휘발성**: 어드민에서 업로드한 이미지는 다음 배포 시 사라집니다. 데모 영상 촬영용으로만 활용해 주세요.
- **CPU/메모리 제한**: 트래픽이 몰리면 응답 지연 발생.

### 2.2 GitHub Pages 의 알려진 제약

- SPA route 직접 새로고침 (`/admin/users`) 시 GH Pages 가 `404` 응답을 보내는 게 정상.
- 본 저장소는 `public/404.html` → `sessionStorage` → `src/main.jsx` 가 `history.replaceState` 로 path 를 복원하는 방식으로 우회 처리됨.
- 첫 1회만 짧게 깜빡일 수 있으나 어드민 페이지로 정상 진입됨.
- 운영 단계에서는 SPA rewrite 를 지원하는 nginx 또는 Cloudflare Pages 등으로 이전 권장.

### 2.3 도메인 / SSL

- 현재 데모 URL: `https://juyoungjun.github.io/daemu-website/` (GitHub Pages 기본 도메인).
- 운영 도메인(`daemu.kr` 등)은 **클라이언트 결제 후 결정**.
- `index.html` / `public/robots.txt` / `public/sitemap.xml` / `public/llms.txt` / `public/.well-known/security.txt` 의 절대 URL 은 운영 도메인 발급 후 일괄 `sed` 치환 (방법은 `index.html` 상단 주석 참고).

---

## 3. 어드민 계정 (데모용)

> **데모 계정은 시연 전용입니다. 운영 단계에서 반드시 비밀번호를 변경하고 시크릿을 재발급해야 합니다.**

- 로컬 / Render 데모 환경에서는 임시 ADMIN 계정이 환경변수 `ADMIN_PASSWORD` 로 설정됩니다.
- 데모 비밀번호 후보 리스트(`daemu1234` / `tester1234` / `dev1234` / `admin1234` / `1234` / `password`) 는 `backend-py/auth.py` 에서 **`ENV=prod` 일 때 부팅 거부**(RuntimeError)되도록 차단되어 있습니다 — 약한 기본값으로는 운영 부팅이 불가능합니다.
- 데모 비밀번호는 본 개발자가 사전에 안전한 임시값으로 설정한 뒤 클라이언트에게 전달합니다.
- 클라이언트는 데모 종료 후 본 개발자에게 비밀번호 폐기를 요청하면 됩니다.
- 운영 전환 시: `ADMIN_PASSWORD` / `JWT_SECRET` / `RESEND_API_KEY` / DB 자격증명 모두 **재발급**합니다 (절차는 별도 내부 운영 체크리스트에 정리되어 있습니다).

---

## 4. 데이터 입력 가이드 (중요)

데모 단계에서는 다음 데이터를 **절대 입력하지 마십시오**:

- 실제 고객의 성명·연락처·이메일 (시연용 가공 데이터만 사용)
- 실제 결제·계약·세무 정보
- 비공개 사업 전략 / 가격표 / 거래처 정보
- 실제 직원의 사번·주민번호 등 식별 정보

이유:
1. Render 무료 인스턴스는 운영 등급 SLA 가 없으며 디스크 휘발성으로 데이터 유실 가능성이 있습니다.
2. 운영 DB 가 미정이므로, 데모 DB 의 데이터는 운영 시작 시 **전체 초기화** 됩니다.
3. PIPA(개인정보 보호법) 관점에서, 데모 단계는 정식 데이터 처리 동의·보존정책이 적용되지 않습니다.

데모 시연용 샘플 데이터는 `backend-py/manage.py seed` (있다면) 또는 어드민에서 직접 가공 데이터를 입력해 사용하세요.

---

## 5. 업로드 / 첨부 파일

- 본 시점 백엔드 업로드 검증은 적용되어 있습니다:
  - 단일 파일 최대 **10MB**, 합계 **20MB**
  - `base64.b64decode(validate=True)` strict 디코딩
  - 차단 확장자: `.html .js .svg .exe .bat .sh .php` 등 22종 (`backend-py/main.py` `DENIED_EXTS`)
- **다만 저장 위치가 Render 로컬 디스크라 휘발성**입니다. 업로드된 이미지는 재배포 시 사라집니다.
- 운영 단계에서 영구 보존이 필요하면 S3 / Cloudflare R2 / Cafe24 자체 스토리지로 이전이 필수입니다 (별도 내부 운영 체크리스트 참고).

---

## 6. 옛 정적 어드민 백업 (`_backup-static-2026-04-27/`)

- 현재 React + FastAPI 어드민으로 마이그레이션이 끝난 상태입니다.
- 마이그레이션 전의 옛 정적 HTML 어드민 (`admin.html`, `admin-shared.js`, `admin-{works,inquiries,partners,...}.html`) 이 로컬 디스크의 `_backup-static-2026-04-27/` 디렉터리에 보존되어 있습니다.
- **이 디렉터리는 `.gitignore` 에 의해 git tracked 되지 않으며 GitHub Pages 배포 산출물에 포함되지 않습니다 → 외부 사용자에게 도달 불가능합니다.**
- 후속 정리 작업은 Phase 3 (운영 안정화 후) 로 미뤄져 있습니다.
- 작업자 주의:
  - **`public/` 디렉터리로 절대 복사하지 마십시오** — 복사하는 즉시 옛 어드민이 외부에 노출됩니다.
  - 디렉터리 내부에 `README.txt` 가 있으면 그 안내를 따라 주세요.

---

## 7. 인증 / 세션 관련

- 인증 경로: **JWT 토큰 단일 경로** (`backend-py/auth.py` + `src/lib/auth.js`).
- localStorage 의 `daemu_admin_auth` 플래그(`LEGACY_KEY`)는 옛 정적 어드민 시절의 마이그레이션 보조 플래그입니다 — 별도 인증 우회 경로가 아닙니다.
- localStorage 의 `DB.*` 키들은 어드민 RawPage hydrate 캐시입니다 — 백엔드 진실값과 미러됩니다.
- 클라이언트 캐시를 변조해도 백엔드 권한 검사는 우회되지 않습니다 (`require_perm` 의존성으로 모든 어드민 API 가 보호됨).

---

## 8. 보안 스캔 / CI

- 본 저장소 GitHub Actions:
  - `ci.yml` (빌드 + 린트, 일부 step `continue-on-error`)
  - `security-scan.yml` (Trivy)
  - `snyk.yml` (Snyk dependency check)
  - `lighthouse.yml` (성능)
- **현 시점 보안 스캔은 informational only** — 실패해도 머지 차단되지 않습니다.
- 운영 전환 시 critical/high finding 을 blocking 으로 승격해야 합니다 (별도 내부 운영 체크리스트 참고).

---

## 9. 자동화 테스트

- `backend-py/tests/test_security.py` — 16건 (env validation, masking, attachment 거부 등).
- 인증 happy/fail path, 권한 매트릭스, 업로드 거부 시나리오 등 **통합 테스트는 데모 단계 기준으로 부족합니다**.
- 프론트엔드 자동화 테스트는 0건 (데모 한정 정상).
- 운영 전환 시 smoke test 4~6건 추가 권장 (별도 내부 운영 체크리스트).

---

## 10. 데모 단계에서 안전한 항목 (그대로 유지)

- React + FastAPI 단일 진실 원천 아키텍처.
- ENV=prod fail-closed 비밀번호 약함 차단.
- 백엔드 마스킹 유틸리티(`security_utils.py`) — 24개 secret key 패턴 + 8개 inline regex.
- `/api/health` 공개 / `/api/admin/health` 인증 필수 분리.
- `archive/backend-cf/` 3중 무력화 (scripts→exit 1, fetch→503, wrangler.toml.disabled).
- 첨부 파일 strict 검증 + 차단 확장자.
- GH Pages 404 fallback path 복원.
- 시연용 어드민 계정 임시 비밀번호.
- Resend 메일 발송(테스트 도메인).

---

## 11. 운영 전환 전 반드시 수정되어야 할 항목 (요약)

세부 절차는 별도 내부 운영 체크리스트에 P0/P1/P2 로 분류되어 있습니다. 아래는 한눈 요약:

### 🔴 P0 (운영 부팅 차단 사유)
- `MYSQL_SSL_CA` 미설정 시 `verify_mode=CERT_NONE` 로 fall-back 되는 동작 — 운영에서는 RuntimeError 로 차단되어야 함.
- `DATABASE_URL` 이 운영에서 SQLite 가 아닌 MySQL/aiomysql prefix 인지 검증.
- 도메인·HTTPS 적용.
- ADMIN/JWT/SMTP 시크릿 재발급.
- 백업·복구 절차 1회 점검.

### 🟡 P1 (운영 시작 후 빠르게 보강)
- smoke test 4~6건.
- CI 의 critical security 스캔 blocking 승격.
- 모니터링 / 알림 (Sentry 등).
- 영구 파일 스토리지 (S3 / R2 / Cafe24).

### 🟢 P2 (장기 유지보수 단계)
- `_backup-static-2026-04-27/` 삭제.
- `LEGACY_KEY` 마이그레이션 코드 제거.
- `archive/backend-cf` git rm.
- 분기별 시크릿 회전.

---

## 12. 클라이언트 인지 가이드

본 문서를 클라이언트가 직접 읽기에는 기술적입니다.
클라이언트용 요약은 [`CLIENT_HANDOFF.md`](./CLIENT_HANDOFF.md) 를 참고하세요.
