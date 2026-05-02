# archive/ — 참조용 비활성 코드

본 디렉토리의 모든 코드는 **운영에서 사용하지 않는 참조 자료** 입니다.
실수로 배포되지 않도록 다음 정책을 따릅니다.

## 정책

1. 본 디렉토리의 코드는 **빌드/배포 파이프라인에 포함되지 않음**:
   - `package.json` 의 빌드 스크립트는 `archive/` 를 무시
   - `.github/workflows/` 의 deploy 워크플로 path filter 에서 `archive/` 제외
   - `deploy/cafe24/setup.sh` 가 `archive/` 를 복사하지 않음
2. 본 디렉토리의 secret / API key 등록 절차도 진행 금지.
3. archive 안의 README 는 보존 사유 + 위험 식별을 명시.

## 현재 archive 항목

### `backend-cf/` (2026-05-02 archive)

**원본 위치**: 저장소 root 의 `backend-cf/`

**아카이브 사유**: 참조용 Cloudflare Worker 백엔드. 인증/인가 로직이 없는
이메일 발송 API (`/api/email/send`, `/api/email/campaign`) 를 제공해
배포 시 **외부 악용 가능한 메일 릴레이** 가 됨 (Critical 보안 위험).

배포된 적이 없으나 저장소에 그대로 두면 신규 운영자가 실수로 `wrangler
deploy` 실행 가능 — 따라서 archive 로 이전 + `wrangler.toml` 의 deploy
설정 비활성화.

**재사용 결정 시 필수 사항**:
- `/api/email/*` endpoint 모두에 JWT 또는 HMAC 기반 server-to-server 인증 추가
- CORS allowlist 미일치 시 403 반환 (현재는 첫 항목 fallback)
- 첨부 파일 크기 / MIME / base64 strict 검증
- request 본문 크기 제한
- 발송 횟수 / 수신자 수 rate limit
- audit log 연동

이 모든 작업이 끝나기 전엔 절대 `wrangler deploy` 금지.
