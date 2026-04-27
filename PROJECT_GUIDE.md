# DAEMU Website — 운영 가이드

이 문서는 사이트 운영·배포·기능 확장에 필요한 의사결정과 절차를 한 곳에 정리합니다.

---

## 1. 이번 라운드에 들어간 변경 요약

### 버그 수정
- `useExternalScript`이 외부 `<script src>` 비동기 실행으로 페이지 진입 후 새로고침 한 번 더 해야 데이터가 보이던 문제 → fetch + inline `<script>` 동기 인젝션으로 변경. 첫 fetch만 비동기, 이후 메모리 캐시.
- 어드민 서브페이지의 `const KEY = "..."` top-level 충돌 → 각 inline 스크립트를 IIFE로 감싸고 onclick 핸들러로 쓰이는 함수만 `window`에 노출.
- "울왕리" 오타 → **을왕리** (work-detail, admin-works, raw work HTML 모두).
- /work 페이지 `Selected Work.` 좌측 치우침 → 가운데 정렬 + offset 제거.

### Contact 페이지
- CONTACT INFO에 푸터와 동일한 전화번호 `061-335-1239` 표기 (mailto/tel 활성).
- "기타 문의" 카테고리 선택 시 폼이 단순형(이름·이메일·연락처(선택)·문의 제목·자유 본문)으로 전환됨. 다른 카테고리는 기존 7필드 유지.
- 문의 카테고리(창업 컨설팅 등)는 **type 필드로 함께 저장**되어 어드민 문의 목록에서 그대로 조회됩니다. 자동회신 메일에도 `{{category}}` 변수로 들어갑니다.

### 파트너 (공개 페이지)
- 로그인 후 보일 **파트너 포털** 추가: 새 발주 / 발주 이력 / 계정 정보 3 탭.
- 파트너 회원가입 폼 추가: 신청 즉시 어드민 파트너 DB에 `inactive`로 들어감 → 어드민이 `/admin/partners`에서 "활성" 토글로 승인 → 파트너 로그인 가능.
- 초기 비밀번호: 등록한 휴대폰 뒷 4자리 (또는 어드민이 직접 `password` 필드를 변경).
- 발주 등록 시 `daemu-db-change` 이벤트로 어드민 페이지에 즉시 반영.

### 어드민 (관리자) 페이지
- **CSV 다운로드**: 우하단 플로팅 버튼으로 현재 페이지 데이터를 CSV로 즉시 내보내기. 문의·파트너·발주·CRM·작업사례·캠페인·쿠폰·팝업 모두 지원. UTF-8 BOM 포함이라 엑셀에서 한글 깨지지 않음.
- **발주 계약서 첨부**: 발주 폼에 "계약서 / 명세서 본문" 텍스트 추가, 저장 후 목록에서 "계약서 발송" 버튼 → 파트너 이메일로 EmailJS 통해 발송.
- **이미지 클라이언트 최적화**: works · media · popup 업로드 시 자동으로 1920px 캡 + JPEG q=0.82 재인코딩. localStorage 폭발 방지.
- 새로고침 없이 페이지 이동 시 데이터 정상 표시 (위 useExternalScript 패치 효과).

### API 통합 (이전 라운드 + 이번 라운드)
- **EmailJS**: Contact 폼 자동회신, 어드민 답변완료 회신, 캠페인 발송, 발주 계약서 발송.
- **Cloudinary**: works/media/popup 이미지 업로드. 키 없으면 base64 fallback.
- **Plausible**: 페이지뷰 자동 트래킹.

키 발급/적용은 `API_KEYS.md` 참고.

---

## 2. 캠페인 발송 비용

각 채널에 따라 비용 구조와 무료 티어 옵션이 다릅니다.

### 이메일 (현재 EmailJS로 구현됨)

| 서비스 | 무료 티어 | 유료 시작 | 한 번에 N명 발송 비용 |
|---|---|---|---|
| **EmailJS** (현재 사용) | 200 emails/월 | $11/월 (1k) · $35/월 (10k) | 200까지 무료, 초과 시 월 정액 |
| **Resend** | 3,000/월 (100/일 cap) | $20/월 (50k) | 3000까지 무료, 매우 저렴 |
| **SendGrid** | 100/일 영구 무료 | $19.95/월 (50k) | 작은 규모 영구 무료 |
| **Mailgun** | 5,000/월 (3개월 trial) | $35/월 (50k) | 첫 3개월 무료 |
| **AWS SES** | 200/일 (EC2에서 발송 시) | $0.10 / 1,000건 | 거의 공짜 수준 (백엔드 필요) |

**권장 단계**:
1. **초기**: 현재 EmailJS 무료 티어 200건/월로 시작 → 월 200건 이하면 비용 0원.
2. **확장 시**: SendGrid 무료(100/일=3,000/월) 또는 Resend 무료(3,000/월) — 두 서비스 모두 EmailJS와 비슷한 클라이언트 통합 가능, 코드 1~2시간 마이그레이션.
3. **대량 발송 (월 50k+)**: AWS SES + 작은 백엔드 (Cloudflare Workers / Vercel Functions) → 1,000건당 $0.10 = 5만건 발송해도 $5.

### SMS (현재 미구현 — 캠페인 채널 옵션만 표시)

| 서비스 | 건당 비용 (한국 발송) | 비고 |
|---|---|---|
| **알리고 (Aligo)** | SMS 8.4원 / LMS 32원 / MMS 90원 | 한국 1위, 백엔드 필수 |
| **NCP SENS** | SMS 8.8원 / LMS 32원 / MMS 80원 | 네이버, 백엔드 필수 |
| **Twilio** | $0.0245/건 (~32원) | 글로벌, 비싼 편 |
| **카카오톡 알림톡** (CS via 비즈뿌리오) | 7~9원 + 부가세 | 사전 템플릿 등록 필요, 카톡으로 도달 |

**권장**: 한국 고객이 메인이면 **알리고** + 카카오 알림톡 조합. 단가가 가장 저렴하고 도달률 높음.

**무료로 시작하려면**: SMS는 진짜 무료 옵션이 없습니다. 대안으로
- 회원가입 OTP는 **이메일로** 처리 (현재 구조)
- 캠페인은 **이메일만** 사용
- 정말 SMS 필요해지면 그때 알리고 충전식($10 = 약 천 건)

### 카카오톡 알림톡

알림톡(친구추가 없이 발송 가능)은 모두 **사전 템플릿 등록 + 발송 대행사**를 거쳐야 합니다.

- **비즈뿌리오** (가장 보편적): 건당 7~10원
- **NCP SENS Kakao**: 건당 9.4원
- **알리고 카카오**: 건당 8.5원

**준비 사항**:
1. 카카오 비즈니스 계정 등록
2. 알림톡 발신 프로필 등록 (영업일 1~3일)
3. 템플릿 사전 심사 (영업일 1~3일)

→ 운영 시작 즉시는 어렵고, 캠페인 다양화 단계에서 도입하는 게 적절.

### 비용 시나리오 (월 1,000명 고객 기준)

| 시나리오 | 월 비용 |
|---|---|
| 이메일만 (EmailJS 200건+추가 800건) | $11 (확장 플랜) |
| 이메일 + SMS 100건 | $11 + 840원 ≈ 약 $12 |
| 이메일 + SMS 100건 + 알림톡 500건 | $11 + 840 + 4,500원 ≈ 약 $16 |

**1,000명 미만 단계에선 사실상 EmailJS 무료 + 필요 시 SMS 충전식이면 충분.**

---

## 3. 카페24 호스팅 추천

### 카페24가 강요되는 환경이라면

카페24 호스팅 종류 중 React SPA에 적합한 것:

| 플랜 | 월 비용 | 적합도 | 비고 |
|---|---|---|---|
| **카페24 호스팅 기본** | 1,650원 | ❌ | PHP/CGI 기반, SPA fallback 설정 어렵고 정적 빌드 업로드만 가능 |
| **카페24 호스팅 절약/일반/효율형** | 5,500~16,500원 | △ | 정적 사이트로는 OK, .htaccess로 SPA fallback 설정 필요 |
| **카페24 클라우드 베이직 (가상서버)** | 11,000원~ | ✅ | Linux 셸 접근 가능, Nginx로 SPA fallback 자유롭게, 권장 |

**권장 구성 (카페24 클라우드 베이직)**:
1. Ubuntu 가상서버 신청
2. Nginx 설치 → SPA fallback 한 줄 설정:
   ```nginx
   location / {
     try_files $uri $uri/ /index.html;
   }
   ```
3. GitHub Actions로 main 브랜치 push 시 `dist/` 자동 배포 (rsync over SSH)
4. SSL: Let's Encrypt (certbot, 무료)

### 카페24 강제가 아니라면 (대안 추천)

| 호스팅 | 월 비용 | 장점 |
|---|---|---|
| **Vercel** | $0 (무료 hobby) | React/Vite 자동 배포, GitHub 연동, SPA fallback 자동, 글로벌 CDN |
| **Netlify** | $0 (무료) | Vercel과 거의 동일한 사용감 |
| **Cloudflare Pages** | $0 (무제한 대역폭!) | 가장 빠른 CDN, Workers 통합 (백엔드 함수도 같이) |
| **GitHub Pages** | $0 | 정적만, 데모용으로 추천 (사용자가 이미 계획) |

**최선의 권장**: Cloudflare Pages (무료 + 무제한 대역폭 + 빠른 CDN). 카페24가 도메인 등록만 거기서 했고 호스팅이 강제가 아니라면 Cloudflare로 가는 걸 추천. 도메인의 네임서버만 Cloudflare로 변경하면 끝.

→ 카페24가 정말 강제라면 클라우드 베이직 + Nginx 셋업.

---

## 4. GitHub 브랜치 전략

요청대로 main / staging / demo(GitHub Pages용) 3개 브랜치 + 기능 단위 feature 브랜치.

```
main         ─────●─────●─────●  (배포 = 카페24 또는 Cloudflare 프로덕션)
                 ↑     ↑     ↑
                 모든 PR은 staging에서 검증 후 main으로
                 
staging      ───●───●───●───●    (스테이징, 검증 환경)
                ↑   ↑   ↑   ↑
                feature/* PR 머지

demo         ─●─●─●─●─●          (GitHub Pages, 데모/공유용)
              ↑                  (staging의 일부 또는 별도 진행 사안 노출)

feature/xxx  ●─●  PR             (작업 단위 — 1개 기능 = 1개 브랜치)
```

### 흐름

1. **새 기능**: `feature/popup-redesign` 같은 브랜치를 staging에서 분기
2. PR → **staging** 머지 → 자동으로 staging 환경 빌드/배포 (GitHub Actions)
3. 사용자/팀 검증 OK → staging → **main** 머지 → 카페24/Cloudflare 자동 배포
4. **demo**: 외부 공유나 클라이언트 미리보기가 필요할 때 staging에서 cherry-pick 또는 staging을 demo로 fast-forward → GitHub Pages로 배포

### 브랜치 보호 규칙 권장

- **main**: PR 필수, 1명 이상 리뷰, staging에서만 머지 가능, 직접 push 금지
- **staging**: 직접 push 가능 (개발자), feature/* PR 머지
- **demo**: 직접 push 또는 스케줄 동기화

### GitHub Actions 워크플로우

`.github/workflows/deploy.yml` 같은 파일에 3개 환경 정의:

```yaml
name: deploy
on:
  push:
    branches: [main, staging, demo]
jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci && npm run build
      - if: github.ref == 'refs/heads/main'
        # rsync to 카페24 or push to Cloudflare via API
        run: ./.github/scripts/deploy-prod.sh
      - if: github.ref == 'refs/heads/staging'
        run: ./.github/scripts/deploy-staging.sh
      - if: github.ref == 'refs/heads/demo'
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

각 환경별 `VITE_*` 환경변수는 GitHub Secrets에 저장 (Repo Settings → Secrets and variables → Actions).

---

## 5. 추후 추천 기능 (구현 안 한 항목)

### 콘텐츠/운영
- **블로그/매거진 섹션** — 자체 콘텐츠 발행으로 SEO 강화 (Astro/MDX 또는 admin에 글쓰기 기능)
- **다국어 지원 (i18n)** — 영어 페이지 추가 (해외 거래선 대응)
- **검색 기능** — 사이트 내 콘텐츠/프로젝트 검색
- **방문자 분석 대시보드 강화** — Plausible API 연동해서 어드민 통계에 트래픽 그래프

### 비즈니스
- **온라인 결제 연동** — 토스페이먼츠/카카오페이 (파트너 후정산이 아닌 즉시결제 옵션)
- **재고 관리** — 발주 상품의 재고 트래킹, 자동 발주 트리거
- **세금계산서 자동발행** — 팝빌(Popbill) API 연동
- **쇼핑몰 모드** — 카페 메뉴 온라인 주문 (배달앱과 별개)
- **예약 시스템** — 컨설팅 미팅 예약 (Calendly 임베드 또는 자체 구현)
- **계약서 PDF 변환 + 전자서명** — DocuSign / 모두싸인 연동

### 마케팅/CRM 심화
- **A/B 테스트** — 팝업 / 캠페인 변형 테스트
- **자동 시퀀스** — 신규 리드 → 7일 후 자동 follow-up 메일
- **랜딩페이지 빌더** — 캠페인별 전용 랜딩 (현재는 수동)
- **소셜 통합** — 인스타 피드 자동 임베드, 카카오톡 채널 ↔ CRM 연동

### 기술/운영
- **DB 영속화** — localStorage → Supabase (Postgres + Auth + Storage 통합) 마이그레이션
- **백오피스 사용자 권한 분리** — 관리자/매니저/뷰어 등 역할별 접근
- **감사 로그** — 누가 언제 무엇을 변경했는지 기록
- **알림 센터** — 신규 문의/발주 시 어드민에게 카카오톡 알림
- **백업 자동화** — localStorage → JSON export → S3/Drive 정기 백업

---

## 6. 미디어(이미지/영상) 처리 — CDN 미사용 환경

요청하신 대로 별도 CDN을 쓰지 않는 전제로, 다음 4가지가 적용되었습니다:

1. **클라이언트 측 자동 리사이즈**: 1920px 초과 시 long edge 기준으로 축소
2. **JPEG 재인코딩**: q=0.82로 고압축 (PNG/HEIC 사진은 보통 30~70% 감소)
3. **SVG/GIF 통과**: 벡터·애니메이션은 손대지 않음
4. **base64 저장**: localStorage에 데이터 URL로 직접 저장 (Cloudinary 키 미설정 시)

**한계**:
- localStorage 용량 5~10MB 제한 → 최적화한 사진 ~30~50장 정도 저장 가능
- 영상은 클라이언트 측 트랜스코드가 무겁고 표준 API 부재 → **영상은 일단 외부 호스팅(YouTube/Vimeo) 임베드 권장**

**용량 한계가 부담되면**:
- Cloudinary 무료 25GB로 전환 (`.env` 키 등록만 하면 자동 적용)
- 또는 imgur/Cloudflare R2 무료 티어
- 카페24 클라우드 베이직 사용 시 호스팅 디스크에 직접 업로드 (백엔드 약간 필요)

---

## 7. 알려진 제한사항 / 다음 작업으로 미룬 것

이번 라운드에서 시간상 다음 항목은 **구조만 잡고 깊이 들어가진 않았습니다**:

- **작업사례 구조형 이미지 슬롯**: 현재는 자유형 다중 업로드. 정해진 슬롯(히어로 / 갤러리 ×3 / 프로세스 단계별)은 admin-works 폼에 별도 필드로 추가하면 됩니다 — work-detail 페이지의 PROJECTS 데이터 구조와 1:1 매핑 가능.
- **작업사례 미리보기 모달**: admin-works에 현재 새로 등록한 프로젝트가 work-detail에서 어떻게 보일지 미리보기. 추가하려면 work-detail-page.js의 렌더 로직을 함수로 추출하고 admin-works에서 별도 컨테이너에 호출하는 방식.
- **뉴스레터 별도 작성 UI**: 현재는 캠페인 페이지의 "뉴스레터 구독자" 그룹을 선택하면 됩니다(이미 동작). 별도 "Newsletter" 메뉴로 분리할지는 운영 방식 정해진 뒤 결정 권장.
- **반응형 정밀 점검**: 빌드 + 22 라우트 200 응답까지는 검증됐으나, 실제 모바일/태블릿 viewport별 시각 점검은 브라우저 DevTools에서 직접 확인 필요. CSS는 원본을 손대지 않았으므로 이전 정적 사이트와 동일한 미디어쿼리가 그대로 적용됩니다.

---

## 8. 빠른 점검 명령

```bash
# 개발 서버
npm run dev          # http://localhost:8765 (HMR)

# 프로덕션 빌드 + 미리보기
npm run build && npm run preview

# 환경변수 적용 후엔 반드시 재빌드
# Vite는 빌드타임에 import.meta.env를 인라인하므로
# .env 변경만으로는 반영되지 않음
```

배포 전 체크리스트:
- [ ] `.env`의 모든 키 채워져 있고 GitHub Secrets에도 동일하게 등록
- [ ] EmailJS 도메인 화이트리스트에 운영 도메인 등록
- [ ] Cloudinary Allowed Referrers 설정
- [ ] `npm run build` 성공
- [ ] /admin 로그인 후 모든 메뉴 진입 → 신규 등록 → 수정 → 삭제 1회씩
- [ ] /partners 가입 신청 → /admin/partners 활성화 → /partners 로그인 → 발주 → /admin/orders 즉시 반영 확인
- [ ] /contact 폼 제출 → 이메일 도착 + /admin/inquiries 반영 확인
