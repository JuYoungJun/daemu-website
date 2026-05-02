# DAEMU API — Cloudflare Worker

GitHub Pages 데모에 실제 백엔드를 붙이는 가장 빠른 방법. 무료, 5분 셋업, 도메인 필요 없음.

## 1. 가입 & wrangler 설치

```bash
# Cloudflare 대시보드 가입: https://dash.cloudflare.com/sign-up

cd backend-cf
npm install
npx wrangler login          # 브라우저에서 OAuth 동의
```

## 2. Secret 등록

```bash
# Resend API 키 (브라우저에 노출되지 않음)
npx wrangler secret put RESEND_API_KEY
# 입력 프롬프트에 본인의 Resend API 키 붙여넣기 (re_xxxxxxxxx 형태)

# 허용 origin (GitHub Pages URL + 로컬 테스트)
npx wrangler secret put ALLOWED_ORIGINS
# 예: https://juyoungjun.github.io,http://localhost:8765
```

## 3. 배포

```bash
npx wrangler deploy
```

배포 완료되면 URL 출력됨, 예시:
```
https://daemu-api.juyoungjun.workers.dev
```

## 4. 프론트엔드 연결

### 로컬에서 테스트
프로젝트 루트 `.env`:
```env
VITE_API_BASE_URL=https://daemu-api.juyoungjun.workers.dev
```
→ `npm run build && npm run preview`

### GitHub Pages 데모
1. Repo → Settings → Secrets and variables → Actions → **Variables** 탭
2. **New repository variable**
   - Name: `VITE_API_BASE_URL`
   - Value: `https://daemu-api.juyoungjun.workers.dev`
3. demo 브랜치에 빈 커밋 푸시하거나 Actions 재실행 → Pages 사이트가 실제 백엔드와 통신

## 5. 헬스체크

```bash
curl https://daemu-api.juyoungjun.workers.dev/api/health
# → {"ok":true,"resendConfigured":true,"from":"DAEMU <onboarding@resend.dev>"}
```

## 6. 도메인 인증 후

Resend 도메인 인증되면 wrangler에서 환경 변수 변경:
```bash
npx wrangler secret put FROM_EMAIL
# DAEMU <noreply@daemu.kr>
```

## 비용

- Cloudflare Workers: 100,000 req/day 무료 (대량으로도 거의 안 막힘)
- Resend: 3,000 mail/month 무료
- 합계 **₩0**
