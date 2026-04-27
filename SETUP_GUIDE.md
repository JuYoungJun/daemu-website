# DAEMU 발급·셋업 가이드

데모 → 실제 운영 전환에 필요한 외부 서비스 가입 순서. 모두 마치면 사이트의 모든 발송 기능이 실제로 작동합니다.

## 한 눈에

| # | 서비스 | 비용 | 필수? | 받아올 값 |
|---|---|---|---|---|
| 1 | **Resend** (이메일 발송) | 3,000건/월 무료 | ✅ 필수 | API Key 1개 |
| 2 | **Cloudflare** (백엔드 호스팅) | 100k req/일 무료 | ✅ 필수 | Workers URL |
| 3 | **도메인** | 연 10,000~20,000원 | ⚠️ Resend 도메인 인증·운영 시 권장 | 도메인 이름 |
| 4 | **GitHub** (형상관리·배포) | 무료 | ✅ 추천 | 계정 |
| 5 | **Plausible/Umami** (분석) | $9/월 또는 self-host | ❌ 선택 | 도메인 |

총 비용: **무료** (도메인만 별도 연 1~2만원)

---

## 1. Resend — 이메일 발송 ✅ 필수

### 1-1. 가입
1. https://resend.com 접속
2. **Sign up** (이메일 + 비밀번호 또는 GitHub OAuth)
3. 대시보드 진입

### 1-2. (옵션 A) 도메인 없이 시작 — 테스트만
- 발신 주소를 `onboarding@resend.dev` 로 설정 가능 (백엔드 코드에서)
- **수신자는 본인 이메일만 가능** (계정 연결된 이메일)
- 진짜 운영은 안 됨, 개발/검증 용도

### 1-2. (옵션 B) 도메인 인증 — 운영용 ⭐
1. **Domains → Add Domain**
2. 도메인 입력 (예: `daemu.kr`)
3. 표시되는 DNS 레코드 3종(SPF / DKIM / DMARC)을 **도메인 등록업체 DNS 설정**에 추가
   - 카페24 도메인이면: 카페24 마이페이지 → 도메인 → DNS 설정
   - 가비아면: 가비아 → 도메인 → DNS 정보
   - Cloudflare DNS 사용하면: 더 쉬움 (아래 2번에서 자동 등록 가능)
4. "Verify" 클릭 → DNS 전파 5~30분 → 인증 완료
5. 인증된 도메인의 메일 주소(예: `noreply@daemu.kr`)를 발신자로 사용 가능

### 1-3. API Key 발급
1. **API Keys → Create API Key**
2. 옵션:
   - **Name**: `DAEMU Production` (이름 자유)
   - **Permission**: `Sending access`
   - **Domain**: 위에서 인증한 도메인 (또는 `All domains`)
3. **Add** 클릭
4. 표시되는 키 복사 (`re_xxxxxxxxxxxxxxxxxxxxxxxxxx` 형태) — **한 번만 표시되니 안전한 곳에 보관**

### 1-4. 알려주실 값
```
RESEND_API_KEY = re_xxxxxxxxxxxxxxxxxxxxxxxxxx
도메인 인증 여부: ☐ 아직 안 함  ☐ daemu.kr 인증 완료  ☐ 다른 도메인 (___)
```

---

## 2. Cloudflare — 백엔드 호스팅 ✅ 필수

### 2-1. 가입
1. https://dash.cloudflare.com/sign-up
2. 이메일 + 비밀번호로 가입
3. 무료 플랜 선택 (Pages·Workers·DNS 모두 무료 티어 충분)

### 2-2. Workers 활성화
1. 대시보드 좌측 메뉴 → **Workers & Pages** 클릭
2. 처음이면 무료 서브도메인 설정 (`your-name.workers.dev` 형태) — 본인 원하는 이름 입력
3. 이 서브도메인이 백엔드 URL의 베이스가 됨 (예: `daemu-api.kim-sungho.workers.dev`)

### 2-3. (선택) 도메인을 Cloudflare DNS로 옮기기 — 강력 추천
- 도메인을 카페24/가비아에서 샀어도 **DNS만 Cloudflare로 옮길 수 있음** (도메인 소유는 그대로)
- 장점: Resend DNS 인증이 1클릭, Workers를 본인 도메인(`api.daemu.kr`)으로 바인딩 가능, CDN 자동 적용
- 단계:
  1. Cloudflare 대시보드 → **Add a site** → 도메인 입력
  2. 표시되는 네임서버 2개를 도메인 등록업체에서 변경
     - 카페24: 마이페이지 → 도메인 → 네임서버 변경
     - 가비아: 도메인 → 네임서버 → Cloudflare 네임서버 입력
  3. 24시간 내 전파 완료
- 본인 도메인 없으면 이 단계는 건너뛰고 워커 기본 URL 사용

### 2-4. 알려주실 값
```
Cloudflare 계정 이메일: ___________________
Workers 서브도메인:    _____.workers.dev
(도메인 옮겼으면) 도메인: _________________
```

배포 자체는 제가 코드 받아서 처리해드릴 수 있습니다 (Wrangler CLI로 한 줄). 또는 Cloudflare 대시보드에서 코드 붙여넣기로도 가능.

---

## 3. 도메인 — 선택이지만 운영엔 권장

### 도메인이 필요한 이유
- Resend 발신자가 `noreply@daemu.kr` 같은 본인 도메인 → 신뢰도·도달율 ↑ (스팸 분류 ↓)
- 사이트 주소가 `daemu.kr` 같은 본인 도메인 (vs `xxx.workers.dev` 또는 카페24 기본 호스트)
- Plausible Analytics 사용 가능

### 도메인 구매처 (어디서 사도 사이트 동작은 동일)

| 등록업체 | 특징 |
|---|---|
| **가비아** | 한국 1위, 1년 1,100원 시작 (.shop 등 저렴 TLD 행사) |
| **카페24** | 호스팅이랑 같이 묶어 관리할 수 있음 |
| **Cloudflare Registrar** | 마진 0% — 가장 저렴 (.com 기준 연 $9.15). 단, 결제는 해외 카드 |
| **후이즈** | 한국, 부가 기능 많음 |

추천 이름 패턴:
- `daemu.kr` (회사 정식)
- `daemu.co.kr` (보편)
- `daemu.cafe` (브랜드)
- `daemu.studio` (디자인 회사 느낌)

### 알려주실 값
```
도메인 사용 계획: ☐ 안 살 거임  ☐ 구매했음(_____)  ☐ 추천받고 싶음
```

---

## 4. GitHub — 형상관리·배포 ✅ 추천

### 4-1. 가입
1. https://github.com/signup (무료 계정 충분)
2. 사용자 이름 정하기 (예: `daemu-dev`)

### 4-2. 저장소(Repository) 생성
1. 우상단 + → **New repository**
2. **Repository name**: `daemu-website`
3. **Private** 선택 (소스 비공개 권장)
4. README 등 옵션 체크 안 해도 됨
5. **Create repository**

### 4-3. 알려주실 값
```
GitHub 계정 이름: __________
Repository URL:  https://github.com/____/daemu-website
```

배포 GitHub Actions 워크플로우는 제가 작성해서 PR 형태로 올려드릴 수 있습니다.

---

## 5. Plausible Analytics — 선택

도메인 등록 후 가입 가능. 도메인 없으면 건너뛰세요.

### 가입
1. https://plausible.io → **Get started for free** (30일 trial → 월 $9)
2. **Sites → Add a Site** → 본인 도메인 입력 (예: `daemu.kr`)
3. 표시되는 스크립트 태그 → 사이트에 자동 주입 (이미 코드 준비됨)

### 무료 대안 — Umami self-host
- Cloudflare에 같이 띄울 수 있음 (Docker)
- 데이터 100% 본인 소유
- 셋업 가이드: https://umami.is/docs/install

### 알려주실 값
```
Plausible 사용: ☐ 안 함  ☐ Plausible Cloud  ☐ Umami self-host
사이트 도메인: ____________
```

---

## ✅ 발급 후 알려주실 것 — 한 곳에 정리

가장 빠른 운영 셋업이면 다음 4개만 알려주시면 됩니다:

```
[필수]
1. Resend API Key:        re_xxxxxxxxxxxxxxxxxxxxx
2. Cloudflare 워커 서브도메인:  _____.workers.dev
3. (도메인 인증 여부)        ☐ 아직   ☐ 완료(_____)

[선택]
4. 사이트 운영 도메인:     _____ 또는 안 씀
5. Plausible 도메인:      _____ 또는 안 씀
```

위 값들 받으면 제가:
1. 백엔드 코드 (`backend-reference/`)를 받으신 Resend 키로 채워서 Cloudflare Workers에 배포
2. 사이트 `.env`의 `VITE_API_BASE_URL`을 받으신 워커 URL로 등록
3. CORS 설정 + 빌드 + 배포 검증
4. 첫 실제 발송 테스트 함께 점검

까지 한 번에 끝내드립니다.

---

## 🆘 만약 막히면

각 단계에서 화면 캡처 + 에러 메시지를 보내주시면 그 자리에서 짚어드립니다. 특히:

- Resend 도메인 인증 실패 → DNS 레코드 입력 위치 헷갈리는 경우 흔합니다
- Cloudflare 네임서버 변경 → 카페24/가비아 위치 가이드 같이 드릴 수 있음
- Workers 첫 배포 → wrangler 설치부터 함께 진행 가능

이 가이드대로 발급 다 받아오시면 30분~1시간 내에 운영 전환됩니다.
